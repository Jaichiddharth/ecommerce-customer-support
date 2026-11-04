import { db } from "..";
import { and, count, desc, eq, inArray, lte, sql, type SQL } from "drizzle-orm";
import type { SortOrder } from "@/lib/listing";
import { containsPattern, dateRangeConditions, orderBySql } from "./list-helpers";
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

export type AutomationRunWithContact = AutomationRun & { customerName: string | null; customerPhone: string | null };

export const RUN_SORT_KEYS = ["createdAt", "status", "customer"] as const;
export type RunSortKey = (typeof RUN_SORT_KEYS)[number];

export const AUTOMATION_SORT_KEYS = ["name", "status", "trigger", "nodes", "updatedAt", "lastRunAt", "totalRuns", "createdAt"] as const;
export type AutomationSortKey = (typeof AUTOMATION_SORT_KEYS)[number];

export interface AutomationListingFilter {
  q?: string;
  /** Derived listing status; empty = every status except archived. */
  status?: string;
  trigger?: string;
  /** Status of the most recent run, or "never". */
  execution?: string;
  /** Last modified (updated_at) range. */
  fromDate?: Date;
  toDate?: Date;
  sortBy: AutomationSortKey;
  sortOrder: SortOrder;
  limit: number;
  offset: number;
}

export interface AutomationListingRow {
  id: number;
  name: string;
  description: string | null;
  status: string;
  isActive: boolean;
  triggerType: string;
  nodeCount: number;
  totalRuns: number;
  lastRunStatus: string | null;
  lastRunAt: Date | null;
  activatedAt: Date | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// Sort keys → columns of the `listing` CTE below (fixed identifiers, never user input)
const AUTOMATION_SORT_COLUMNS: Record<AutomationSortKey, SQL> = {
  name: sql`lower(name)`,
  status: sql`status`,
  trigger: sql`trigger_type`,
  nodes: sql`node_count`,
  updatedAt: sql`updated_at`,
  lastRunAt: sql`last_run_at`,
  totalRuns: sql`total_runs`,
  createdAt: sql`created_at`,
};

const toDate = (v: Date | string | null) => (v ? new Date(v) : null);

export class AutomationRepository {
  async list(organizationId: number): Promise<Automation[]> {
    return db.select().from(automations).where(eq(automations.organizationId, organizationId)).orderBy(desc(automations.updatedAt));
  }

