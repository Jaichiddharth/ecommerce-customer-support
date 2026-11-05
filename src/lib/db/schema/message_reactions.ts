import { pgTable, serial, integer, varchar, timestamp, index } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { organizations } from "./organizations";
import { messages } from "./messages";
import { users } from "./users";
import { customers } from "./customers";

export const messageReactions = pgTable(
  "message_reactions",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    messageId: integer("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }),
    customerId: integer("customer_id").references(() => customers.id, { onDelete: "cascade" }),
    emoji: varchar("emoji", { length: 50 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_reactions_org_message").on(table.organizationId, table.messageId),
    index("idx_reactions_message").on(table.messageId),
    index("idx_reactions_user").on(table.userId),
    index("idx_reactions_customer").on(table.customerId),
  ]
);

export const messageReactionsRelations = relations(messageReactions, ({ one }) => ({
  organization: one(organizations, {
    fields: [messageReactions.organizationId],
    references: [organizations.id],
  }),
  message: one(messages, {
    fields: [messageReactions.messageId],
    references: [messages.id],
  }),
  user: one(users, {
    fields: [messageReactions.userId],
    references: [users.id],
  }),
  customer: one(customers, {
    fields: [messageReactions.customerId],
    references: [customers.id],
  }),
}));

export type MessageReaction = typeof messageReactions.$inferSelect;
export type NewMessageReaction = typeof messageReactions.$inferInsert;

