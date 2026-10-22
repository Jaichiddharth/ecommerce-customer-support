import { pgTable, serial, integer, varchar, text, boolean, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { organizations } from "./organizations";
import { customers } from "./customers";
import { channels } from "./channels";
import { tickets } from "./tickets";
import { users } from "./users";
import { messageReactions } from "./message_reactions";

export type SenderType = "customer" | "agent" | "ai" | "system";

/** Shopify product/variant reference recorded on a shared-product message */
export interface SharedShopifyProduct {
  storeId: number;
  productId: string; // gid://shopify/Product/…
  variantId: string; // gid://shopify/ProductVariant/…
  title: string;
  variantTitle: string | null;
  options: { name: string; value: string }[];
  sku: string | null;
  price: string;
  currencyCode: string;
  available: boolean;
  imageUrl: string | null;
  productUrl: string | null;
}

/** Extra data attached to a message, e.g. which action the AI agent performed */
export interface MessageMetadata {
  aiAction?: string; // e.g. 'catalog lookup'
  shopifyProduct?: SharedShopifyProduct; // Set when an agent shares a Shopify product
  [key: string]: unknown;
}

export enum MessageStatus {
  SENT = 0,
  DELIVERED = 1,
  READ = 2,
  FAILED = 3,
}

export type MessageStatusType = MessageStatus;
export type MessageStatusName = "sent" | "delivered" | "read" | "failed";

export const MESSAGE_STATUS_NAMES: Record<MessageStatus, MessageStatusName> = {
  [MessageStatus.SENT]: "sent",
  [MessageStatus.DELIVERED]: "delivered",
  [MessageStatus.READ]: "read",
  [MessageStatus.FAILED]: "failed",
};

export const MESSAGE_STATUS_VALUES: Record<string, MessageStatus> = {
  sent: MessageStatus.SENT,
  delivered: MessageStatus.DELIVERED,
  read: MessageStatus.READ,
  failed: MessageStatus.FAILED,
};

export function normalizeMessageStatus(status: unknown): MessageStatus {
  if (typeof status === "number") {
    if (status in MessageStatus) return status as MessageStatus;
    return MessageStatus.SENT;
  }
  if (typeof status === "string") {
    const lower = status.toLowerCase();
    if (lower in MESSAGE_STATUS_VALUES) {
      return MESSAGE_STATUS_VALUES[lower];
    }
  }
  return MessageStatus.SENT;
}

export function getMessageStatusName(status: unknown): MessageStatusName {
  const normalized = normalizeMessageStatus(status);
  return MESSAGE_STATUS_NAMES[normalized] || "sent";
}

export const messages = pgTable(
  "messages",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    channelId: integer("channel_id").references(() => channels.id, { onDelete: "set null" }),
    ticketId: integer("ticket_id").references(() => tickets.id, { onDelete: "set null" }), // Nullable for now
    senderType: varchar("sender_type", { length: 50 }).notNull(), // 'customer', 'agent', 'ai', 'system'
    senderId: integer("sender_id").references(() => users.id, { onDelete: "set null" }), // User ID (null when coming from webhook / customer / AI)
    receiverId: integer("receiver_id").references(() => customers.id, { onDelete: "cascade" }), // Always denotes customer_id
    textContent: text("text_content"),
    mediaUrl: text("media_url"),
    mediaType: varchar("media_type", { length: 50 }), // 'image', 'video', 'audio', 'document', 'sticker', 'location', etc.
    isInternalNote: boolean("is_internal_note").default(false),
    status: integer("status").default(MessageStatus.SENT).notNull(), // 0 = sent, 1 = delivered, 2 = read, 3 = failed
    errorCode: integer("error_code"), // Meta error code if message failed (e.g. 131026, 131047, etc.)
    metaMessageId: varchar("meta_message_id", { length: 255 }), // e.g. "wamid.HBg..."
    repliedToId: integer("replied_to_id").references((): any => messages.id, { onDelete: "set null" }),
    metadata: jsonb("metadata").$type<MessageMetadata>(), // e.g. { aiAction: 'catalog lookup' }
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_messages_org_customer").on(table.organizationId, table.customerId),
    index("idx_messages_sender_id").on(table.senderId),
    index("idx_messages_receiver_id").on(table.receiverId),
    index("idx_messages_status").on(table.status),
    index("idx_messages_error_code").on(table.errorCode),
    index("idx_messages_meta_message_id").on(table.metaMessageId),
    index("idx_messages_channel_id").on(table.channelId),
    index("idx_messages_ticket_id").on(table.ticketId),
    index("idx_messages_replied_to_id").on(table.repliedToId),
    index("idx_messages_created_at").on(table.organizationId, table.createdAt.desc()),
  ]
);

export const messagesRelations = relations(messages, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [messages.organizationId],
    references: [organizations.id],
  }),
  customer: one(customers, {
    fields: [messages.customerId],
    references: [customers.id],
  }),
  channel: one(channels, {
    fields: [messages.channelId],
    references: [channels.id],
  }),
  ticket: one(tickets, {
    fields: [messages.ticketId],
    references: [tickets.id],
  }),
  sender: one(users, {
    fields: [messages.senderId],
    references: [users.id],
  }),
  repliedTo: one(messages, {
    fields: [messages.repliedToId],
    references: [messages.id],
    relationName: "messageReplies",
  }),
  replies: many(messages, {
    relationName: "messageReplies",
  }),
  reactions: many(messageReactions),
}));

export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
