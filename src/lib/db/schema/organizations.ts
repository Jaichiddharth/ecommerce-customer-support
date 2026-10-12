import { pgTable, serial, varchar, integer, timestamp, index } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { users } from "./users";
import { channels } from "./channels";
import { customers } from "./customers";
import { tickets } from "./tickets";
import { messages } from "./messages";

export const organizations = pgTable(
  "organizations",
  {
    id: serial("id").primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    slug: varchar("slug", { length: 100 }).notNull().unique(),
    plan: varchar("plan", { length: 50 }).default("starter"), // 'starter', 'pro', 'enterprise'
    slaResponseMinutes: integer("sla_response_minutes").default(15),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_organizations_slug").on(table.slug),
  ]
);

export const organizationsRelations = relations(organizations, ({ many }) => ({
  users: many(users),
  channels: many(channels),
  customers: many(customers),
  tickets: many(tickets),
  messages: many(messages),
}));

export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;
