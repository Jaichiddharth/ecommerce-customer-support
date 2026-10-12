import { pgTable, index, unique, serial, varchar, integer, timestamp, foreignKey, text, boolean } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"



export const organizations = pgTable("organizations", {
	id: serial().primaryKey().notNull(),
	name: varchar({ length: 255 }).notNull(),
	slug: varchar({ length: 100 }).notNull(),
	plan: varchar({ length: 50 }).default('starter'),
	slaResponseMinutes: integer("sla_response_minutes").default(15),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_organizations_slug").using("btree", table.slug.asc().nullsLast().op("text_ops")),
	unique("organizations_slug_unique").on(table.slug),
]);

export const channels = pgTable("channels", {
	id: serial().primaryKey().notNull(),
	organizationId: integer("organization_id").notNull(),
	type: varchar({ length: 50 }).notNull(),
	name: varchar({ length: 255 }).notNull(),
	phoneNumber: varchar("phone_number", { length: 50 }),
	metaPhoneNumberId: varchar("meta_phone_number_id", { length: 100 }),
	metaAccessToken: text("meta_access_token"),
	isActive: boolean("is_active").default(true),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_channels_org_type").using("btree", table.organizationId.asc().nullsLast().op("int4_ops"), table.type.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.id],
			name: "channels_organization_id_organizations_id_fk"
		}).onDelete("cascade"),
]);

export const users = pgTable("users", {
	id: serial().primaryKey().notNull(),
	organizationId: integer("organization_id").notNull(),
	name: varchar({ length: 255 }).notNull(),
	email: varchar({ length: 255 }).notNull(),
	passwordHash: varchar("password_hash", { length: 255 }).notNull(),
	role: varchar({ length: 50 }).default('AGENT'),
	avatarUrl: text("avatar_url"),
	isOnline: boolean("is_online").default(false),
	firebaseIdToken: text("firebase_id_token").notNull(),
	firebaseGcmToken: text("firebase_gcm_token").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_users_org_email").using("btree", table.organizationId.asc().nullsLast().op("text_ops"), table.email.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.id],
			name: "users_organization_id_organizations_id_fk"
		}).onDelete("cascade"),
	unique("uq_users_organization_email").on(table.organizationId, table.email),
]);

export const tickets = pgTable("tickets", {
	id: serial().primaryKey().notNull(),
	organizationId: integer("organization_id").notNull(),
	ticketNumber: varchar("ticket_number", { length: 50 }).notNull(),
	customerId: integer("customer_id").notNull(),
	channelId: integer("channel_id"),
	assigneeId: integer("assignee_id"),
	status: varchar({ length: 50 }).default('OPEN'),
	priority: varchar({ length: 50 }).default('MEDIUM'),
	subject: text(),
	lastMessageText: text("last_message_text"),
	lastMessageAt: timestamp("last_message_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	unreadCount: integer("unread_count").default(0),
	csatRating: integer("csat_rating"),
	tags: text().array().default([""]),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_tickets_org_assignee").using("btree", table.organizationId.asc().nullsLast().op("int4_ops"), table.assigneeId.asc().nullsLast().op("int4_ops")),
	index("idx_tickets_org_status").using("btree", table.organizationId.asc().nullsLast().op("text_ops"), table.status.asc().nullsLast().op("int4_ops")),
	index("idx_tickets_org_updated").using("btree", table.organizationId.asc().nullsLast().op("timestamptz_ops"), table.updatedAt.desc().nullsLast().op("timestamptz_ops")),
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.id],
			name: "tickets_organization_id_organizations_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.customerId],
			foreignColumns: [customers.id],
			name: "tickets_customer_id_customers_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.channelId],
			foreignColumns: [channels.id],
			name: "tickets_channel_id_channels_id_fk"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.assigneeId],
			foreignColumns: [users.id],
			name: "tickets_assignee_id_users_id_fk"
		}).onDelete("set null"),
	unique("uq_tickets_organization_ticket_number").on(table.ticketNumber, table.organizationId),
]);

