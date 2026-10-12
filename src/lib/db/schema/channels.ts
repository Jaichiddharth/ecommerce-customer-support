import { pgTable, serial, integer, varchar, text, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { organizations } from "./organizations";
import { customers } from "./customers";
import { tickets } from "./tickets";
import { messages } from "./messages";

export const channels = pgTable(
  "channels",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    type: varchar("type", { length: 50 }).notNull(), // 'whatsapp', 'email', 'instagram', 'facebook'
    name: varchar("name", { length: 255 }).notNull(),
    phoneNumber: varchar("phone_number", { length: 50 }),
    metaPhoneNumberId: varchar("meta_phone_number_id", { length: 100 }),
    metaAccessToken: text("meta_access_token"),
    isActive: boolean("is_active").default(true),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_channels_org_type").on(table.organizationId, table.type),
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
