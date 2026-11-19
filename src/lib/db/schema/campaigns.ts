import { pgTable, serial, bigserial, integer, varchar, text, jsonb, timestamp, index, uniqueIndex, smallint, boolean } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations } from "./organizations";
import { channels } from "./channels";
import { users } from "./users";
import type { AudienceSummary } from "@/lib/campaigns/contact-file";
import type { WhatsAppTemplate } from "@/types/templates";

/**
 * Bulk WhatsApp template campaigns.
 *
 * `campaigns` holds the definition and the state machine; `campaign_recipients` has one row per contact and is
 * the send queue. A recipient is claimed (status `sending`) before Meta is called and never goes back to
 * `pending` after that, which is what keeps a contact from being messaged twice even when a queue message is
 * delivered twice or a worker crashes. See src/lib/campaigns/engine.ts.
 */

export const CampaignStatus = {
  DRAFT: "draft",
  SCHEDULED: "scheduled",
  RUNNING: "running",
  PAUSED: "paused",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
  FAILED: "failed",
} as const;
export type CampaignStatus = (typeof CampaignStatus)[keyof typeof CampaignStatus];

/**
 * Why a campaign is paused. A paused campaign never restarts by itself: the owner checks and resumes it.
 *  - manual: paused by a team member
 *  - error_threshold: 20 messages in a row failed (whatever the error), so sending stopped
 * template_unavailable / account_blocked / channel_unavailable are no longer set (those errors now count toward
 * error_threshold) and are kept only so older rows still read correctly.
 */
export const CampaignPauseReason = {
  MANUAL: "manual",
  ERROR_THRESHOLD: "error_threshold",
  TEMPLATE_UNAVAILABLE: "template_unavailable",
  ACCOUNT_BLOCKED: "account_blocked",
  CHANNEL_UNAVAILABLE: "channel_unavailable",
} as const;
export type CampaignPauseReason = (typeof CampaignPauseReason)[keyof typeof CampaignPauseReason];

export const RecipientStatus = {
  PENDING: "pending",
  /** Claimed by a worker; Meta may or may not have been called yet */
  SENDING: "sending",
  SENT: "sent",
  DELIVERED: "delivered",
  READ: "read",
  FAILED: "failed",
  /** Not sent on purpose (opted out) */
  SKIPPED: "skipped",
  CANCELLED: "cancelled",
  /** The worker died or timed out mid-call: Meta may have sent it, so it is never retried automatically */
  UNKNOWN: "unknown",
} as const;
export type RecipientStatus = (typeof RecipientStatus)[keyof typeof RecipientStatus];

/** Where a template variable gets its value: a column of the file, or the same text for everyone */
export type CampaignVariableSource = { type: "column"; column: string } | { type: "text"; value: string };

