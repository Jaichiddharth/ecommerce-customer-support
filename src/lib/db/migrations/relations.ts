import { relations } from "drizzle-orm/relations";
import { organizations, channels, users, tickets, customers, messages, messageReactions } from "./schema";

export const channelsRelations = relations(channels, ({one, many}) => ({
	organization: one(organizations, {
		fields: [channels.organizationId],
		references: [organizations.id]
	}),
	tickets: many(tickets),
	customers: many(customers),
	messages: many(messages),
}));

export const organizationsRelations = relations(organizations, ({many}) => ({
	channels: many(channels),
	users: many(users),
	tickets: many(tickets),
	customers: many(customers),
	messages: many(messages),
}));

export const usersRelations = relations(users, ({one, many}) => ({
	organization: one(organizations, {
		fields: [users.organizationId],
		references: [organizations.id]
	}),
	tickets: many(tickets),
	messages: many(messages),
	messageReactions: many(messageReactions),
}));

export const ticketsRelations = relations(tickets, ({one, many}) => ({
	organization: one(organizations, {
		fields: [tickets.organizationId],
		references: [organizations.id]
	}),
	customer: one(customers, {
		fields: [tickets.customerId],
		references: [customers.id]
	}),
	channel: one(channels, {
		fields: [tickets.channelId],
		references: [channels.id]
	}),
	user: one(users, {
		fields: [tickets.assigneeId],
		references: [users.id]
	}),
	messages: many(messages),
}));

export const customersRelations = relations(customers, ({one, many}) => ({
	tickets: many(tickets),
	organization: one(organizations, {
		fields: [customers.organizationId],
		references: [organizations.id]
	}),
	channel: one(channels, {
		fields: [customers.channelId],
		references: [channels.id]
	}),
	messages_customerId: many(messages, {
		relationName: "messages_customerId_customers_id"
	}),
	messages_receiverId: many(messages, {
		relationName: "messages_receiverId_customers_id"
	}),
	messageReactions: many(messageReactions),
}));

export const messagesRelations = relations(messages, ({one, many}) => ({
	organization: one(organizations, {
		fields: [messages.organizationId],
		references: [organizations.id]
	}),
	customer_customerId: one(customers, {
		fields: [messages.customerId],
		references: [customers.id],
		relationName: "messages_customerId_customers_id"
	}),
	channel: one(channels, {
		fields: [messages.channelId],
		references: [channels.id]
	}),
	ticket: one(tickets, {
		fields: [messages.ticketId],
		references: [tickets.id]
	}),
	user: one(users, {
		fields: [messages.senderId],
		references: [users.id]
	}),
	customer_receiverId: one(customers, {
		fields: [messages.receiverId],
		references: [customers.id],
		relationName: "messages_receiverId_customers_id"
	}),
	message: one(messages, {
		fields: [messages.repliedToId],
		references: [messages.id],
		relationName: "messages_repliedToId_messages_id"
	}),
	messages: many(messages, {
		relationName: "messages_repliedToId_messages_id"
	}),
	messageReactions: many(messageReactions),
}));

export const messageReactionsRelations = relations(messageReactions, ({one}) => ({
	message: one(messages, {
		fields: [messageReactions.messageId],
		references: [messages.id]
	}),
	user: one(users, {
		fields: [messageReactions.userId],
		references: [users.id]
	}),
	customer: one(customers, {
		fields: [messageReactions.customerId],
		references: [customers.id]
	}),
}));