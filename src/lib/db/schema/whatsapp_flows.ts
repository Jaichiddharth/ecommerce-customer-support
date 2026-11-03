import { pgTable, serial, integer, varchar, text, boolean, jsonb, timestamp, index, uniqueIndex, foreignKey } from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { organizations } from "./organizations";
import { channels } from "./channels";
import { customers } from "./customers";
import { users } from "./users";
import type { MetaFlowJson, WaFlow } from "../../whatsapp-flows/wa-flow-types";

/**
 * WhatsApp (Meta) Flows.
 *
 *  whatsapp_flows            the merchant's Flow: metadata + the editable draft (internal editor model)
 *  whatsapp_flow_versions    immutable published snapshots; each one is its own Meta Flow (published Meta
 *                            Flows can't be edited, so a new version is created by cloning the previous one)
 *  whatsapp_templates        Meta message templates created here; a FLOW button pins one flow *version*
 *  whatsapp_flow_executions  one Flow sent to one customer, identified by a unique flow_token
 *  whatsapp_flow_submissions the customer's completed response (nfm_reply), deduplicated by wamid
 */

/** Overall Flow state shown in the listing (derived from its versions; `archived` is merchant-set). */
export const WaFlowStatus = {
  DRAFT: "draft", // never published
  PUBLISHING: "publishing",
  PUBLISHED: "published", // has a live published version
  FAILED: "failed", // last publish attempt failed and nothing is published
  DEPRECATED: "deprecated", // every published version was deprecated
  ARCHIVED: "archived",
} as const;
export type WaFlowStatusValue = (typeof WaFlowStatus)[keyof typeof WaFlowStatus];

/** Version state; mirrors Meta Flow statuses plus our own in-flight / failure states. */
export const WaFlowVersionStatus = {
  PUBLISHING: "publishing", // created locally, Meta calls in progress (or interrupted — retry is safe)
  DRAFT: "draft", // exists at Meta as DRAFT (validation passed, publish not done yet)
  PUBLISHED: "published",
  THROTTLED: "throttled",
  BLOCKED: "blocked",
  DEPRECATED: "deprecated",
  FAILED: "failed", // validation or publish rejected by Meta
} as const;
export type WaFlowVersionStatusValue = (typeof WaFlowVersionStatus)[keyof typeof WaFlowVersionStatus];

/** Versions customers can still be sent (Meta allows sending PUBLISHED and, rate-limited, THROTTLED). */
export const SENDABLE_VERSION_STATUSES: WaFlowVersionStatusValue[] = [WaFlowVersionStatus.PUBLISHED, WaFlowVersionStatus.THROTTLED];

export const META_FLOW_CATEGORIES = [
  "SIGN_UP",
  "SIGN_IN",
  "APPOINTMENT_BOOKING",
  "LEAD_GENERATION",
  "CONTACT_US",
  "CUSTOMER_SUPPORT",
  "SURVEY",
  "OTHER",
] as const;
export type MetaFlowCategory = (typeof META_FLOW_CATEGORIES)[number];

export interface MetaValidationError {
  error?: string;
  error_type?: string;
  message?: string;
  line_start?: number;
  line_end?: number;
  column_start?: number;
  column_end?: number;
  pointers?: unknown[];
}

export const whatsappFlows = pgTable(
  "whatsapp_flows",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    // The WhatsApp number (and so the WABA + token) this Flow is published under
    channelId: integer("channel_id").references(() => channels.id, { onDelete: "set null" }),
    name: varchar("name", { length: 200 }).notNull(),
    categories: text("categories").array().default(sql`'{OTHER}'::text[]`).notNull(),
    jsonVersion: varchar("json_version", { length: 10 }).notNull(),
    // Internal editor model (never sent to Meta as-is)
    draft: jsonb("draft").$type<WaFlow>().notNull(),
    // True when the draft differs from the latest version (edited since the last publish)
    hasUnpublishedChanges: boolean("has_unpublished_changes").default(true).notNull(),
    status: varchar("status", { length: 20 }).default(WaFlowStatus.DRAFT).notNull(),
    publishedVersionId: integer("published_version_id"), // latest sendable version (FK kept loose to avoid a cycle)
    createdById: integer("created_by_id").references(() => users.id, { onDelete: "set null" }),
    archivedAt: timestamp("archived_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_wa_flows_org_status").on(table.organizationId, table.status),
    index("idx_wa_flows_org_updated").on(table.organizationId, table.updatedAt.desc()),
  ]
);

