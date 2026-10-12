import { pgTable, serial, integer, varchar, text, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { sql, relations } from "drizzle-orm";
import { organizations } from "./organizations";
import { channels } from "./channels";
import { tickets } from "./tickets";
import { messages } from "./messages";
import { messageReactions } from "./message_reactions";

export const customers = pgTable(
  "customers",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    channelId: integer("channel_id").references(() => channels.id, { onDelete: "set null" }),
    name: varchar("name", { length: 255 }).notNull(),
    phone: varchar("phone", { length: 50 }),
    email: varchar("email", { length: 255 }),
    avatarUrl: text("avatar_url"),
    shopifyCustomerId: varchar("shopify_customer_id", { length: 100 }),
    tags: text("tags")
      .array()
      .default(sql`'{}'::text[]`),
    isOptedOut: boolean("is_opted_out").default(false),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_customers_org_phone").on(table.organizationId, table.phone),
    index("idx_customers_org_email").on(table.organizationId, table.email),
    index("idx_customers_org_channel").on(table.organizationId, table.channelId),
    index("idx_customers_channel").on(table.channelId),
  ]
);

export const customersRelations = relations(customers, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [customers.organizationId],
    references: [organizations.id],
  }),
  channel: one(channels, {
    fields: [customers.channelId],
    references: [channels.id],
  }),
  tickets: many(tickets),
  messages: many(messages),
  reactions: many(messageReactions),
}));

export type Customer = typeof customers.$inferSelect;
export type NewCustomer = typeof customers.$inferInsert;
