import { db } from "..";
import { and, count, desc, eq, inArray, lte, sql } from "drizzle-orm";
import {
  automations,
  automationRuns,
  customers,
  AutomationRunStatus,
  type Automation,
  type AutomationRun,
  type AutomationWait,
} from "../schema";

type AutomationInsert = typeof automations.$inferInsert;
type RunInsert = typeof automationRuns.$inferInsert;

export interface AutomationRunStats {
  totalRuns: number;
  lastRunStatus: string | null;
  lastRunAt: Date | null;
}

export type AutomationRunWithContact = AutomationRun & { customerName: string | null; customerPhone: string | null };

export class AutomationRepository {
  async list(organizationId: number): Promise<Automation[]> {
    return db.select().from(automations).where(eq(automations.organizationId, organizationId)).orderBy(desc(automations.updatedAt));
  }

  async listActive(organizationId: number): Promise<Automation[]> {
    return db
      .select()
      .from(automations)
      .where(and(eq(automations.organizationId, organizationId), eq(automations.isActive, true)));
  }

  async find(id: number, organizationId: number): Promise<Automation | null> {
    const [row] = await db
      .select()
      .from(automations)
      .where(and(eq(automations.id, id), eq(automations.organizationId, organizationId)))
      .limit(1);
    return row ?? null;
  }

  async create(data: AutomationInsert): Promise<Automation> {
    const [row] = await db.insert(automations).values(data).returning();
    return row;
  }

