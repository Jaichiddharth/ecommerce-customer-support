import { pgTable, serial, integer, varchar, text, boolean, timestamp, unique, index } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { organizations } from "./organizations";
import { tickets } from "./tickets";
import { messages } from "./messages";
import { messageReactions } from "./message_reactions";

export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    email: varchar("email", { length: 255 }).notNull(),
    passwordHash: varchar("password_hash", { length: 255 }).notNull(),
    role: varchar("role", { length: 50 }).default("AGENT"), // 'ADMIN', 'AGENT', 'SUPERVISOR'
    avatarUrl: text("avatar_url"),
    isOnline: boolean("is_online").default(false),
    firebaseIdToken: text("firebase_id_token").notNull(),
    firebaseGcmToken: text("firebase_gcm_token").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    unique("uq_users_organization_email").on(table.organizationId, table.email),
    index("idx_users_org_email").on(table.organizationId, table.email),
  ]
);

export const usersRelations = relations(users, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [users.organizationId],
    references: [organizations.id],
  }),
  assignedTickets: many(tickets),
  sentMessages: many(messages),
  reactions: many(messageReactions),
}));

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