export const whatsappFlowVersions = pgTable(
  "whatsapp_flow_versions",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    flowId: integer("flow_id")
      .notNull()
      .references(() => whatsappFlows.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    wabaId: varchar("waba_id", { length: 100 }).notNull(),
    metaFlowId: varchar("meta_flow_id", { length: 100 }),
    metaFlowName: varchar("meta_flow_name", { length: 255 }).notNull(),
    jsonVersion: varchar("json_version", { length: 10 }).notNull(),
    definition: jsonb("definition").$type<WaFlow>().notNull(), // editor model snapshot
    flowJson: jsonb("flow_json").$type<MetaFlowJson>().notNull(), // exact JSON uploaded to Meta
    status: varchar("status", { length: 20 }).default(WaFlowVersionStatus.PUBLISHING).notNull(),
    validationErrors: jsonb("validation_errors").$type<MetaValidationError[]>().default(sql`'[]'::jsonb`).notNull(),
    metaResponse: jsonb("meta_response").$type<Record<string, unknown>>(), // last Meta payload (status/health)
    lastError: text("last_error"),
    publishedAt: timestamp("published_at", { withTimezone: true, mode: "date" }),
    deprecatedAt: timestamp("deprecated_at", { withTimezone: true, mode: "date" }),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true, mode: "date" }),
    createdById: integer("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("uq_wa_flow_versions_flow_number").on(table.flowId, table.versionNumber),
    uniqueIndex("uq_wa_flow_versions_meta_flow_id").on(table.metaFlowId).where(sql`${table.metaFlowId} IS NOT NULL`),
    index("idx_wa_flow_versions_org_status").on(table.organizationId, table.status),
  ]
);

export interface WaTemplateFlowButton {
  text: string;
  flowAction: "navigate";
  navigateScreen: string; // Meta screen id of the first screen
}

export const whatsappTemplates = pgTable(
  "whatsapp_templates",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    channelId: integer("channel_id").references(() => channels.id, { onDelete: "set null" }),
    wabaId: varchar("waba_id", { length: 100 }).notNull(),
    metaTemplateId: varchar("meta_template_id", { length: 100 }),
    name: varchar("name", { length: 512 }).notNull(),
    language: varchar("language", { length: 20 }).notNull(),
    category: varchar("category", { length: 30 }).notNull(), // MARKETING | UTILITY
    // Meta status: PENDING, APPROVED, REJECTED, PAUSED, DISABLED, IN_APPEAL, ARCHIVED, DELETED, …
    status: varchar("status", { length: 30 }).default("PENDING").notNull(),
    rejectionReason: text("rejection_reason"),
    bodyText: text("body_text").notNull(),
    headerText: varchar("header_text", { length: 60 }),
    footerText: varchar("footer_text", { length: 60 }),
    components: jsonb("components").$type<Record<string, unknown>[]>().notNull(), // exact components sent to Meta
    // Flow association (a template pins one published version; one Flow → many templates)
    flowId: integer("flow_id").references(() => whatsappFlows.id, { onDelete: "set null" }),
    flowVersionId: integer("flow_version_id").references(() => whatsappFlowVersions.id, { onDelete: "set null" }),
    flowButton: jsonb("flow_button").$type<WaTemplateFlowButton>(),
    flowButtonIndex: integer("flow_button_index"),
    lastError: text("last_error"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true, mode: "date" }),
    createdById: integer("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("uq_wa_templates_meta_id").on(table.metaTemplateId).where(sql`${table.metaTemplateId} IS NOT NULL`),
    uniqueIndex("uq_wa_templates_waba_name_lang").on(table.wabaId, table.name, table.language),
    index("idx_wa_templates_org_status").on(table.organizationId, table.status),
    index("idx_wa_templates_flow").on(table.flowId),
  ]
);

export const WaFlowExecutionStatus = {
  PENDING: "pending", // token issued, message not yet accepted by Meta
  SENT: "sent",
  COMPLETED: "completed",
  EXPIRED: "expired",
  FAILED: "failed",
} as const;
export type WaFlowExecutionStatusValue = (typeof WaFlowExecutionStatus)[keyof typeof WaFlowExecutionStatus];

