import { pgTable, serial, integer, varchar, text, boolean, timestamp, index, unique, uniqueIndex, foreignKey } from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { organizations } from "./organizations";
import { users } from "./users";
import { customers } from "./customers";
import { channels } from "./channels";

/**
 * Shopify integration. Products, variants and orders are fetched from Shopify on demand; only the store
 * connections, which channel uses which store, and the contact ↔ Shopify customer / order links are stored here.
 *
 * Store-level isolation: every row below carries organization_id, and the rows that point at a store (or a
 * channel) do so through a composite (organization_id, id) foreign key, so the database itself rejects a row
 * that would tie one workspace's data to another workspace's store or channel.
 */

export const ShopifyStoreStatus = {
  CONNECTED: "connected",
  REAUTH_REQUIRED: "reauth_required", // Token rejected by Shopify (app uninstalled, scopes revoked, expired)
  DISCONNECTED: "disconnected",
} as const;

export type ShopifyStoreStatusValue = (typeof ShopifyStoreStatus)[keyof typeof ShopifyStoreStatus];

export const shopifyStores = pgTable(
  "shopify_stores",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    shopDomain: varchar("shop_domain", { length: 255 }).notNull(), // Always the permanent '<handle>.myshopify.com' domain
    shopifyShopId: varchar("shopify_shop_id", { length: 100 }), // gid://shopify/Shop/…
    name: varchar("name", { length: 255 }),
    email: varchar("email", { length: 255 }),
    currencyCode: varchar("currency_code", { length: 10 }),
    primaryDomainUrl: text("primary_domain_url"), // Storefront URL, e.g. https://shop.example.com
    accessToken: text("access_token"), // AES-256-GCM encrypted (security/crypto); never sent to the browser
    refreshToken: text("refresh_token"), // Encrypted; only set for expiring offline tokens
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true, mode: "date" }),
    scopes: text("scopes"), // Comma-separated scopes granted by the merchant
    status: varchar("status", { length: 30 }).default(ShopifyStoreStatus.CONNECTED).notNull(),
    // Legacy: there is no default store any more (a channel only uses the store it's mapped to). Kept so no
    // migration is needed; nothing reads it.
    isDefault: boolean("is_default").default(false).notNull(),
    lastError: text("last_error"),
    connectedById: integer("connected_by_id").references(() => users.id, { onDelete: "set null" }),
    connectedAt: timestamp("connected_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    // Reconnecting the same shop reuses its row, so existing contact links and channel mappings survive a disconnect
    unique("uq_shopify_stores_org_domain").on(table.organizationId, table.shopDomain),
    // Target of the composite (organization_id, store_id) foreign keys below
    unique("uq_shopify_stores_org_id").on(table.organizationId, table.id),
    // At most one default store per workspace
    uniqueIndex("uq_shopify_stores_org_default").on(table.organizationId).where(sql`${table.isDefault} = true`),
    // An organization can connect several stores
    index("idx_shopify_stores_org").on(table.organizationId),
    index("idx_shopify_stores_domain").on(table.shopDomain),
  ]
);

/**
 * Which stores a channel (WhatsApp number, Instagram account, ...) works with. A channel can use many stores (and
 * WooCommerce stores too, see commerce_store_channels); a store can serve many channels. In the inbox the agent
 * picks which of the channel's stores products, customer matching and orders come from. Channels without a row
 * have no store: there is no default store.
 * Rows are kept while the store is disconnected, so reconnecting it restores its channels.
 */
export const shopifyStoreChannels = pgTable(
  "shopify_store_channels",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    shopifyStoreId: integer("shopify_store_id").notNull(),
    channelId: integer("channel_id").notNull(),
    createdById: integer("created_by_id").references(() => users.id, { onDelete: "set null" }),
    updatedById: integer("updated_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: "fk_shopify_store_channels_store",
      columns: [table.organizationId, table.shopifyStoreId],
      foreignColumns: [shopifyStores.organizationId, shopifyStores.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "fk_shopify_store_channels_channel",
      columns: [table.organizationId, table.channelId],
      foreignColumns: [channels.organizationId, channels.id],
    }).onDelete("cascade"),
    // A channel can use many stores, each at most once
    unique("uq_shopify_store_channels_store_channel").on(table.shopifyStoreId, table.channelId),
    index("idx_shopify_store_channels_org_store").on(table.organizationId, table.shopifyStoreId),
    index("idx_shopify_store_channels_org_channel").on(table.organizationId, table.channelId),
  ]
);

export const ShopifyLinkSource = {
  MANUAL: "manual", // Picked by an agent
  AUTO: "auto", // The only Shopify customer with the contact's phone number or email
} as const;

export type ShopifyLinkSourceValue = (typeof ShopifyLinkSource)[keyof typeof ShopifyLinkSource];

/**
 * Link between a contact profile (its primary contact, see customers.primaryCustomerId) and a customer in a
 * connected Shopify store. A row without shopifyCustomerId records that an agent unlinked the contact, so
 * automatic matching doesn't link it again.
 */
