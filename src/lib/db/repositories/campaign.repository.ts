import { and, asc, desc, eq, gt, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "..";
import {
  campaignRecipients,
  campaigns,
  users,
  CampaignStatus,
  RecipientStatus,
  type Campaign,
  type CampaignRecipientRow,
  type NewCampaign,
} from "../schema";
import type { CampaignRecipient } from "@/lib/campaigns/contact-file";
import { getMetaErrorInfo } from "@/lib/errors/meta-errors";

const INSERT_CHUNK = 1000;

export type CampaignStats = Record<RecipientStatus, number>;

export const emptyStats = (): CampaignStats => ({
  pending: 0,
  sending: 0,
  sent: 0,
  delivered: 0,
  read: 0,
  failed: 0,
  skipped: 0,
  cancelled: 0,
  unknown: 0,
});

/** Status order for webhook updates: a later status never moves a recipient back (read stays read) */
const PROGRESS: Partial<Record<RecipientStatus, number>> = { sending: 0, unknown: 0, sent: 1, delivered: 2, read: 3 };

export class CampaignRepository {
  // ─── Campaigns ──────────────────────────────────────────────────────────────

  async list(organizationId: number): Promise<Campaign[]> {
    return db.select().from(campaigns).where(eq(campaigns.organizationId, organizationId)).orderBy(desc(campaigns.updatedAt));
  }

  async findById(id: number, organizationId: number): Promise<Campaign | null> {
    const [row] = await db
      .select()
      .from(campaigns)
      .where(and(eq(campaigns.id, id), eq(campaigns.organizationId, organizationId)))
      .limit(1);
    return row ?? null;
  }

  /** Worker-side lookup (queue messages carry only the campaign id) */
  async findByIdAnyOrg(id: number): Promise<Campaign | null> {
    const [row] = await db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1);
    return row ?? null;
  }

  async create(values: NewCampaign): Promise<Campaign> {
    const [row] = await db.insert(campaigns).values(values).returning();
    return row;
  }

  /**
   * Compare-and-set update: applies `patch` only while the campaign is in one of `fromStatuses`.
   * Returns null when it isn't (someone else moved it first), so callers never act on a stale state.
   */
  async update(
    id: number,
    organizationId: number | null,
    patch: Partial<NewCampaign>,
    fromStatuses?: readonly CampaignStatus[]
  ): Promise<Campaign | null> {
    const conditions = [eq(campaigns.id, id)];
    if (organizationId !== null) conditions.push(eq(campaigns.organizationId, organizationId));
    if (fromStatuses) conditions.push(inArray(campaigns.status, [...fromStatuses]));
    const [row] = await db
      .update(campaigns)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(...conditions))
      .returning();
    return row ?? null;
  }

  async delete(id: number, organizationId: number, fromStatuses: readonly CampaignStatus[]): Promise<boolean> {
    const rows = await db
      .delete(campaigns)
      .where(and(eq(campaigns.id, id), eq(campaigns.organizationId, organizationId), inArray(campaigns.status, [...fromStatuses])))
      .returning({ id: campaigns.id });
    return rows.length > 0;
  }

  /** Counts per recipient status for each campaign */
  async stats(campaignIds: number[]): Promise<Map<number, CampaignStats>> {
    const result = new Map<number, CampaignStats>();
    if (campaignIds.length === 0) return result;
    const rows = await db
      .select({ campaignId: campaignRecipients.campaignId, status: campaignRecipients.status, count: sql<number>`count(*)::int` })
      .from(campaignRecipients)
      .where(inArray(campaignRecipients.campaignId, campaignIds))
      .groupBy(campaignRecipients.campaignId, campaignRecipients.status);
    for (const row of rows) {
      const stats = result.get(row.campaignId) ?? emptyStats();
      stats[row.status] = row.count;
      result.set(row.campaignId, stats);
    }
    return result;
  }

  /**
   * Moves the campaign to `running` and starts a new run generation at tick #0. Ticks still queued from an
   * earlier run (before a pause) carry the old generation and are ignored.
   * Returns "busy" when a resume meets another scheduled or sending campaign of the workspace (enforced by
   * uq_campaigns_one_active_per_org), null when the campaign isn't in one of `fromStatuses`.
   */
  async beginRun(
    id: number,
    organizationId: number | null,
    fromStatuses: readonly CampaignStatus[],
    patch: Partial<NewCampaign> = {}
  ): Promise<Campaign | null | "busy"> {
    const conditions = [eq(campaigns.id, id), inArray(campaigns.status, [...fromStatuses])];
    if (organizationId !== null) conditions.push(eq(campaigns.organizationId, organizationId));
    try {
      const [row] = await db
        .update(campaigns)
        .set({
          ...patch,
          status: CampaignStatus.RUNNING,
          pauseReason: null,
          runGeneration: sql`${campaigns.runGeneration} + 1`,
          tickSeq: 0,
          workerLeaseUntil: null,
          consecutiveFailures: 0,
          // First start keeps its time; a resume doesn't change it
          startedAt: sql`coalesce(${campaigns.startedAt}, now())`,
          updatedAt: new Date(),
        })
        .where(and(...conditions))
        .returning();
      return row ?? null;
    } catch (err) {
      if (isOneActiveViolation(err)) return "busy";
      throw err;
    }
  }

  // ─── Worker: tick lease ─────────────────────────────────────────────────────

  /**
   * Takes the campaign for one tick: only while it is running, on the same run generation, at the expected tick
   * number, and nobody else holds the lease. Returns null otherwise (the tick is stale or a duplicate).
   */
  async acquireTick(id: number, generation: number, seq: number, leaseUntil: Date): Promise<Campaign | null> {
    const now = new Date();
    const [row] = await db
      .update(campaigns)
      .set({ workerLeaseUntil: leaseUntil })
      .where(
        and(
          eq(campaigns.id, id),
          eq(campaigns.status, CampaignStatus.RUNNING),
          eq(campaigns.runGeneration, generation),
          eq(campaigns.tickSeq, seq),
          or(isNull(campaigns.workerLeaseUntil), lt(campaigns.workerLeaseUntil, now))
        )
      )
      .returning();
    return row ?? null;
  }

  /** Ends a tick: advances the tick number (the next message must carry it) and releases the lease */
  async finishTick(id: number, generation: number, seq: number, patch: Partial<NewCampaign> = {}): Promise<Campaign | null> {
    const now = new Date();
    const [row] = await db
      .update(campaigns)
      .set({ ...patch, tickSeq: seq + 1, workerLeaseUntil: null, lastTickAt: now, updatedAt: now })
      .where(and(eq(campaigns.id, id), eq(campaigns.runGeneration, generation), eq(campaigns.tickSeq, seq)))
      .returning();
    return row ?? null;
  }

  /** Light read used between sends so a pause or cancel takes effect within a batch */
  async currentStatus(id: number): Promise<{ status: CampaignStatus; runGeneration: number } | null> {
    const [row] = await db
      .select({ status: campaigns.status, runGeneration: campaigns.runGeneration })
      .from(campaigns)
      .where(eq(campaigns.id, id))
      .limit(1);
    return row ?? null;
  }

  /** Scheduled campaigns whose start time passed (EventBridge missed or not configured) */
  async findOverdueScheduled(before: Date, limit = 20): Promise<Campaign[]> {
    return db
      .select()
      .from(campaigns)
      .where(and(eq(campaigns.status, CampaignStatus.SCHEDULED), lt(campaigns.scheduledAt, before)))
      .orderBy(asc(campaigns.scheduledAt))
      .limit(limit);
  }

  /** Running campaigns whose tick chain went quiet: no lease held and no tick finished since `before` */
  async findStalledRunning(before: Date, limit = 20): Promise<Campaign[]> {
    const now = new Date();
    return db
      .select()
      .from(campaigns)
      .where(
        and(
          eq(campaigns.status, CampaignStatus.RUNNING),
          or(isNull(campaigns.workerLeaseUntil), lt(campaigns.workerLeaseUntil, now)),
          sql`coalesce(${campaigns.lastTickAt}, ${campaigns.startedAt}, ${campaigns.updatedAt}) < ${before.toISOString()}::timestamptz`
        )
      )
      .limit(limit);
  }

  // ─── Recipients ─────────────────────────────────────────────────────────────

  /** Replaces a draft's audience in one transaction; a repeated number is stored once */
  async replaceRecipients(campaignId: number, organizationId: number, recipients: CampaignRecipient[]): Promise<number> {
    return db.transaction(async (tx) => {
      await tx.delete(campaignRecipients).where(eq(campaignRecipients.campaignId, campaignId));
      let inserted = 0;
      for (let i = 0; i < recipients.length; i += INSERT_CHUNK) {
        const rows = await tx
          .insert(campaignRecipients)
          .values(
            recipients.slice(i, i + INSERT_CHUNK).map((r) => ({ campaignId, organizationId, phone: r.phone, fields: r.fields }))
          )
          .onConflictDoNothing()
          .returning({ id: campaignRecipients.id });
        inserted += rows.length;
      }
      return inserted;
    });
  }

  async previewRecipients(campaignId: number, limit: number): Promise<CampaignRecipientRow[]> {
    return db
      .select()
      .from(campaignRecipients)
      .where(eq(campaignRecipients.campaignId, campaignId))
      .orderBy(asc(campaignRecipients.id))
      .limit(limit);
  }

  /** Copies another campaign's recipients (duplicate), all as pending */
  async copyRecipients(fromCampaignId: number, toCampaignId: number): Promise<void> {
    await db.execute(sql`
      INSERT INTO campaign_recipients (campaign_id, organization_id, phone, fields)
      SELECT ${toCampaignId}, organization_id, phone, fields FROM campaign_recipients
      WHERE campaign_id = ${fromCampaignId}
      ORDER BY id
      ON CONFLICT DO NOTHING`);
  }

  /**
   * Claims the next due pending recipients in file order: moved to `sending` with a lease and one more
   * attempt, in one statement. SKIP LOCKED keeps two workers from ever claiming the same row.
   *
   * The ids are taken with `= ANY(ARRAY(subquery))`, not `IN (subquery)`: Postgres evaluates ARRAY(...) once,
   * up front, whereas an `IN (... LIMIT n FOR UPDATE SKIP LOCKED)` subquery can be re-run during the update and
   * claim more than `n` rows (it claimed the whole list), which broke the one-contact-per-tick pacing.
   */
  async claimDue(campaignId: number, limit: number, lockedUntil: Date): Promise<CampaignRecipientRow[]> {
    const now = new Date();
    const due = db
      .select({ id: campaignRecipients.id })
      .from(campaignRecipients)
      .where(
        and(
          eq(campaignRecipients.campaignId, campaignId),
          eq(campaignRecipients.status, RecipientStatus.PENDING),
          or(isNull(campaignRecipients.nextAttemptAt), lt(campaignRecipients.nextAttemptAt, now))
        )
      )
      .orderBy(asc(campaignRecipients.id))
      .limit(limit)
      .for("update", { skipLocked: true });
    return db
      .update(campaignRecipients)
      .set({
        status: RecipientStatus.SENDING,
        lockedUntil,
        attempts: sql`${campaignRecipients.attempts} + 1`,
        updatedAt: now,
      })
      .where(and(sql`${campaignRecipients.id} = ANY(ARRAY(${due}))`, eq(campaignRecipients.status, RecipientStatus.PENDING)))
      .returning();
  }

  /** Records the outcome of a claimed recipient (only while it is still `sending`) */
  async settle(id: number, patch: Partial<typeof campaignRecipients.$inferInsert>): Promise<void> {
    await db
      .update(campaignRecipients)
      .set({ ...patch, lockedUntil: null, updatedAt: new Date() })
      .where(and(eq(campaignRecipients.id, id), eq(campaignRecipients.status, RecipientStatus.SENDING)));
  }

  /** Puts claimed recipients that were never sent back in the queue (pause, or stopped mid-batch) */
  async release(ids: number[], nextAttemptAt: Date | null = null): Promise<void> {
    if (ids.length === 0) return;
    await db
      .update(campaignRecipients)
      .set({
        status: RecipientStatus.PENDING,
        lockedUntil: null,
        nextAttemptAt,
        attempts: sql`greatest(${campaignRecipients.attempts} - 1, 0)`,
        updatedAt: new Date(),
      })
      .where(and(inArray(campaignRecipients.id, ids), eq(campaignRecipients.status, RecipientStatus.SENDING)));
  }

  /**
   * Rows left in `sending` past their lease: the worker died during the Meta call, so the message may have
   * gone out. They become `unknown` and are never retried automatically.
   */
  async expireStuckSending(campaignId: number): Promise<number> {
    const rows = await db
      .update(campaignRecipients)
      .set({ status: RecipientStatus.UNKNOWN, lockedUntil: null, errorMessage: "Interrupted while sending; not retried to avoid a duplicate", updatedAt: new Date() })
      .where(
        and(
          eq(campaignRecipients.campaignId, campaignId),
          eq(campaignRecipients.status, RecipientStatus.SENDING),
          lt(campaignRecipients.lockedUntil, new Date())
        )
      )
      .returning({ id: campaignRecipients.id });
    return rows.length;
  }

  /** What's left to do: pending rows (and the earliest retry time among them) and rows still being sent */
  async remaining(campaignId: number): Promise<{ pending: number; sending: number; nextAttemptAt: Date | null }> {
    const [row] = await db
      .select({
        pending: sql<number>`count(*) filter (where ${campaignRecipients.status} = 'pending')::int`,
        sending: sql<number>`count(*) filter (where ${campaignRecipients.status} = 'sending')::int`,
        nextAttemptAt: sql<string | null>`min(${campaignRecipients.nextAttemptAt}) filter (where ${campaignRecipients.status} = 'pending')`,
      })
      .from(campaignRecipients)
      .where(and(eq(campaignRecipients.campaignId, campaignId), inArray(campaignRecipients.status, [RecipientStatus.PENDING, RecipientStatus.SENDING])));
    return { pending: row?.pending ?? 0, sending: row?.sending ?? 0, nextAttemptAt: row?.nextAttemptAt ? new Date(row.nextAttemptAt) : null };
  }

  async cancelPending(campaignId: number): Promise<number> {
    const rows = await db
      .update(campaignRecipients)
      .set({ status: RecipientStatus.CANCELLED, updatedAt: new Date() })
      .where(and(eq(campaignRecipients.campaignId, campaignId), eq(campaignRecipients.status, RecipientStatus.PENDING)))
      .returning({ id: campaignRecipients.id });
    return rows.length;
  }

  /**
   * Applies a WhatsApp status webhook to the campaign recipient with this wamid. Moves forward only
   * (sent → delivered → read); `failed` wins over sent/delivered. Returns the campaign's id, or null when it isn't
   * a campaign message. A failure stores the code and its message from the Meta error catalog; for codes not in the
   * catalog, Meta's own error text (`metaErrorText`) is stored instead.
   */
  async applyDeliveryStatus(
    wamid: string,
    organizationId: number,
    status: "sent" | "delivered" | "read" | "failed",
    errorCode?: number | null,
    pricing?: DeliveryPricing | null,
    metaErrorText?: string | null
  ): Promise<number | null> {
    const [row] = await db
      .select({ id: campaignRecipients.id, status: campaignRecipients.status, campaignId: campaignRecipients.campaignId })
      .from(campaignRecipients)
      .where(and(eq(campaignRecipients.wamid, wamid), eq(campaignRecipients.organizationId, organizationId)))
      .limit(1);
    if (!row) return null;

    const now = new Date();
    // Meta repeats `pricing` on sent/delivered/read; keep the latest value it gave
    const pricingPatch = pricing
      ? {
          ...(typeof pricing.billable === "boolean" ? { billable: pricing.billable } : {}),
          ...(pricing.category ? { pricingCategory: String(pricing.category).slice(0, 40) } : {}),
          ...(pricing.pricing_model ? { pricingModel: String(pricing.pricing_model).slice(0, 20) } : {}),
        }
      : {};

    if (status === "failed") {
      if (row.status === RecipientStatus.READ) return row.campaignId;
      const errorMessage =
        getMetaErrorInfo(errorCode)?.userMessage ??
        (metaErrorText?.trim() ? metaErrorText.trim().slice(0, 1000) : "The message could not be delivered.");
      await db
        .update(campaignRecipients)
        .set({ status: RecipientStatus.FAILED, errorCode: errorCode ?? null, errorMessage, updatedAt: now, ...pricingPatch })
        .where(eq(campaignRecipients.id, row.id));
      return row.campaignId;
    }
    const advances = (PROGRESS[row.status] ?? -1) < (PROGRESS[status] ?? 0);
    if (!advances && Object.keys(pricingPatch).length === 0) return row.campaignId;
    await db
      .update(campaignRecipients)
      .set({
        ...pricingPatch,
        updatedAt: now,
        ...(advances
          ? {
              status,
              ...(status === "delivered" ? { deliveredAt: now } : {}),
              ...(status === "read" ? { readAt: now } : {}),
            }
          : {}),
      })
      .where(eq(campaignRecipients.id, row.id));
    return row.campaignId;
  }

  /** Recipients after `afterId` in file order, for streaming exports */
  async recipientsPage(campaignId: number, afterId: number, limit: number): Promise<CampaignRecipientRow[]> {
    return db
      .select()
      .from(campaignRecipients)
      .where(and(eq(campaignRecipients.campaignId, campaignId), gt(campaignRecipients.id, afterId)))
      .orderBy(asc(campaignRecipients.id))
      .limit(limit);
  }

  /**
   * One page of a campaign's contacts in file order, for the details page. `statuses` limits the rows;
   * `search` matches the phone number or any value from the uploaded file.
   */
  async recipientsList(
    campaignId: number,
    options: { offset: number; limit: number; statuses?: RecipientStatus[]; search?: string }
  ): Promise<{ rows: CampaignRecipientRow[]; total: number }> {
    const conditions = [eq(campaignRecipients.campaignId, campaignId)];
    if (options.statuses?.length) conditions.push(inArray(campaignRecipients.status, options.statuses));
    const search = options.search?.trim();
    if (search) {
      const pattern = `%${search.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
      conditions.push(sql`(${campaignRecipients.phone} ILIKE ${pattern} OR ${campaignRecipients.fields}::text ILIKE ${pattern})`);
    }
    const where = and(...conditions);
    const [rows, [{ total }]] = await Promise.all([
      db.select().from(campaignRecipients).where(where).orderBy(asc(campaignRecipients.id)).limit(options.limit).offset(options.offset),
      db.select({ total: sql<number>`count(*)::int` }).from(campaignRecipients).where(where),
    ]);
    return { rows, total };
  }

  /** The workspace's scheduled or sending campaign, if any (there is at most one) */
  async findActive(organizationId: number): Promise<Campaign | null> {
    const [row] = await db
      .select()
      .from(campaigns)
      .where(
        and(eq(campaigns.organizationId, organizationId), inArray(campaigns.status, [CampaignStatus.SCHEDULED, CampaignStatus.RUNNING]))
      )
      .limit(1);
    return row ?? null;
  }

  /**
   * draft → scheduled. Returns "busy" when the workspace already has a scheduled or sending campaign
   * (uq_campaigns_one_active_per_org), null when the campaign isn't a draft anymore.
   */
  async markScheduled(id: number, organizationId: number, patch: Partial<NewCampaign>): Promise<Campaign | null | "busy"> {
    try {
      return await this.update(id, organizationId, { ...patch, status: CampaignStatus.SCHEDULED }, [CampaignStatus.DRAFT]);
    } catch (err) {
      if (isOneActiveViolation(err)) return "busy";
      throw err;
    }
  }

  /** User id → name, for "Created by" */
  async userNames(userIds: number[]): Promise<Map<number, string>> {
    const ids = [...new Set(userIds)];
    if (ids.length === 0) return new Map();
    const rows = await db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(inArray(users.id, ids));
    return new Map(rows.map((u) => [u.id, u.name || u.email || `User ${u.id}`]));
  }
}

/** The `pricing` object of a WhatsApp status webhook */
export interface DeliveryPricing {
  billable?: boolean;
  category?: string;
  pricing_model?: string;
}

/** True when an update broke "one active campaign per workspace" */
function isOneActiveViolation(err: unknown): boolean {
  for (let e: any = err, depth = 0; e && depth < 5; e = e.cause, depth++) {
    if (e.code === "23505" && String(e.constraint_name ?? e.constraint ?? "").includes("uq_campaigns_one_active_per_org")) return true;
  }
  return false;
}

export const campaignRepository = new CampaignRepository();
