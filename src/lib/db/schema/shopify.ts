import { pgTable, serial, integer, varchar, text, timestamp, index, unique } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { organizations } from "./organizations";
import { users } from "./users";
import { customers } from "./customers";

/**
 * Shopify integration. Products, variants and orders are fetched from Shopify on demand;
 * only the store connection and the contact ↔ Shopify customer links are stored here.
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
    lastError: text("last_error"),
    connectedById: integer("connected_by_id").references(() => users.id, { onDelete: "set null" }),
    connectedAt: timestamp("connected_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    // Reconnecting the same shop reuses its row, so existing contact links survive a disconnect
    unique("uq_shopify_stores_org_domain").on(table.organizationId, table.shopDomain),
    // An organization can connect several stores
    index("idx_shopify_stores_org").on(table.organizationId),
    index("idx_shopify_stores_domain").on(table.shopDomain),
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
    unique("uq_shopify_links_store_customer").on(table.shopifyStoreId, table.customerId),
    unique("uq_shopify_links_store_shopify_customer").on(table.shopifyStoreId, table.shopifyCustomerId),
    index("idx_shopify_links_org_customer").on(table.organizationId, table.customerId),
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

export type ShopifyStore = typeof shopifyStores.$inferSelect;
export type NewShopifyStore = typeof shopifyStores.$inferInsert;
export type ShopifyCustomerLink = typeof shopifyCustomerLinks.$inferSelect;
export type NewShopifyCustomerLink = typeof shopifyCustomerLinks.$inferInsert;