  /**
   * Listing page with the derived values the UI shows (status, trigger, node count, run stats), all
   * computed, filtered, sorted, counted and paginated in Postgres. The graph itself is never returned.
   *  - status: archived > active (or failed, when active and the latest run failed) > paused (activated before) > draft
   *  - trigger: the first trigger_* node of the graph
   */
  async listingPage(organizationId: number, f: AutomationListingFilter): Promise<{ rows: AutomationListingRow[]; total: number }> {
    const listing = sql`
      SELECT a.id, a.name, a.description, a.is_active, a.activated_at, a.archived_at, a.created_at, a.updated_at,
             jsonb_array_length(g.nodes) AS node_count,
             CASE (SELECT n.value->'data'->>'type'
                     FROM jsonb_array_elements(g.nodes) WITH ORDINALITY AS n(value, ord)
                    WHERE left(n.value->'data'->>'type', 8) = 'trigger_'
                    ORDER BY n.ord LIMIT 1)
               WHEN 'trigger_incoming_message' THEN 'incoming_message'
               WHEN 'trigger_keyword' THEN 'keyword'
               WHEN 'trigger_conversation_event' THEN 'conversation_event'
               ELSE 'none'
             END AS trigger_type,
             COALESCE(rc.total, 0) AS total_runs,
             lr.status AS last_run_status,
             lr.created_at AS last_run_at,
             CASE
               WHEN a.archived_at IS NOT NULL THEN 'archived'
               WHEN a.is_active THEN CASE WHEN lr.status = 'failed' THEN 'failed' ELSE 'active' END
               WHEN a.activated_at IS NOT NULL THEN 'paused'
               ELSE 'draft'
             END AS status
        FROM ${automations} a
        CROSS JOIN LATERAL (
          SELECT CASE WHEN jsonb_typeof(a.graph->'nodes') = 'array' THEN a.graph->'nodes' ELSE '[]'::jsonb END AS nodes
        ) g
        LEFT JOIN LATERAL (
          SELECT r.status, r.created_at FROM ${automationRuns} r
           WHERE r.automation_id = a.id
           ORDER BY r.created_at DESC, r.id DESC
           LIMIT 1
        ) lr ON true
        LEFT JOIN LATERAL (
          SELECT count(*)::int AS total FROM ${automationRuns} r WHERE r.automation_id = a.id
        ) rc ON true
       WHERE a.organization_id = ${organizationId}`;

    const conditions: SQL[] = [];
    if (f.q) conditions.push(sql`name ILIKE ${containsPattern(f.q)}`);
    conditions.push(f.status ? sql`status = ${f.status}` : sql`status <> 'archived'`);
    if (f.trigger) conditions.push(sql`trigger_type = ${f.trigger}`);
    if (f.execution === "never") conditions.push(sql`total_runs = 0`);
    else if (f.execution) conditions.push(sql`last_run_status = ${f.execution}`);
    // Dates go in as ISO strings: the postgres-js driver is configured by Drizzle to not serialize Date params in raw SQL
    if (f.fromDate) conditions.push(sql`updated_at >= ${f.fromDate.toISOString()}::timestamptz`);
    if (f.toDate) conditions.push(sql`updated_at <= ${f.toDate.toISOString()}::timestamptz`);
    const where = sql.join(conditions, sql` AND `);
    const orderBy = sql.join(orderBySql(AUTOMATION_SORT_COLUMNS, f.sortBy, f.sortOrder, sql`id`), sql`, `);

    type Raw = {
      id: number; name: string; description: string | null; is_active: boolean;
      activated_at: Date | string | null; archived_at: Date | string | null; created_at: Date | string; updated_at: Date | string;
      node_count: number; trigger_type: string; total_runs: number; last_run_status: string | null; last_run_at: Date | string | null; status: string;
    };
    const [rows, counted] = await Promise.all([
      db.execute<Raw>(sql`WITH listing AS (${listing}) SELECT * FROM listing WHERE ${where} ORDER BY ${orderBy} LIMIT ${f.limit} OFFSET ${f.offset}`),
      db.execute<{ total: number }>(sql`WITH listing AS (${listing}) SELECT count(*)::int AS total FROM listing WHERE ${where}`),
    ]);

    return {
      rows: (rows as unknown as Raw[]).map((r) => ({
        id: Number(r.id),
        name: r.name,
        description: r.description,
        status: r.status,
        isActive: r.is_active,
        triggerType: r.trigger_type,
        nodeCount: Number(r.node_count),
        totalRuns: Number(r.total_runs),
        lastRunStatus: r.last_run_status,
        lastRunAt: toDate(r.last_run_at),
        activatedAt: toDate(r.activated_at),
        archivedAt: toDate(r.archived_at),
        createdAt: new Date(r.created_at),
        updatedAt: new Date(r.updated_at),
      })),
      total: Number((counted as unknown as { total: number }[])[0]?.total ?? 0),
    };
  }

  /** Automations whose graph references any of these Flows (Send WhatsApp Flow nodes). */
  async listReferencingFlows(organizationId: number, flowIds: number[]): Promise<Automation[]> {
    if (!flowIds.length) return [];
    const ids = flowIds.map(String);
    return db
      .select()
      .from(automations)
      .where(
        and(
          eq(automations.organizationId, organizationId),
          sql`EXISTS (
            SELECT 1
              FROM jsonb_array_elements(CASE WHEN jsonb_typeof(${automations.graph}->'nodes') = 'array' THEN ${automations.graph}->'nodes' ELSE '[]'::jsonb END) n
             WHERE n->'data'->>'flowId' IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)}))`
        )
      );
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

  async countRuns(automationId: number): Promise<number> {
    const [row] = await db.select({ n: count() }).from(automationRuns).where(eq(automationRuns.automationId, automationId));
    return row?.n ?? 0;
  }

  /** Execution history, newest first, with the contact each run was for. */
  async listRuns(
    organizationId: number,
    automationId: number,
    filter: { status?: string; fromDate?: Date; toDate?: Date; sortBy?: RunSortKey; sortOrder?: SortOrder; limit: number; offset: number }
  ): Promise<{ rows: AutomationRunWithContact[]; total: number }> {
    const conditions = [
      eq(automationRuns.organizationId, organizationId),
      eq(automationRuns.automationId, automationId),
      ...dateRangeConditions(automationRuns.createdAt, filter.fromDate, filter.toDate),
    ];
    if (filter.status) conditions.push(eq(automationRuns.status, filter.status));
    const where = and(...conditions);
    const sortColumns: Record<RunSortKey, SQL> = {
      createdAt: sql`${automationRuns.createdAt}`,
      status: sql`${automationRuns.status}`,
      customer: sql`lower(${customers.name})`,
    };
    const [rows, [{ total }]] = await Promise.all([
      db
        .select({ run: automationRuns, customerName: customers.name, customerPhone: customers.phone })
        .from(automationRuns)
        .leftJoin(customers, eq(customers.id, automationRuns.customerId))
        .where(where)
        .orderBy(...orderBySql(sortColumns, filter.sortBy ?? "createdAt", filter.sortOrder ?? "desc", automationRuns.id))
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