  async update(id: number, organizationId: number, data: Partial<AutomationInsert>): Promise<Automation | null> {
    const [row] = await db
      .update(automations)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(automations.id, id), eq(automations.organizationId, organizationId)))
      .returning();
    return row ?? null;
  }

  async remove(id: number, organizationId: number): Promise<void> {
    await db.delete(automations).where(and(eq(automations.id, id), eq(automations.organizationId, organizationId)));
  }

  // ── Runs ────────────────────────────────────────────────────────────────

  /** Creates the run once per (automation, trigger key); returns null if this trigger already started one. */
  async createRun(data: RunInsert): Promise<AutomationRun | null> {
    const [row] = await db.insert(automationRuns).values(data).onConflictDoNothing().returning();
    return row ?? null;
  }

  async findRun(id: number): Promise<AutomationRun | null> {
    const [row] = await db.select().from(automationRuns).where(eq(automationRuns.id, id)).limit(1);
    return row ?? null;
  }

  async updateRun(id: number, data: Partial<RunInsert>): Promise<AutomationRun | null> {
    const [row] = await db
      .update(automationRuns)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(automationRuns.id, id))
      .returning();
    return row ?? null;
  }

  /** True when the customer already has an unfinished run of this automation. */
  async hasOpenRun(automationId: number, customerId: number): Promise<boolean> {
    const [row] = await db
      .select({ id: automationRuns.id })
      .from(automationRuns)
      .where(
        and(
          eq(automationRuns.automationId, automationId),
          eq(automationRuns.customerId, customerId),
          inArray(automationRuns.status, [AutomationRunStatus.RUNNING, AutomationRunStatus.WAITING])
        )
      )
      .limit(1);
    return !!row;
  }

  /**
   * Atomically moves a waiting run back to running, but only if it is still waiting for exactly
   * this thing. Two webhook retries (or a retry racing the sweep) can therefore never resume a run twice.
   */
  async claimWaitingRun(id: number, expect: Pick<AutomationWait, "kind"> & { executionId?: number }): Promise<AutomationRun | null> {
    const conditions = [
      eq(automationRuns.id, id),
      eq(automationRuns.status, AutomationRunStatus.WAITING),
      sql`${automationRuns.waitingFor}->>'kind' = ${expect.kind}`,
    ];
    if (expect.executionId !== undefined) {
      conditions.push(sql`(${automationRuns.waitingFor}->>'executionId')::int = ${expect.executionId}`);
    }
    const [row] = await db
      .update(automationRuns)
      .set({ status: AutomationRunStatus.RUNNING, updatedAt: new Date() })
      .where(and(...conditions))
      .returning();
    return row ?? null;
  }

  /** Waiting runs whose delay ended or whose wait timed out. */
  async listDueRuns(now: Date, limit = 50): Promise<AutomationRun[]> {
    return db
      .select()
      .from(automationRuns)
      .where(and(eq(automationRuns.status, AutomationRunStatus.WAITING), lte(automationRuns.wakeAt, now)))
      .limit(limit);
  }

  /** Stops unfinished runs (e.g. when the automation is archived) so waiting steps never resume. */
  async cancelOpenRuns(automationId: number, reason: string): Promise<number> {
    const now = new Date();
    const rows = await db
      .update(automationRuns)
      .set({ status: AutomationRunStatus.CANCELLED, waitingFor: null, lastError: reason, completedAt: now, updatedAt: now })
      .where(
        and(
          eq(automationRuns.automationId, automationId),
          inArray(automationRuns.status, [AutomationRunStatus.RUNNING, AutomationRunStatus.WAITING])
        )
      )
      .returning({ id: automationRuns.id });
    return rows.length;
  }

  /** Total runs and the latest run per automation of the organization (one aggregate query). */
  async runStats(organizationId: number): Promise<Map<number, AutomationRunStats>> {
    const rows = await db.execute<{ automation_id: number; total: string | number; last_status: string | null; last_at: Date | string | null }>(sql`
      SELECT r.automation_id,
             count(*) AS total,
             (array_agg(r.status ORDER BY r.created_at DESC, r.id DESC))[1] AS last_status,
             max(r.created_at) AS last_at
        FROM automation_runs r
       WHERE r.organization_id = ${organizationId}
       GROUP BY r.automation_id`);
    const map = new Map<number, AutomationRunStats>();
    for (const r of rows as unknown as { automation_id: number; total: string | number; last_status: string | null; last_at: Date | string | null }[]) {
      map.set(Number(r.automation_id), {
        totalRuns: Number(r.total),
        lastRunStatus: r.last_status,
        lastRunAt: r.last_at ? new Date(r.last_at) : null,
      });
    }
    return map;
  }

  async countRuns(automationId: number): Promise<number> {
    const [row] = await db.select({ n: count() }).from(automationRuns).where(eq(automationRuns.automationId, automationId));
    return row?.n ?? 0;
  }

  /** Execution history, newest first, with the contact each run was for. */
  async listRuns(
    organizationId: number,
    automationId: number,
    filter: { status?: string; limit: number; offset: number }
  ): Promise<{ rows: AutomationRunWithContact[]; total: number }> {
    const conditions = [eq(automationRuns.organizationId, organizationId), eq(automationRuns.automationId, automationId)];
    if (filter.status) conditions.push(eq(automationRuns.status, filter.status));
    const where = and(...conditions);
    const [rows, [{ total }]] = await Promise.all([
      db
        .select({ run: automationRuns, customerName: customers.name, customerPhone: customers.phone })
        .from(automationRuns)
        .leftJoin(customers, eq(customers.id, automationRuns.customerId))
        .where(where)
        .orderBy(desc(automationRuns.createdAt), desc(automationRuns.id))
        .limit(filter.limit)
        .offset(filter.offset),
      db.select({ total: count() }).from(automationRuns).where(where),
    ]);
    return { rows: rows.map((r) => ({ ...r.run, customerName: r.customerName, customerPhone: r.customerPhone })), total };
  }

  async findRunForOrg(id: number, organizationId: number): Promise<AutomationRunWithContact | null> {
    const [row] = await db
      .select({ run: automationRuns, customerName: customers.name, customerPhone: customers.phone })
      .from(automationRuns)
      .leftJoin(customers, eq(customers.id, automationRuns.customerId))
      .where(and(eq(automationRuns.id, id), eq(automationRuns.organizationId, organizationId)))
      .limit(1);
    return row ? { ...row.run, customerName: row.customerName, customerPhone: row.customerPhone } : null;
  }
}

export const automationRepository = new AutomationRepository();
