import { pgTable, serial, integer, varchar, text, timestamp, jsonb, index, unique, foreignKey } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { organizations } from "./organizations";
import { users } from "./users";
import { channels } from "./channels";

/**
 * Platform-agnostic store connections ("commerce" = any e-commerce platform UnoCX can connect to).
 *
 * WooCommerce is the first platform stored here. Shopify still uses its own tables (shopify_stores,
 * shopify_store_channels, ...) and is meant to move here later as platform = 'shopify'. A channel can be connected
 * to stores of both platforms at once.
 *
 * Isolation follows the Shopify tables: every row carries organization_id, and rows that point at a store or a
 * channel use a composite (organization_id, id) foreign key, so the database rejects a row that ties one
 * workspace's data to another workspace's store or channel.
 */

export const CommercePlatform = {
  WOOCOMMERCE: "woocommerce",
  // SHOPIFY: "shopify",   // after shopify_stores is migrated
  // MAGENTO, BIGCOMMERCE, ...
} as const;

export type CommercePlatformValue = (typeof CommercePlatform)[keyof typeof CommercePlatform];

export const CommerceStoreStatus = {
  CONNECTED: "connected",
  REAUTH_REQUIRED: "reauth_required", // Credentials rejected by the store (key revoked, permissions lowered, plugin disabled)
  DISCONNECTED: "disconnected",
} as const;

export type CommerceStoreStatusValue = (typeof CommerceStoreStatus)[keyof typeof CommerceStoreStatus];

/**
 * Secrets of a connection, stored AES-256-GCM encrypted (security/crypto) as one JSON document in
 * commerce_stores.credentials. Never sent to the browser.
 */
export type CommerceCredentials =
  | { platform: "woocommerce"; consumerKey: string; consumerSecret: string };

/**
 * Non-secret details of a connection that only matter to one platform. Safe to show to admins.
 *  - WooCommerce: the API key's id and permissions, the WordPress user who approved it, how to reach the REST API
 *    (pretty permalinks or ?rest_route=) and how to authenticate (Authorization header or query string).
 */
export interface CommerceStoreSettings {
  keyId?: number | null;
  keyPermissions?: string | null; // read | write | read_write
  wpUserId?: string | null;
  restMode?: "wp-json" | "rest-route";
  authMode?: "header" | "query" | "oauth1";
  wcVersion?: string | null;
  wpVersion?: string | null;
  timezone?: string | null;
  [key: string]: unknown;
}

export const commerceStores = pgTable(
  "commerce_stores",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    platform: varchar("platform", { length: 30 }).notNull(), // CommercePlatform
    storeUrl: text("store_url").notNull(), // Normalized base URL, e.g. https://shop.example.com or https://example.com/shop
    storeHost: varchar("store_host", { length: 255 }).notNull(), // Lower-cased host (+ path), identity of the store; used by users.stores
    externalId: varchar("external_id", { length: 255 }), // Platform's own id of the store, if it has one
    name: varchar("name", { length: 255 }),
    email: varchar("email", { length: 255 }),
    currencyCode: varchar("currency_code", { length: 10 }),
    credentials: text("credentials"), // Encrypted JSON (CommerceCredentials); null once disconnected
    settings: jsonb("settings").$type<CommerceStoreSettings>().default({}).notNull(),
    scopes: text("scopes"), // Comma-separated permissions granted (WooCommerce: read | write | read_write)
    status: varchar("status", { length: 30 }).default(CommerceStoreStatus.CONNECTED).notNull(),
    lastError: text("last_error"),
    lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true, mode: "date" }),
    connectedById: integer("connected_by_id").references(() => users.id, { onDelete: "set null" }),
    connectedAt: timestamp("connected_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    // Reconnecting the same store reuses its row, so its channel mappings survive a disconnect
    unique("uq_commerce_stores_org_platform_host").on(table.organizationId, table.platform, table.storeHost),
    // Target of the composite (organization_id, store_id) foreign keys below
    unique("uq_commerce_stores_org_id").on(table.organizationId, table.id),
    index("idx_commerce_stores_org_platform").on(table.organizationId, table.platform),
  ]
);

/**
 * Which stores a channel (WhatsApp number, Instagram account, Messenger page, ...) works with. Many to many: a
 * channel can use several stores, on this platform and on Shopify at the same time, and a store can serve many
 * channels. A (store, channel) pair exists at most once. Rows are kept while the store is disconnected, so
 * reconnecting it restores its channels.
 */
export const commerceStoreChannels = pgTable(
  "commerce_store_channels",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    storeId: integer("store_id").notNull(),
    channelId: integer("channel_id").notNull(),
    createdById: integer("created_by_id").references(() => users.id, { onDelete: "set null" }),
    updatedById: integer("updated_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: "fk_commerce_store_channels_store",
      columns: [table.organizationId, table.storeId],
      foreignColumns: [commerceStores.organizationId, commerceStores.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "fk_commerce_store_channels_channel",
      columns: [table.organizationId, table.channelId],
      foreignColumns: [channels.organizationId, channels.id],
    }).onDelete("cascade"),
    // A channel can use many stores, each at most once
    unique("uq_commerce_store_channels_store_channel").on(table.storeId, table.channelId),
    index("idx_commerce_store_channels_org_store").on(table.organizationId, table.storeId),
    index("idx_commerce_store_channels_org_channel").on(table.organizationId, table.channelId),
  ]
);

export const commerceStoresRelations = relations(commerceStores, ({ one, many }) => ({
  organization: one(organizations, { fields: [commerceStores.organizationId], references: [organizations.id] }),
  connectedBy: one(users, { fields: [commerceStores.connectedById], references: [users.id] }),
  channelMappings: many(commerceStoreChannels),
}));

export const commerceStoreChannelsRelations = relations(commerceStoreChannels, ({ one }) => ({
  organization: one(organizations, { fields: [commerceStoreChannels.organizationId], references: [organizations.id] }),
  store: one(commerceStores, { fields: [commerceStoreChannels.storeId], references: [commerceStores.id] }),
  channel: one(channels, { fields: [commerceStoreChannels.channelId], references: [channels.id] }),
}));

export type CommerceStore = typeof commerceStores.$inferSelect;
export type NewCommerceStore = typeof commerceStores.$inferInsert;
export type CommerceStoreChannel = typeof commerceStoreChannels.$inferSelect;
export type NewCommerceStoreChannel = typeof commerceStoreChannels.$inferInsert;