export const whatsappFlowExecutions = pgTable(
  "whatsapp_flow_executions",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    flowId: integer("flow_id")
      .notNull()
      .references(() => whatsappFlows.id, { onDelete: "cascade" }),
    flowVersionId: integer("flow_version_id").notNull(), // FK named below (default name exceeds 63 chars)
    customerId: integer("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    channelId: integer("channel_id").references(() => channels.id, { onDelete: "set null" }),
    templateId: integer("template_id").references(() => whatsappTemplates.id, { onDelete: "set null" }),
    automationRunId: integer("automation_run_id"), // loose reference: runs may be pruned independently
    automationNodeId: varchar("automation_node_id", { length: 100 }),
    sendMethod: varchar("send_method", { length: 20 }).notNull(), // 'template' | 'interactive'
    flowToken: varchar("flow_token", { length: 100 }).notNull(),
    metaMessageId: varchar("meta_message_id", { length: 255 }), // wamid of the message carrying the Flow
    status: varchar("status", { length: 20 }).default(WaFlowExecutionStatus.PENDING).notNull(),
    lastError: text("last_error"),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
    sentAt: timestamp("sent_at", { withTimezone: true, mode: "date" }),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
    createdById: integer("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({ name: "wa_flow_exec_version_fk", columns: [table.flowVersionId], foreignColumns: [whatsappFlowVersions.id] }).onDelete("cascade"),
    uniqueIndex("uq_wa_flow_exec_token").on(table.flowToken),
    index("idx_wa_flow_exec_meta_message").on(table.metaMessageId),
    index("idx_wa_flow_exec_org_customer").on(table.organizationId, table.customerId),
    index("idx_wa_flow_exec_run").on(table.automationRunId),
    index("idx_wa_flow_exec_status_expiry").on(table.status, table.expiresAt),
  ]
);

export const WaSubmissionStatus = {
  RECEIVED: "received",
  PROCESSED: "processed", // matched to an execution (and the automation resumed, if any)
  UNMATCHED: "unmatched", // no execution for this token / reply context
  FAILED: "failed",
} as const;

export const whatsappFlowSubmissions = pgTable(
  "whatsapp_flow_submissions",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    executionId: integer("execution_id"), // FKs named below (default names exceed 63 chars)
    flowId: integer("flow_id").references(() => whatsappFlows.id, { onDelete: "set null" }),
    flowVersionId: integer("flow_version_id"),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    channelId: integer("channel_id").references(() => channels.id, { onDelete: "set null" }),
    metaMessageId: varchar("meta_message_id", { length: 255 }).notNull(), // wamid of the nfm_reply (idempotency key)
    flowToken: varchar("flow_token", { length: 100 }),
    response: jsonb("response").$type<Record<string, unknown>>().notNull(), // parsed response_json (minus flow_token)
    processingStatus: varchar("processing_status", { length: 20 }).default(WaSubmissionStatus.RECEIVED).notNull(),
    automationRunId: integer("automation_run_id"),
    lastError: text("last_error"),
    submittedAt: timestamp("submitted_at", { withTimezone: true, mode: "date" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({ name: "wa_flow_sub_execution_fk", columns: [table.executionId], foreignColumns: [whatsappFlowExecutions.id] }).onDelete("set null"),
    foreignKey({ name: "wa_flow_sub_version_fk", columns: [table.flowVersionId], foreignColumns: [whatsappFlowVersions.id] }).onDelete("set null"),
    uniqueIndex("uq_wa_flow_sub_meta_message").on(table.organizationId, table.metaMessageId),
    // One submission per execution, so a retried webhook can never resume an automation twice
    uniqueIndex("uq_wa_flow_sub_execution").on(table.executionId).where(sql`${table.executionId} IS NOT NULL`),
    index("idx_wa_flow_sub_org_flow").on(table.organizationId, table.flowId, table.submittedAt.desc()),
    index("idx_wa_flow_sub_org_submitted").on(table.organizationId, table.submittedAt.desc()),
  ]
);

export const whatsappFlowsRelations = relations(whatsappFlows, ({ one, many }) => ({
  organization: one(organizations, { fields: [whatsappFlows.organizationId], references: [organizations.id] }),
  channel: one(channels, { fields: [whatsappFlows.channelId], references: [channels.id] }),
  versions: many(whatsappFlowVersions),
  templates: many(whatsappTemplates),
}));

export const whatsappFlowVersionsRelations = relations(whatsappFlowVersions, ({ one }) => ({
  flow: one(whatsappFlows, { fields: [whatsappFlowVersions.flowId], references: [whatsappFlows.id] }),
}));

export const whatsappTemplatesRelations = relations(whatsappTemplates, ({ one }) => ({
  flow: one(whatsappFlows, { fields: [whatsappTemplates.flowId], references: [whatsappFlows.id] }),
  flowVersion: one(whatsappFlowVersions, { fields: [whatsappTemplates.flowVersionId], references: [whatsappFlowVersions.id] }),
  channel: one(channels, { fields: [whatsappTemplates.channelId], references: [channels.id] }),
}));

export type WhatsAppFlowRow = typeof whatsappFlows.$inferSelect;
export type WhatsAppFlowVersionRow = typeof whatsappFlowVersions.$inferSelect;
export type WhatsAppTemplateRow = typeof whatsappTemplates.$inferSelect;
export type WhatsAppFlowExecutionRow = typeof whatsappFlowExecutions.$inferSelect;
export type WhatsAppFlowSubmissionRow = typeof whatsappFlowSubmissions.$inferSelect;
