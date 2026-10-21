import { pgTable, serial, integer, varchar, text, boolean, real, jsonb, timestamp, unique, index } from "drizzle-orm/pg-core";
import { sql, relations } from "drizzle-orm";
import { organizations } from "./organizations";
import { customers } from "./customers";
import { channels } from "./channels";
import { users } from "./users";
import { messages } from "./messages";

/**
 * A ticket is one inbox conversation with a customer on a channel.
 * The inbox shows the latest ticket per customer; messages link to it via messages.ticket_id.
 */

/** Who is currently replying in the conversation */
export const ConversationHandler = {
  AI: "ai",
  HUMAN: "human",
} as const;

export type ConversationHandlerValue = (typeof ConversationHandler)[keyof typeof ConversationHandler];

export const TicketStatus = {
  OPEN: "OPEN",
  PENDING: "PENDING",
  RESOLVED: "RESOLVED",
  CLOSED: "CLOSED",
} as const;

export const tickets = pgTable(
  "tickets",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    ticketNumber: varchar("ticket_number", { length: 50 }).notNull(),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    channelId: integer("channel_id").references(() => channels.id, { onDelete: "set null" }),
    assigneeId: integer("assignee_id").references(() => users.id, { onDelete: "set null" }),
    status: varchar("status", { length: 50 }).default("OPEN"), // 'OPEN', 'PENDING', 'RESOLVED', 'CLOSED'
    priority: varchar("priority", { length: 50 }).default("MEDIUM"), // 'LOW', 'MEDIUM', 'HIGH', 'URGENT'
    subject: text("subject"),
    lastMessageText: text("last_message_text"),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true, mode: "date" }).defaultNow(),
    unreadCount: integer("unread_count").default(0),
    csatRating: integer("csat_rating"), // 1 to 5 stars
    tags: text("tags")
      .array()
      .default(sql`'{}'::text[]`),

    // AI agent state (written by the AI service; the inbox reads and toggles it)
    handledBy: varchar("handled_by", { length: 20 }).default(ConversationHandler.HUMAN).notNull(), // 'ai' | 'human'
    needsHuman: boolean("needs_human").default(false).notNull(), // AI escalated the conversation to a human
    aiSummary: text("ai_summary"),
    aiIntent: varchar("ai_intent", { length: 100 }), // e.g. 'Size & availability'
    aiConfidence: real("ai_confidence"), // 0..1
    aiActionsCount: integer("ai_actions_count").default(0).notNull(),
    aiModel: varchar("ai_model", { length: 100 }), // e.g. 'UnoCX model'
    aiSuggestions: jsonb("ai_suggestions").$type<string[]>().default(sql`'[]'::jsonb`).notNull(), // Copilot reply ideas
    language: varchar("language", { length: 20 }), // Detected conversation language code, e.g. "en"
    resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: "date" }),

    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    unique("uq_tickets_organization_ticket_number").on(table.organizationId, table.ticketNumber),
    index("idx_tickets_org_status").on(table.organizationId, table.status),
    index("idx_tickets_org_assignee").on(table.organizationId, table.assigneeId),
    index("idx_tickets_org_updated").on(table.organizationId, table.updatedAt.desc()),
    index("idx_tickets_org_customer").on(table.organizationId, table.customerId),
    index("idx_tickets_org_handled_by").on(table.organizationId, table.handledBy),
    index("idx_tickets_org_last_message").on(table.organizationId, table.lastMessageAt.desc()),
  ]
);

export const ticketsRelations = relations(tickets, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [tickets.organizationId],
    references: [organizations.id],
  }),
  customer: one(customers, {
    fields: [tickets.customerId],
    references: [customers.id],
  }),
  channel: one(channels, {
    fields: [tickets.channelId],
    references: [channels.id],
  }),
  assignee: one(users, {
    fields: [tickets.assigneeId],
    references: [users.id],
  }),
  messages: many(messages),
}));

export type Ticket = typeof tickets.$inferSelect;
export type NewTicket = typeof tickets.$inferInsert;
