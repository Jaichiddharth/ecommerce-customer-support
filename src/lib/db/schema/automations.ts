import { pgTable, serial, integer, varchar, text, boolean, jsonb, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { organizations } from "./organizations";
import { customers } from "./customers";
import { channels } from "./channels";
import { users } from "./users";

/**
 * Automations built with the node-based Automation Builder.
 * `graph` is the builder's own nodes/edges document; the runtime (lib/automation) interprets it.
 * Runs never block a request: a run that must wait (Flow submission, delay) is persisted with
 * `status = waiting` and resumed by the event that satisfies it, or by the timeout sweep.
 */

export interface AutomationGraphNode {
  id: string;
  type: string;
  position?: { x: number; y: number };
  data: Record<string, unknown> & { type: string; label?: string };
}

export interface AutomationGraphEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  label?: string;
}

export interface AutomationGraph {
  nodes: AutomationGraphNode[];
  edges: AutomationGraphEdge[];
}

export const automations = pgTable(
  "automations",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 200 }).notNull(),
    description: text("description"),
    graph: jsonb("graph").$type<AutomationGraph>().notNull(),
    isActive: boolean("is_active").default(false).notNull(),
    // First activation: tells a never-run Draft apart from a Paused automation
    activatedAt: timestamp("activated_at", { withTimezone: true, mode: "date" }),
    archivedAt: timestamp("archived_at", { withTimezone: true, mode: "date" }),
    createdById: integer("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_automations_org_active").on(table.organizationId, table.isActive),
    index("idx_automations_org_updated").on(table.organizationId, table.updatedAt.desc()),
  ]
);

export const AutomationRunStatus = {
  RUNNING: "running",
  WAITING: "waiting",
  COMPLETED: "completed",
  FAILED: "failed",
  TIMED_OUT: "timed_out",
  CANCELLED: "cancelled",
} as const;
export type AutomationRunStatusValue = (typeof AutomationRunStatus)[keyof typeof AutomationRunStatus];

export type AutomationWait =
  | { kind: "flow_submission"; executionId: number; nodeId: string }
  | { kind: "delay"; nodeId: string };

export interface AutomationRunContext {
  trigger: { type: string; messageId?: number | null; wamid?: string | null; text?: string | null };
  /** Values from the latest Flow submission, referenced as {{flow.<field>}}. */
  flow?: Record<string, unknown>;
  /** Execution of the most recent Send WhatsApp Flow step in this run. */
  lastFlowExecutionId?: number;
  /** Short step log for debugging (capped). */
  log: { at: string; nodeId: string; type: string; outcome: string }[];
}

export const automationRuns = pgTable(
  "automation_runs",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    automationId: integer("automation_id")
      .notNull()
      .references(() => automations.id, { onDelete: "cascade" }),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    channelId: integer("channel_id").references(() => channels.id, { onDelete: "set null" }),
    // Idempotency: one run per automation per triggering event (e.g. the inbound wamid)
    triggerKey: varchar("trigger_key", { length: 255 }).notNull(),
    status: varchar("status", { length: 20 }).default(AutomationRunStatus.RUNNING).notNull(),
    currentNodeId: varchar("current_node_id", { length: 100 }),
    waitingFor: jsonb("waiting_for").$type<AutomationWait>(),
    wakeAt: timestamp("wake_at", { withTimezone: true, mode: "date" }), // delay end or wait timeout
    context: jsonb("context").$type<AutomationRunContext>().notNull(),
    stepCount: integer("step_count").default(0).notNull(),
    lastError: text("last_error"),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("uq_automation_runs_trigger").on(table.automationId, table.triggerKey),
    index("idx_automation_runs_org_customer").on(table.organizationId, table.customerId, table.status),
    index("idx_automation_runs_automation_created").on(table.automationId, table.createdAt.desc()),
    index("idx_automation_runs_waiting").on(table.status, table.wakeAt).where(sql`${table.status} = 'waiting'`),
  ]
);

export const automationsRelations = relations(automations, ({ one, many }) => ({
  organization: one(organizations, { fields: [automations.organizationId], references: [organizations.id] }),
  runs: many(automationRuns),
}));

export const automationRunsRelations = relations(automationRuns, ({ one }) => ({
  automation: one(automations, { fields: [automationRuns.automationId], references: [automations.id] }),
  customer: one(customers, { fields: [automationRuns.customerId], references: [customers.id] }),
}));

export type Automation = typeof automations.$inferSelect;
export type AutomationRun = typeof automationRuns.$inferSelect;
