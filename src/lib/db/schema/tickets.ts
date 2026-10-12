import { pgTable, serial, integer, varchar, text, timestamp, unique, index } from "drizzle-orm/pg-core";
import { sql, relations } from "drizzle-orm";
import { organizations } from "./organizations";
import { customers } from "./customers";
import { channels } from "./channels";
import { users } from "./users";
import { messages } from "./messages";

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
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    unique("uq_tickets_organization_ticket_number").on(table.organizationId, table.ticketNumber),
    index("idx_tickets_org_status").on(table.organizationId, table.status),
    index("idx_tickets_org_assignee").on(table.organizationId, table.assigneeId),
    index("idx_tickets_org_updated").on(table.organizationId, table.updatedAt.desc()),
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
