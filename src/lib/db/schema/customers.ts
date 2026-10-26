import { pgTable, serial, integer, varchar, text, boolean, timestamp, index, type AnyPgColumn } from "drizzle-orm/pg-core";
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
    handle: varchar("handle", { length: 255 }), // Social handle, e.g. 'meera.styles' on Instagram
    externalId: varchar("external_id", { length: 255 }), // Channel-scoped user ID (Instagram IGSID / Messenger PSID)
    language: varchar("language", { length: 20 }), // Preferred language code, e.g. "en"
    avatarUrl: text("avatar_url"),
    shopifyCustomerId: varchar("shopify_customer_id", { length: 100 }),
    // Set when this contact is another channel identity (Instagram, Messenger, another number, ...) of the same person.
    // Points at the profile's primary contact, which holds shared data such as the Shopify customer link. Never chained.
    primaryCustomerId: integer("primary_customer_id").references((): AnyPgColumn => customers.id, { onDelete: "set null" }),
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
    index("idx_customers_org_external").on(table.organizationId, table.externalId),
    index("idx_customers_primary").on(table.primaryCustomerId),
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
  primaryCustomer: one(customers, {
    fields: [customers.primaryCustomerId],
    references: [customers.id],
    relationName: "customer_identities",
  }),
  identities: many(customers, { relationName: "customer_identities" }),
  tickets: many(tickets),
  messages: many(messages),
  reactions: many(messageReactions),
}));

export type Customer = typeof customers.$inferSelect;
export type NewCustomer = typeof customers.$inferInsert;
