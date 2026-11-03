import { pgTable, serial, integer, varchar, text, timestamp, index, jsonb } from "drizzle-orm/pg-core";
import { sql, relations } from "drizzle-orm";
import { organizations } from "./organizations";
import { users } from "./users";

export const invitations = pgTable(
  "invitations",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    email: varchar("email", { length: 255 }).notNull(),
    name: varchar("name", { length: 255 }),
    role: varchar("role", { length: 50 }).default("AGENT").notNull(), // 'ADMIN', 'AGENT', 'VIEWER'
    customPermissions: jsonb("custom_permissions"),
    teams: text("teams")
      .array()
      .default(sql`'{}'::text[]`),
    languages: text("languages")
      .array()
      .default(sql`'{"EN"}'::text[]`),
    stores: text("stores")
      .array()
      .default(sql`'{}'::text[]`),
    token: varchar("token", { length: 255 }).notNull().unique(),
    invitedById: integer("invited_by_id")
      .references(() => users.id, { onDelete: "set null" }),
    status: varchar("status", { length: 50 }).default("pending").notNull(), // 'pending', 'accepted', 'revoked', 'expired'
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_invitations_token").on(table.token),
    index("idx_invitations_org_email").on(table.organizationId, table.email),
    index("idx_invitations_org_status").on(table.organizationId, table.status),
  ]
);

export const invitationsRelations = relations(invitations, ({ one }) => ({
  organization: one(organizations, {
    fields: [invitations.organizationId],
    references: [organizations.id],
  }),
  invitedBy: one(users, {
    fields: [invitations.invitedById],
    references: [users.id],
  }),
}));

export type Invitation = typeof invitations.$inferSelect;
export type NewInvitation = typeof invitations.$inferInsert;
