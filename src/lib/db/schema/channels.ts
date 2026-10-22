import { pgTable, serial, integer, varchar, text, boolean, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { organizations } from "./organizations";
import { customers } from "./customers";
import { tickets } from "./tickets";
import { messages } from "./messages";

export const ChannelStatus = {
  CONNECTED: "connected",
  TOKEN_EXPIRED: "token_expired",
  ERROR: "error",
  DISCONNECTED: "disconnected",
} as const;

export type ChannelStatusValue = (typeof ChannelStatus)[keyof typeof ChannelStatus];

export const channels = pgTable(
  "channels",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    type: varchar("type", { length: 50 }).notNull(), // 'whatsapp', 'instagram', 'messenger', 'email', 'webchat'
    name: varchar("name", { length: 255 }).notNull(),
    handle: varchar("handle", { length: 255 }), // Public handle shown in the inbox, e.g. '@noctylle' (Instagram) or page name (Messenger)
    externalAccountId: varchar("external_account_id", { length: 100 }), // Instagram business account ID / Facebook page ID / mailbox ID
    phoneNumber: varchar("phone_number", { length: 50 }),
    metaPhoneNumberId: varchar("meta_phone_number_id", { length: 100 }),
    wabaId: varchar("waba_id", { length: 100 }),
    metaAccessToken: text("meta_access_token"),
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true, mode: "date" }),
    status: varchar("status", { length: 30 }).default(ChannelStatus.CONNECTED).notNull(), // 'connected', 'token_expired', 'error', 'disconnected'
    lastError: text("last_error"),
    isActive: boolean("is_active").default(true),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_channels_org_type").on(table.organizationId, table.type),
    index("idx_channels_waba_id").on(table.wabaId),
    index("idx_channels_meta_phone_id").on(table.metaPhoneNumberId),
    index("idx_channels_phone_number").on(table.phoneNumber),
    index("idx_channels_external_account").on(table.externalAccountId),
    // A number is live in at most one workspace at a time; disconnected rows from earlier owners may remain
    uniqueIndex("uq_channels_live_meta_phone_id")
      .on(table.metaPhoneNumberId)
      .where(sql`${table.status} <> 'disconnected' AND ${table.metaPhoneNumberId} IS NOT NULL`),
    // One row per number per workspace: reconnecting updates it instead of adding a duplicate
    uniqueIndex("uq_channels_org_meta_phone_id")
      .on(table.organizationId, table.metaPhoneNumberId)
      .where(sql`${table.metaPhoneNumberId} IS NOT NULL`),
  ]
);

export const channelsRelations = relations(channels, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [channels.organizationId],
    references: [organizations.id],
  }),
  customers: many(customers),
  tickets: many(tickets),
  messages: many(messages),
}));

export type Channel = typeof channels.$inferSelect;
export type NewChannel = typeof channels.$inferInsert;
