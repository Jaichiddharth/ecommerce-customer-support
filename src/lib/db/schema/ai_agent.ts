import { pgTable, serial, integer, varchar, jsonb, boolean, timestamp, real, text, index, uniqueIndex } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { organizations } from "./organizations";
import { users } from "./users";
import { channels } from "./channels";

/**
 * One row per organisation: whether the AI agent is live and which policy version it runs.
 * The policy itself lives in `ai_agent_versions` (every save is a new version, so any older
 * configuration can be restored). Knowledge, runs and test cases live in the AI service's
 * own `ai` schema, keyed by workspace id `org_<organizationId>`.
 */
export const aiAgentConfigs = pgTable(
  "ai_agent_configs",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(false),
    liveVersionId: integer("live_version_id"),
    /** Bring your own model (Model tab): provider, model and the key, encrypted (never sent to the browser) */
    byoProvider: varchar("byo_provider", { length: 20 }),
    byoModel: varchar("byo_model", { length: 100 }),
    byoApiKey: text("byo_api_key"),
    /** Last characters of the key, shown as "••••abcd" */
    byoKeyHint: varchar("byo_key_hint", { length: 12 }),
    byoMonthlyLimitUsd: real("byo_monthly_limit_usd"),
    byoVerifiedAt: timestamp("byo_verified_at", { withTimezone: true, mode: "date" }),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("uq_ai_agent_configs_org").on(table.organizationId)],
);

export const aiAgentVersions = pgTable(
  "ai_agent_versions",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    policy: jsonb("policy").notNull(),
    note: varchar("note", { length: 200 }),
    createdById: integer("created_by_id").references(() => users.id, { onDelete: "set null" }),
    /** Pass rate (0-1) of the last test-set run made while this version was live. */
    testScore: real("test_score"),
    testRunId: varchar("test_run_id", { length: 40 }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("uq_ai_agent_versions_org_version").on(table.organizationId, table.version),
    index("idx_ai_agent_versions_org").on(table.organizationId, table.createdAt),
  ],
);

/**
 * The website chat widget (AI agent > Chat widget): one per organisation. `publicKey` identifies it in the
 * embed snippet and is not a secret; `settings` is normalised by src/lib/ai-agent/widget.ts.
 */
export const aiWidgets = pgTable(
  "ai_widgets",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    publicKey: varchar("public_key", { length: 40 }).notNull(),
    /** The inbox channel (type webchat) its visitor conversations belong to */
    channelId: integer("channel_id").references(() => channels.id, { onDelete: "set null" }),
    enabled: boolean("enabled").notNull().default(false),
    settings: jsonb("settings").notNull().default({}),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("uq_ai_widgets_org").on(table.organizationId), uniqueIndex("uq_ai_widgets_public_key").on(table.publicKey)],
);

/**
 * Sample data for testing the agent without a live store (AI agent > Test data): one row per kind and
 * organisation. `data` holds the normalised items (see src/lib/ai-agent/sample-data.ts):
 * kind "orders" → SampleCustomer[] (customers with their orders), kind "products" → SampleProduct[].
 */
export const aiSampleData = pgTable(
  "ai_sample_data",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    kind: varchar("kind", { length: 20 }).notNull(),
    data: jsonb("data").notNull(),
    itemCount: integer("item_count").notNull().default(0),
    fileName: varchar("file_name", { length: 200 }),
    updatedById: integer("updated_by_id").references(() => users.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("uq_ai_sample_data_org_kind").on(table.organizationId, table.kind)],
);

export const aiAgentConfigsRelations = relations(aiAgentConfigs, ({ one }) => ({
  organization: one(organizations, { fields: [aiAgentConfigs.organizationId], references: [organizations.id] }),
}));

export const aiAgentVersionsRelations = relations(aiAgentVersions, ({ one }) => ({
  organization: one(organizations, { fields: [aiAgentVersions.organizationId], references: [organizations.id] }),
  createdBy: one(users, { fields: [aiAgentVersions.createdById], references: [users.id] }),
}));

export type AiAgentConfig = typeof aiAgentConfigs.$inferSelect;
export type AiAgentVersion = typeof aiAgentVersions.$inferSelect;
export type AiWidget = typeof aiWidgets.$inferSelect;
export type AiSampleData = typeof aiSampleData.$inferSelect;