export const customers = pgTable("customers", {
	id: serial().primaryKey().notNull(),
	organizationId: integer("organization_id").notNull(),
	name: varchar({ length: 255 }).notNull(),
	phone: varchar({ length: 50 }),
	email: varchar({ length: 255 }),
	avatarUrl: text("avatar_url"),
	shopifyCustomerId: varchar("shopify_customer_id", { length: 100 }),
	tags: text().array().default([""]),
	isOptedOut: boolean("is_opted_out").default(false),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	channelId: integer("channel_id"),
}, (table) => [
	index("idx_customers_channel").using("btree", table.channelId.asc().nullsLast().op("int4_ops")),
	index("idx_customers_org_channel").using("btree", table.organizationId.asc().nullsLast().op("int4_ops"), table.channelId.asc().nullsLast().op("int4_ops")),
	index("idx_customers_org_email").using("btree", table.organizationId.asc().nullsLast().op("int4_ops"), table.email.asc().nullsLast().op("text_ops")),
	index("idx_customers_org_phone").using("btree", table.organizationId.asc().nullsLast().op("int4_ops"), table.phone.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.id],
			name: "customers_organization_id_organizations_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.channelId],
			foreignColumns: [channels.id],
			name: "customers_channel_id_channels_id_fk"
		}).onDelete("set null"),
]);

export const messages = pgTable("messages", {
	id: serial().primaryKey().notNull(),
	organizationId: integer("organization_id").notNull(),
	customerId: integer("customer_id").notNull(),
	channelId: integer("channel_id"),
	ticketId: integer("ticket_id"),
	senderType: varchar("sender_type", { length: 50 }).notNull(),
	senderId: integer("sender_id"),
	receiverId: integer("receiver_id"),
	textContent: text("text_content"),
	mediaUrl: text("media_url"),
	mediaType: varchar("media_type", { length: 50 }),
	isInternalNote: boolean("is_internal_note").default(false),
	metaMessageId: varchar("meta_message_id", { length: 255 }),
	repliedToId: integer("replied_to_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	status: integer().default(0).notNull(),
	errorCode: integer("error_code"),
}, (table) => [
	index("idx_messages_channel_id").using("btree", table.channelId.asc().nullsLast().op("int4_ops")),
	index("idx_messages_created_at").using("btree", table.organizationId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.desc().nullsLast().op("timestamptz_ops")),
	index("idx_messages_error_code").using("btree", table.errorCode.asc().nullsLast().op("int4_ops")),
	index("idx_messages_meta_message_id").using("btree", table.metaMessageId.asc().nullsLast().op("text_ops")),
	index("idx_messages_org_customer").using("btree", table.organizationId.asc().nullsLast().op("int4_ops"), table.customerId.asc().nullsLast().op("int4_ops")),
	index("idx_messages_receiver_id").using("btree", table.receiverId.asc().nullsLast().op("int4_ops")),
	index("idx_messages_replied_to_id").using("btree", table.repliedToId.asc().nullsLast().op("int4_ops")),
	index("idx_messages_sender_id").using("btree", table.senderId.asc().nullsLast().op("int4_ops")),
	index("idx_messages_status").using("btree", table.status.asc().nullsLast().op("int4_ops")),
	index("idx_messages_ticket_id").using("btree", table.ticketId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.id],
			name: "messages_organization_id_organizations_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.customerId],
			foreignColumns: [customers.id],
			name: "messages_customer_id_customers_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.channelId],
			foreignColumns: [channels.id],
			name: "messages_channel_id_channels_id_fk"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.ticketId],
			foreignColumns: [tickets.id],
			name: "messages_ticket_id_tickets_id_fk"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.senderId],
			foreignColumns: [users.id],
			name: "messages_sender_id_users_id_fk"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.receiverId],
			foreignColumns: [customers.id],
			name: "messages_receiver_id_customers_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.repliedToId],
			foreignColumns: [table.id],
			name: "messages_replied_to_id_messages_id_fk"
		}).onDelete("set null"),
]);

export const messageReactions = pgTable("message_reactions", {
	id: serial().primaryKey().notNull(),
	messageId: integer("message_id").notNull(),
	userId: integer("user_id"),
	customerId: integer("customer_id"),
	emoji: varchar({ length: 50 }).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_reactions_customer").using("btree", table.customerId.asc().nullsLast().op("int4_ops")),
	index("idx_reactions_message").using("btree", table.messageId.asc().nullsLast().op("int4_ops")),
	index("idx_reactions_user").using("btree", table.userId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.messageId],
			foreignColumns: [messages.id],
			name: "message_reactions_message_id_messages_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "message_reactions_user_id_users_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.customerId],
			foreignColumns: [customers.id],
			name: "message_reactions_customer_id_customers_id_fk"
		}).onDelete("cascade"),
]);