export const campaigns = pgTable(
  "campaigns",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
    status: varchar("status", { length: 20 }).$type<CampaignStatus>().default(CampaignStatus.DRAFT).notNull(),
    pauseReason: varchar("pause_reason", { length: 40 }).$type<CampaignPauseReason>(),
    /** Last error that paused or failed the campaign, shown to the user */
    lastError: text("last_error"),

    // Sender and message
    channelId: integer("channel_id").references(() => channels.id, { onDelete: "set null" }),
    phoneNumberId: varchar("phone_number_id", { length: 64 }),
    /** Snapshot taken when the template was picked, so later edits to the template don't change the campaign */
    template: jsonb("template").$type<WhatsAppTemplate>(),
    /** Template field id (`header`, `body:1`, `button:0`) → where its value comes from */
    variables: jsonb("variables").$type<Record<string, CampaignVariableSource>>().default({}).notNull(),

    // Audience (recipients live in campaign_recipients)
    audience: jsonb("audience").$type<AudienceSummary>(),
    /** S3 key of the uploaded contact file (null when storage isn't configured) */
    sourceFileKey: varchar("source_file_key", { length: 300 }),
    recipientCount: integer("recipient_count").default(0).notNull(),

    // Schedule
    scheduledAt: timestamp("scheduled_at", { withTimezone: true, mode: "date" }),
    timezone: varchar("timezone", { length: 64 }).default("UTC").notNull(),
    /** Pause between two contacts; null = as fast as the number allows */
    intervalSeconds: integer("interval_seconds"),
    /** Name of the EventBridge Scheduler schedule that starts the campaign, while one exists */
    scheduleName: varchar("schedule_name", { length: 64 }),

    // Runtime
    /** Bumped on every start/resume; queue messages carry it, so ticks from before a pause are dropped */
    runGeneration: integer("run_generation").default(0).notNull(),
    /**
     * Sequence number of the next expected tick. Each tick message carries the number it was enqueued with and
     * is only accepted when it matches, so a queue message delivered twice can't start a second sending loop.
     */
    tickSeq: integer("tick_seq").default(0).notNull(),
    /** When the last tick finished; the safety-net sweep restarts a chain that went silent */
    lastTickAt: timestamp("last_tick_at", { withTimezone: true, mode: "date" }),
    /** Only one tick runs at a time per campaign: the one holding this lease */
    workerLeaseUntil: timestamp("worker_lease_until", { withTimezone: true, mode: "date" }),
    /** Failures in a row; resets on a success. Too many pauses the campaign (error_threshold) */
    consecutiveFailures: integer("consecutive_failures").default(0).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),

    createdById: integer("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_campaigns_org_updated").on(table.organizationId, table.updatedAt.desc()),
    // One active (scheduled or sending) campaign per workspace, enforced by the database. Other workspaces are
    // independent. A scheduled campaign holds the slot until it finishes, so its start never meets a conflict.
    uniqueIndex("uq_campaigns_one_active_per_org")
      .on(table.organizationId)
      .where(sql`${table.status} IN ('scheduled', 'running')`),
    // Safety-net sweep: running campaigns, and scheduled ones whose start time passed
    index("idx_campaigns_active").on(table.status, table.scheduledAt).where(sql`${table.status} IN ('scheduled', 'running')`),
  ]
);

export const campaignRecipients = pgTable(
  "campaign_recipients",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    campaignId: integer("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    organizationId: integer("organization_id").notNull(),
    /** E.164 with "+" */
    phone: varchar("phone", { length: 20 }).notNull(),
    /** Every column of the file for this contact (fills template variables) */
    fields: jsonb("fields").$type<Record<string, string>>().default({}).notNull(),
    status: varchar("status", { length: 20 }).$type<RecipientStatus>().default(RecipientStatus.PENDING).notNull(),
    attempts: smallint("attempts").default(0).notNull(),
    /** Earliest time a pending recipient may be sent (retry back-off) */
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true, mode: "date" }),
    /** Lease of the worker holding a `sending` row */
    lockedUntil: timestamp("locked_until", { withTimezone: true, mode: "date" }),
    /** Meta message id (wamid), set once Meta accepted the message; status webhooks match on it */
    wamid: varchar("wamid", { length: 128 }),
    messageId: integer("message_id"),
    errorCode: integer("error_code"),
    errorMessage: text("error_message"),
    // From the `pricing` object of WhatsApp status webhooks. Meta sends whether the message is charged and in
    // which category, not the amount (that depends on Meta's rate for the recipient's country).
    billable: boolean("billable"),
    /** marketing | utility | authentication | service | … */
    pricingCategory: varchar("pricing_category", { length: 40 }),
    /** e.g. PMP (per-message pricing) */
    pricingModel: varchar("pricing_model", { length: 20 }),
    sentAt: timestamp("sent_at", { withTimezone: true, mode: "date" }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true, mode: "date" }),
    readAt: timestamp("read_at", { withTimezone: true, mode: "date" }),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    // One row per number per campaign: re-imports and double inserts can't create a second message
    uniqueIndex("uq_campaign_recipients_phone").on(table.campaignId, table.phone),
    // The worker's claim query: next due pending rows of a campaign, in file order
    index("idx_campaign_recipients_due").on(table.campaignId, table.id).where(sql`${table.status} = 'pending'`),
    index("idx_campaign_recipients_status").on(table.campaignId, table.status),
    index("idx_campaign_recipients_wamid").on(table.wamid).where(sql`${table.wamid} IS NOT NULL`),
  ]
);

export type Campaign = typeof campaigns.$inferSelect;
export type NewCampaign = typeof campaigns.$inferInsert;
export type CampaignRecipientRow = typeof campaignRecipients.$inferSelect;