export const shopifyCustomerLinks = pgTable(
  "shopify_customer_links",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    shopifyStoreId: integer("shopify_store_id")
      .notNull()
      .references(() => shopifyStores.id, { onDelete: "cascade" }),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    shopifyCustomerId: varchar("shopify_customer_id", { length: 100 }), // gid://shopify/Customer/…; null = unlinked by an agent
    source: varchar("source", { length: 20 }).default(ShopifyLinkSource.MANUAL).notNull(),
    linkedById: integer("linked_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: "fk_shopify_customer_links_org_store",
      columns: [table.organizationId, table.shopifyStoreId],
      foreignColumns: [shopifyStores.organizationId, shopifyStores.id],
    }).onDelete("cascade"),
    unique("uq_shopify_links_store_customer").on(table.shopifyStoreId, table.customerId),
    unique("uq_shopify_links_store_shopify_customer").on(table.shopifyStoreId, table.shopifyCustomerId),
    index("idx_shopify_links_org_customer").on(table.organizationId, table.customerId),
  ]
);

/**
 * An order of a connected store associated with a contact profile (its primary contact id), e.g. an agent
 * attaching the order a conversation is about. channelId records the connection (channel) it was associated
 * through. Each order is associated with at most one profile per store. Order details are still read from
 * Shopify on demand; orderName is only a snapshot for lists.
 */
export const shopifyOrderLinks = pgTable(
  "shopify_order_links",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    shopifyStoreId: integer("shopify_store_id").notNull(),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    channelId: integer("channel_id").references(() => channels.id, { onDelete: "set null" }),
    shopifyOrderId: varchar("shopify_order_id", { length: 100 }).notNull(), // gid://shopify/Order/…
    orderName: varchar("order_name", { length: 100 }), // e.g. "#1001", as shown in Shopify
    source: varchar("source", { length: 20 }).default(ShopifyLinkSource.MANUAL).notNull(),
    linkedById: integer("linked_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: "fk_shopify_order_links_org_store",
      columns: [table.organizationId, table.shopifyStoreId],
      foreignColumns: [shopifyStores.organizationId, shopifyStores.id],
    }).onDelete("cascade"),
    unique("uq_shopify_order_links_store_order").on(table.shopifyStoreId, table.shopifyOrderId),
    index("idx_shopify_order_links_org_customer").on(table.organizationId, table.customerId),
    index("idx_shopify_order_links_channel").on(table.channelId),
  ]
);

export const shopifyStoresRelations = relations(shopifyStores, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [shopifyStores.organizationId],
    references: [organizations.id],
  }),
  connectedBy: one(users, {
    fields: [shopifyStores.connectedById],
    references: [users.id],
  }),
  customerLinks: many(shopifyCustomerLinks),
  channelMappings: many(shopifyStoreChannels),
  orderLinks: many(shopifyOrderLinks),
}));

export const shopifyStoreChannelsRelations = relations(shopifyStoreChannels, ({ one }) => ({
  organization: one(organizations, {
    fields: [shopifyStoreChannels.organizationId],
    references: [organizations.id],
  }),
  store: one(shopifyStores, {
    fields: [shopifyStoreChannels.shopifyStoreId],
    references: [shopifyStores.id],
  }),
  channel: one(channels, {
    fields: [shopifyStoreChannels.channelId],
    references: [channels.id],
  }),
}));

export const shopifyCustomerLinksRelations = relations(shopifyCustomerLinks, ({ one }) => ({
  organization: one(organizations, {
    fields: [shopifyCustomerLinks.organizationId],
    references: [organizations.id],
  }),
  store: one(shopifyStores, {
    fields: [shopifyCustomerLinks.shopifyStoreId],
    references: [shopifyStores.id],
  }),
  customer: one(customers, {
    fields: [shopifyCustomerLinks.customerId],
    references: [customers.id],
  }),
  linkedBy: one(users, {
    fields: [shopifyCustomerLinks.linkedById],
    references: [users.id],
  }),
}));

export const shopifyOrderLinksRelations = relations(shopifyOrderLinks, ({ one }) => ({
  organization: one(organizations, {
    fields: [shopifyOrderLinks.organizationId],
    references: [organizations.id],
  }),
  store: one(shopifyStores, {
    fields: [shopifyOrderLinks.shopifyStoreId],
    references: [shopifyStores.id],
  }),
  customer: one(customers, {
    fields: [shopifyOrderLinks.customerId],
    references: [customers.id],
  }),
  channel: one(channels, {
    fields: [shopifyOrderLinks.channelId],
    references: [channels.id],
  }),
  linkedBy: one(users, {
    fields: [shopifyOrderLinks.linkedById],
    references: [users.id],
  }),
}));

export type ShopifyStore = typeof shopifyStores.$inferSelect;
export type NewShopifyStore = typeof shopifyStores.$inferInsert;
export type ShopifyStoreChannel = typeof shopifyStoreChannels.$inferSelect;
export type NewShopifyStoreChannel = typeof shopifyStoreChannels.$inferInsert;
export type ShopifyCustomerLink = typeof shopifyCustomerLinks.$inferSelect;
export type NewShopifyCustomerLink = typeof shopifyCustomerLinks.$inferInsert;
export type ShopifyOrderLink = typeof shopifyOrderLinks.$inferSelect;
export type NewShopifyOrderLink = typeof shopifyOrderLinks.$inferInsert;
