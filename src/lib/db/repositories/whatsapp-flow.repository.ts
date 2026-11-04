import { db } from "..";
import { and, count, desc, eq, ilike, inArray, isNull, lte, max, ne, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { SortOrder } from "@/lib/listing";
import { containsPattern, dateRangeConditions, orderBySql } from "./list-helpers";
import {
  customers,
  whatsappFlows,
  whatsappFlowVersions,
  whatsappTemplates,
  whatsappFlowExecutions,
  whatsappFlowSubmissions,
  WaFlowExecutionStatus,
  type WhatsAppFlowRow,
  type WhatsAppFlowVersionRow,
  type WhatsAppTemplateRow,
  type WhatsAppFlowExecutionRow,
  type WhatsAppFlowSubmissionRow,
} from "../schema";

type FlowInsert = typeof whatsappFlows.$inferInsert;
type VersionInsert = typeof whatsappFlowVersions.$inferInsert;
type TemplateInsert = typeof whatsappTemplates.$inferInsert;
type ExecutionInsert = typeof whatsappFlowExecutions.$inferInsert;
type SubmissionInsert = typeof whatsappFlowSubmissions.$inferInsert;

export interface FlowListFilter {
  q?: string;
  status?: string;
  includeArchived?: boolean;
  limit: number;
  offset: number;
}

export const FLOW_SORT_KEYS = ["name", "status", "screens", "templates", "createdAt", "updatedAt"] as const;
export type FlowSortKey = (typeof FLOW_SORT_KEYS)[number];

export interface FlowListingFilter {
  q?: string;
  /** Empty = every status except archived. */
  status?: string;
  /** Created-at range. */
  fromDate?: Date;
  toDate?: Date;
  sortBy: FlowSortKey;
  sortOrder: SortOrder;
  limit: number;
  offset: number;
}

export interface FlowListingRow {
  id: number;
  name: string;
  categories: string[];
  jsonVersion: string;
  status: string;
  channelId: number | null;
  screensCount: number;
  hasUnpublishedChanges: boolean;
  publishedVersionId: number | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  metaFlowId: string | null;
  publishedVersionNumber: number | null;
  latestVersionNumber: number | null;
  templatesCount: number;
  submissionsCount: number;
}

export const TEMPLATE_SORT_KEYS = ["name", "status", "flow", "button", "createdAt", "updatedAt"] as const;
export type TemplateSortKey = (typeof TEMPLATE_SORT_KEYS)[number];

export interface TemplateListingFilter {
  flowId?: number;
  status?: string;
  /** Created-at range. */
  fromDate?: Date;
  toDate?: Date;
  sortBy: TemplateSortKey;
  sortOrder: SortOrder;
  limit: number;
  offset: number;
}

/** Template listing row: the template's own fields (without the Meta components payload) and its Flow / version. */
export type TemplateListingRow = Omit<WhatsAppTemplateRow, "components" | "flowButtonIndex" | "organizationId" | "createdById"> & {
  flowName: string | null;
  versionNumber: number | null;
  versionStatus: string | null;
  metaFlowId: string | null;
};

export const SUBMISSION_SORT_KEYS = ["submittedAt", "customer", "flow", "status"] as const;
export type SubmissionSortKey = (typeof SUBMISSION_SORT_KEYS)[number];

export interface SubmissionListFilter {
  flowId?: number;
  status?: string;
  /** Submitted-at range. */
  fromDate?: Date;
  toDate?: Date;
  sortBy?: SubmissionSortKey;
  sortOrder?: SortOrder;
  limit: number;
  offset: number;
}

export type SubmissionWithRefs = WhatsAppFlowSubmissionRow & {
  customerName: string | null;
  customerPhone: string | null;
  flowName: string | null;
  versionNumber: number | null;
  templateId: number | null;
  templateName: string | null;
  automationNodeId: string | null;
};

/** Persistence for WhatsApp Flows, versions, templates, executions and submissions. Org-scoped except Meta-id webhook lookups. */
export class WhatsAppFlowRepository {
  // ── Flows ───────────────────────────────────────────────────────────────

  async listFlows(organizationId: number, filter: FlowListFilter): Promise<{ rows: WhatsAppFlowRow[]; total: number }> {
    const conditions = [eq(whatsappFlows.organizationId, organizationId)];
    if (filter.q) conditions.push(ilike(whatsappFlows.name, `%${filter.q.replace(/[%_]/g, "\\$&")}%`));
    if (filter.status) conditions.push(eq(whatsappFlows.status, filter.status));
    else if (!filter.includeArchived) conditions.push(isNull(whatsappFlows.archivedAt));
    const where = and(...conditions);

    const [rows, [{ total }]] = await Promise.all([
      db.select().from(whatsappFlows).where(where).orderBy(desc(whatsappFlows.updatedAt)).limit(filter.limit).offset(filter.offset),
      db.select({ total: count() }).from(whatsappFlows).where(where),
    ]);
    return { rows, total };
  }

  /**
   * Flow listing page: only the columns the listing shows, with screen count, version numbers,
   * Meta Flow ID and template / submission counts computed in the same query. Filter, sort, count and
   * pagination run in the database.
   */
  async listFlowsPage(organizationId: number, f: FlowListingFilter): Promise<{ rows: FlowListingRow[]; total: number }> {
    const pv = alias(whatsappFlowVersions, "pv");
    const screens = sql<number>`coalesce(jsonb_array_length(case when jsonb_typeof(${whatsappFlows.draft}->'screens') = 'array' then ${whatsappFlows.draft}->'screens' end), 0)`;
    const templatesCount = sql<number>`(select count(*)::int from ${whatsappTemplates} t where t.flow_id = ${whatsappFlows.id} and t.organization_id = ${organizationId})`;
    const submissionsCount = sql<number>`(select count(*)::int from ${whatsappFlowSubmissions} s where s.flow_id = ${whatsappFlows.id} and s.organization_id = ${organizationId})`;
    const latestVersionNumber = sql<number | null>`(select v.version_number from ${whatsappFlowVersions} v where v.flow_id = ${whatsappFlows.id} order by v.version_number desc limit 1)`;
    const latestMetaFlowId = sql<string | null>`(select v.meta_flow_id from ${whatsappFlowVersions} v where v.flow_id = ${whatsappFlows.id} order by v.version_number desc limit 1)`;

    const sortColumns: Record<FlowSortKey, SQL> = {
      name: sql`lower(${whatsappFlows.name})`,
      status: sql`${whatsappFlows.status}`,
      screens,
      templates: templatesCount,
      createdAt: sql`${whatsappFlows.createdAt}`,
      updatedAt: sql`${whatsappFlows.updatedAt}`,
    };

    const conditions = [eq(whatsappFlows.organizationId, organizationId), ...dateRangeConditions(whatsappFlows.createdAt, f.fromDate, f.toDate)];
    if (f.q) conditions.push(ilike(whatsappFlows.name, containsPattern(f.q)));
    conditions.push(f.status ? eq(whatsappFlows.status, f.status) : isNull(whatsappFlows.archivedAt));
    const where = and(...conditions);

    const [rows, [{ total }]] = await Promise.all([
      db
        .select({
          id: whatsappFlows.id,
          name: whatsappFlows.name,
          categories: whatsappFlows.categories,
          jsonVersion: whatsappFlows.jsonVersion,
          status: whatsappFlows.status,
          channelId: whatsappFlows.channelId,
          screensCount: screens,
          hasUnpublishedChanges: whatsappFlows.hasUnpublishedChanges,
          publishedVersionId: whatsappFlows.publishedVersionId,
          archivedAt: whatsappFlows.archivedAt,
          createdAt: whatsappFlows.createdAt,
          updatedAt: whatsappFlows.updatedAt,
          publishedMetaFlowId: pv.metaFlowId,
          publishedVersionNumber: pv.versionNumber,
          latestMetaFlowId,
          latestVersionNumber,
          templatesCount,
          submissionsCount,
        })
        .from(whatsappFlows)
        .leftJoin(pv, and(eq(pv.id, whatsappFlows.publishedVersionId), eq(pv.organizationId, organizationId)))
        .where(where)
        .orderBy(...orderBySql(sortColumns, f.sortBy, f.sortOrder, whatsappFlows.id))
        .limit(f.limit)
        .offset(f.offset),
      db.select({ total: count() }).from(whatsappFlows).where(where),
    ]);

    return {
      rows: rows.map(({ publishedMetaFlowId, latestMetaFlowId: latestMeta, ...r }) => ({
        ...r,
        screensCount: Number(r.screensCount),
        templatesCount: Number(r.templatesCount),
        submissionsCount: Number(r.submissionsCount),
        latestVersionNumber: r.latestVersionNumber === null ? null : Number(r.latestVersionNumber),
        metaFlowId: publishedMetaFlowId ?? latestMeta ?? null,
      })),
      total,
    };
  }

  /** Every Flow of the organization (incl. archived) as id / name / status, for filter pickers. */
  async listFlowOptions(organizationId: number, limit = 500): Promise<{ id: number; name: string; status: string }[]> {
    return db
      .select({ id: whatsappFlows.id, name: whatsappFlows.name, status: whatsappFlows.status })
      .from(whatsappFlows)
      .where(eq(whatsappFlows.organizationId, organizationId))
      .orderBy(sql`lower(${whatsappFlows.name})`, whatsappFlows.id)
      .limit(limit);
  }

  async findFlow(id: number, organizationId: number): Promise<WhatsAppFlowRow | null> {
    const [row] = await db
      .select()
      .from(whatsappFlows)
      .where(and(eq(whatsappFlows.id, id), eq(whatsappFlows.organizationId, organizationId)))
      .limit(1);
    return row ?? null;
  }

  async findFlowsByIds(organizationId: number, ids: number[]): Promise<WhatsAppFlowRow[]> {
    if (!ids.length) return [];
    return db
      .select()
      .from(whatsappFlows)
      .where(and(eq(whatsappFlows.organizationId, organizationId), inArray(whatsappFlows.id, ids)));
  }

  async createFlow(data: FlowInsert): Promise<WhatsAppFlowRow> {
    const [row] = await db.insert(whatsappFlows).values(data).returning();
    return row;
  }

  async updateFlow(id: number, organizationId: number, data: Partial<FlowInsert>): Promise<WhatsAppFlowRow | null> {
    const [row] = await db
      .update(whatsappFlows)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(whatsappFlows.id, id), eq(whatsappFlows.organizationId, organizationId)))
      .returning();
    return row ?? null;
  }

  async deleteFlow(id: number, organizationId: number): Promise<void> {
    await db.delete(whatsappFlows).where(and(eq(whatsappFlows.id, id), eq(whatsappFlows.organizationId, organizationId)));
  }

  // ── Versions ────────────────────────────────────────────────────────────

  async listVersions(flowId: number, organizationId: number): Promise<WhatsAppFlowVersionRow[]> {
    return db
      .select()
      .from(whatsappFlowVersions)
      .where(and(eq(whatsappFlowVersions.flowId, flowId), eq(whatsappFlowVersions.organizationId, organizationId)))
      .orderBy(desc(whatsappFlowVersions.versionNumber));
  }

  async listVersionsForFlows(organizationId: number, flowIds: number[]): Promise<WhatsAppFlowVersionRow[]> {
    if (!flowIds.length) return [];
    return db
      .select()
      .from(whatsappFlowVersions)
      .where(and(eq(whatsappFlowVersions.organizationId, organizationId), inArray(whatsappFlowVersions.flowId, flowIds)))
      .orderBy(desc(whatsappFlowVersions.versionNumber));
  }

  async findVersion(id: number, organizationId: number): Promise<WhatsAppFlowVersionRow | null> {
    const [row] = await db
      .select()
      .from(whatsappFlowVersions)
      .where(and(eq(whatsappFlowVersions.id, id), eq(whatsappFlowVersions.organizationId, organizationId)))
      .limit(1);
    return row ?? null;
  }

  /** Webhook lookup: Meta Flow ids are globally unique. */
  async findVersionByMetaFlowId(metaFlowId: string): Promise<WhatsAppFlowVersionRow | null> {
    const [row] = await db.select().from(whatsappFlowVersions).where(eq(whatsappFlowVersions.metaFlowId, metaFlowId)).limit(1);
    return row ?? null;
  }

  async nextVersionNumber(flowId: number): Promise<number> {
    const [row] = await db
      .select({ n: max(whatsappFlowVersions.versionNumber) })
      .from(whatsappFlowVersions)
      .where(eq(whatsappFlowVersions.flowId, flowId));
    return (row?.n ?? 0) + 1;
  }

  async createVersion(data: VersionInsert): Promise<WhatsAppFlowVersionRow> {
    const [row] = await db.insert(whatsappFlowVersions).values(data).returning();
    return row;
  }

  async updateVersion(id: number, data: Partial<VersionInsert>): Promise<WhatsAppFlowVersionRow | null> {
    const [row] = await db
      .update(whatsappFlowVersions)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(whatsappFlowVersions.id, id))
      .returning();
    return row ?? null;
  }

  // ── Templates ───────────────────────────────────────────────────────────

  async listTemplates(organizationId: number, filter: { flowId?: number; status?: string } = {}): Promise<WhatsAppTemplateRow[]> {
    const conditions = [eq(whatsappTemplates.organizationId, organizationId)];
    if (filter.flowId) conditions.push(eq(whatsappTemplates.flowId, filter.flowId));
    if (filter.status) conditions.push(eq(whatsappTemplates.status, filter.status));
    return db.select().from(whatsappTemplates).where(and(...conditions)).orderBy(desc(whatsappTemplates.updatedAt));
  }

  /** Template listing page with its Flow name and version, filtered / sorted / counted / paginated in the database. */
  async listTemplatesPage(organizationId: number, f: TemplateListingFilter): Promise<{ rows: TemplateListingRow[]; total: number }> {
    const sortColumns: Record<TemplateSortKey, SQL> = {
      name: sql`lower(${whatsappTemplates.name})`,
      status: sql`${whatsappTemplates.status}`,
      flow: sql`lower(${whatsappFlows.name})`,
      button: sql`lower(${whatsappTemplates.flowButton}->>'text')`,
      createdAt: sql`${whatsappTemplates.createdAt}`,
      updatedAt: sql`${whatsappTemplates.updatedAt}`,
    };
    const conditions = [eq(whatsappTemplates.organizationId, organizationId), ...dateRangeConditions(whatsappTemplates.createdAt, f.fromDate, f.toDate)];
    if (f.flowId) conditions.push(eq(whatsappTemplates.flowId, f.flowId));
    if (f.status) conditions.push(eq(whatsappTemplates.status, f.status));
    const where = and(...conditions);

    const [rows, [{ total }]] = await Promise.all([
      db
        .select({
          id: whatsappTemplates.id,
          channelId: whatsappTemplates.channelId,
          wabaId: whatsappTemplates.wabaId,
          metaTemplateId: whatsappTemplates.metaTemplateId,
          name: whatsappTemplates.name,
          language: whatsappTemplates.language,
          category: whatsappTemplates.category,
          status: whatsappTemplates.status,
          rejectionReason: whatsappTemplates.rejectionReason,
          bodyText: whatsappTemplates.bodyText,
          headerText: whatsappTemplates.headerText,
          footerText: whatsappTemplates.footerText,
          flowId: whatsappTemplates.flowId,
          flowVersionId: whatsappTemplates.flowVersionId,
          flowButton: whatsappTemplates.flowButton,
          lastError: whatsappTemplates.lastError,
          lastSyncedAt: whatsappTemplates.lastSyncedAt,
          createdAt: whatsappTemplates.createdAt,
          updatedAt: whatsappTemplates.updatedAt,
          flowName: whatsappFlows.name,
          versionNumber: whatsappFlowVersions.versionNumber,
          versionStatus: whatsappFlowVersions.status,
          metaFlowId: whatsappFlowVersions.metaFlowId,
        })
        .from(whatsappTemplates)
        .leftJoin(whatsappFlows, and(eq(whatsappFlows.id, whatsappTemplates.flowId), eq(whatsappFlows.organizationId, organizationId)))
        .leftJoin(
          whatsappFlowVersions,
          and(eq(whatsappFlowVersions.id, whatsappTemplates.flowVersionId), eq(whatsappFlowVersions.organizationId, organizationId))
        )
        .where(where)
        .orderBy(...orderBySql(sortColumns, f.sortBy, f.sortOrder, whatsappTemplates.id))
        .limit(f.limit)
        .offset(f.offset),
      db.select({ total: count() }).from(whatsappTemplates).where(where),
    ]);
    return { rows, total };
  }

  async countTemplatesByFlow(organizationId: number, flowIds: number[]): Promise<Map<number, number>> {
    if (!flowIds.length) return new Map();
    const rows = await db
      .select({ flowId: whatsappTemplates.flowId, n: count() })
      .from(whatsappTemplates)
      .where(and(eq(whatsappTemplates.organizationId, organizationId), inArray(whatsappTemplates.flowId, flowIds)))
      .groupBy(whatsappTemplates.flowId);
    return new Map(rows.map((r) => [r.flowId!, r.n]));
  }

  async findTemplate(id: number, organizationId: number): Promise<WhatsAppTemplateRow | null> {
    const [row] = await db
      .select()
      .from(whatsappTemplates)
      .where(and(eq(whatsappTemplates.id, id), eq(whatsappTemplates.organizationId, organizationId)))
      .limit(1);
    return row ?? null;
  }

  async findTemplateByName(wabaId: string, name: string, language: string): Promise<WhatsAppTemplateRow | null> {
    const [row] = await db
      .select()
      .from(whatsappTemplates)
      .where(and(eq(whatsappTemplates.wabaId, wabaId), eq(whatsappTemplates.name, name), eq(whatsappTemplates.language, language)))
      .limit(1);
    return row ?? null;
  }

  /** Webhook lookup: Meta template ids are globally unique. */
  async findTemplateByMetaId(metaTemplateId: string): Promise<WhatsAppTemplateRow | null> {
    const [row] = await db.select().from(whatsappTemplates).where(eq(whatsappTemplates.metaTemplateId, metaTemplateId)).limit(1);
    return row ?? null;
  }

  async createTemplate(data: TemplateInsert): Promise<WhatsAppTemplateRow> {
    const [row] = await db.insert(whatsappTemplates).values(data).returning();
    return row;
  }

  async updateTemplate(id: number, data: Partial<TemplateInsert>): Promise<WhatsAppTemplateRow | null> {
    const [row] = await db
      .update(whatsappTemplates)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(whatsappTemplates.id, id))
      .returning();
    return row ?? null;
  }

  async deleteTemplate(id: number, organizationId: number): Promise<void> {
    await db.delete(whatsappTemplates).where(and(eq(whatsappTemplates.id, id), eq(whatsappTemplates.organizationId, organizationId)));
  }

  // ── Executions ──────────────────────────────────────────────────────────

  async createExecution(data: ExecutionInsert): Promise<WhatsAppFlowExecutionRow> {
    const [row] = await db.insert(whatsappFlowExecutions).values(data).returning();
    return row;
  }

  async updateExecution(id: number, data: Partial<ExecutionInsert>): Promise<WhatsAppFlowExecutionRow | null> {
    const [row] = await db
      .update(whatsappFlowExecutions)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(whatsappFlowExecutions.id, id))
      .returning();
    return row ?? null;
  }

  /** Atomically marks an execution completed; returns null if it was already completed (retry / race). */
  async completeExecution(id: number): Promise<WhatsAppFlowExecutionRow | null> {
    const now = new Date();
    const [row] = await db
      .update(whatsappFlowExecutions)
      .set({ status: WaFlowExecutionStatus.COMPLETED, completedAt: now, updatedAt: now })
      .where(and(eq(whatsappFlowExecutions.id, id), ne(whatsappFlowExecutions.status, WaFlowExecutionStatus.COMPLETED)))
      .returning();
    return row ?? null;
  }

  async findExecution(id: number, organizationId: number): Promise<WhatsAppFlowExecutionRow | null> {
    const [row] = await db
      .select()
      .from(whatsappFlowExecutions)
      .where(and(eq(whatsappFlowExecutions.id, id), eq(whatsappFlowExecutions.organizationId, organizationId)))
      .limit(1);
    return row ?? null;
  }

  /** Resolve the execution a Flow response belongs to: by flow_token, else by the wamid the customer replied to. */
  async findExecutionForReply(
    organizationId: number,
    ref: { flowToken?: string | null; contextWamid?: string | null }
  ): Promise<WhatsAppFlowExecutionRow | null> {
    const keys = [];
    if (ref.flowToken) keys.push(eq(whatsappFlowExecutions.flowToken, ref.flowToken));
    if (ref.contextWamid) keys.push(eq(whatsappFlowExecutions.metaMessageId, ref.contextWamid));
    if (!keys.length) return null;
    const rows = await db
      .select()
      .from(whatsappFlowExecutions)
      .where(and(eq(whatsappFlowExecutions.organizationId, organizationId), or(...keys)))
      .limit(2);
    // Prefer the token match: it is the stronger association
    return rows.find((r) => r.flowToken === ref.flowToken) ?? rows[0] ?? null;
  }

  async countExecutionsByFlow(flowId: number): Promise<number> {
    const [row] = await db.select({ n: count() }).from(whatsappFlowExecutions).where(eq(whatsappFlowExecutions.flowId, flowId));
    return row?.n ?? 0;
  }

  /** Sent executions past their expiry (no response) — marked expired by the sweep. */
  async expireOverdueExecutions(now: Date): Promise<WhatsAppFlowExecutionRow[]> {
    return db
      .update(whatsappFlowExecutions)
      .set({ status: WaFlowExecutionStatus.EXPIRED, updatedAt: now })
      .where(and(eq(whatsappFlowExecutions.status, WaFlowExecutionStatus.SENT), lte(whatsappFlowExecutions.expiresAt, now)))
      .returning();
  }

  // ── Submissions ─────────────────────────────────────────────────────────

  /** Insert once per (org, wamid). Returns null when this webhook message was already stored (retry). */
  async insertSubmission(data: SubmissionInsert): Promise<WhatsAppFlowSubmissionRow | null> {
    const [row] = await db
      .insert(whatsappFlowSubmissions)
      .values(data)
      .onConflictDoNothing()
      .returning();
    return row ?? null;
  }

  async updateSubmission(id: number, data: Partial<SubmissionInsert>): Promise<void> {
    await db.update(whatsappFlowSubmissions).set({ ...data, updatedAt: new Date() }).where(eq(whatsappFlowSubmissions.id, id));
  }

  async findSubmissionByExecution(executionId: number): Promise<WhatsAppFlowSubmissionRow | null> {
    const [row] = await db
      .select()
      .from(whatsappFlowSubmissions)
      .where(eq(whatsappFlowSubmissions.executionId, executionId))
      .limit(1);
    return row ?? null;
  }

  /** Submissions stored but never processed (e.g. the process stopped before resuming the automation). */
  async listStaleReceivedSubmissions(olderThan: Date, limit = 25): Promise<WhatsAppFlowSubmissionRow[]> {
    return db
      .select()
      .from(whatsappFlowSubmissions)
      .where(and(eq(whatsappFlowSubmissions.processingStatus, "received"), lte(whatsappFlowSubmissions.createdAt, olderThan)))
      .limit(limit);
  }

  async listSubmissions(organizationId: number, filter: SubmissionListFilter): Promise<{ rows: SubmissionWithRefs[]; total: number }> {
    const conditions = [
      eq(whatsappFlowSubmissions.organizationId, organizationId),
      ...dateRangeConditions(whatsappFlowSubmissions.submittedAt, filter.fromDate, filter.toDate),
    ];
    if (filter.flowId) conditions.push(eq(whatsappFlowSubmissions.flowId, filter.flowId));
    if (filter.status) conditions.push(eq(whatsappFlowSubmissions.processingStatus, filter.status));
    const where = and(...conditions);
    const sortColumns: Record<SubmissionSortKey, SQL> = {
      submittedAt: sql`${whatsappFlowSubmissions.submittedAt}`,
      customer: sql`lower(${customers.name})`,
      flow: sql`lower(${whatsappFlows.name})`,
      status: sql`${whatsappFlowSubmissions.processingStatus}`,
    };

    const [rows, [{ total }]] = await Promise.all([
      db
        .select({
          submission: whatsappFlowSubmissions,
          customerName: customers.name,
          customerPhone: customers.phone,
          flowName: whatsappFlows.name,
          versionNumber: whatsappFlowVersions.versionNumber,
          templateId: whatsappFlowExecutions.templateId,
          templateName: whatsappTemplates.name,
          automationNodeId: whatsappFlowExecutions.automationNodeId,
        })
        .from(whatsappFlowSubmissions)
        .leftJoin(customers, eq(customers.id, whatsappFlowSubmissions.customerId))
        .leftJoin(whatsappFlows, eq(whatsappFlows.id, whatsappFlowSubmissions.flowId))
        .leftJoin(whatsappFlowVersions, eq(whatsappFlowVersions.id, whatsappFlowSubmissions.flowVersionId))
        .leftJoin(whatsappFlowExecutions, eq(whatsappFlowExecutions.id, whatsappFlowSubmissions.executionId))
        .leftJoin(whatsappTemplates, eq(whatsappTemplates.id, whatsappFlowExecutions.templateId))
        .where(where)
        .orderBy(...orderBySql(sortColumns, filter.sortBy ?? "submittedAt", filter.sortOrder ?? "desc", whatsappFlowSubmissions.id))
        .limit(filter.limit)
        .offset(filter.offset),
      db.select({ total: count() }).from(whatsappFlowSubmissions).where(where),
    ]);

    return {
      rows: rows.map((r) => ({
        ...r.submission,
        customerName: r.customerName,
        customerPhone: r.customerPhone,
        flowName: r.flowName,
        versionNumber: r.versionNumber,
        templateId: r.templateId,
        templateName: r.templateName,
        automationNodeId: r.automationNodeId,
      })),
      total,
    };
  }

  async countSubmissionsByFlow(organizationId: number, flowIds: number[]): Promise<Map<number, number>> {
    if (!flowIds.length) return new Map();
    const rows = await db
      .select({ flowId: whatsappFlowSubmissions.flowId, n: count() })
      .from(whatsappFlowSubmissions)
      .where(and(eq(whatsappFlowSubmissions.organizationId, organizationId), inArray(whatsappFlowSubmissions.flowId, flowIds)))
      .groupBy(whatsappFlowSubmissions.flowId);
    return new Map(rows.map((r) => [r.flowId!, r.n]));
  }

  /** Last inbound message time for the 24-hour customer service window check. */
  async lastCustomerMessageAt(organizationId: number, customerId: number): Promise<Date | null> {
    const result = await db.execute<{ at: Date | string | null }>(
      sql`SELECT max(created_at) AS at FROM messages WHERE organization_id = ${organizationId} AND customer_id = ${customerId} AND sender_type = 'customer'`
    );
    const at = (result as unknown as { at: Date | string | null }[])[0]?.at;
    return at ? new Date(at) : null;
  }
}

export const whatsappFlowRepository = new WhatsAppFlowRepository();
