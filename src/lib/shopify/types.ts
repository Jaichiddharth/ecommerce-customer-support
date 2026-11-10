/**
 * Shapes returned by /api/integrations/shopify/*. Shared by the API routes and the UI,
 * so this file must stay free of server-only imports.
 */

export interface ShopifyMoney {
  amount: string;
  currencyCode: string;
}

export interface ShopifyStoreInfo {
  id: number;
  shopDomain: string;
  name: string | null;
  email: string | null;
  currencyCode: string | null;
  primaryDomainUrl: string | null;
  status: "connected" | "reauth_required" | "disconnected" | string;
  scopes: string[];
  missingScopes: string[];
  lastError: string | null;
  connectedAt: string;
  connectedByName: string | null;
}

export interface ShopifyConnectionResponse {
  success: true;
  /** False when the server has no Shopify app credentials; the UI then explains it instead of offering Connect. */
  configured: boolean;
  /** "private" until the app is published with Public distribution (SHOPIFY_APP_DISTRIBUTION); only then can external stores connect */
  distribution: "private" | "public";
  /** Every connected store (or needing re-authorization), oldest first. There is no default store. */
  stores: ShopifyStoreInfo[];
}

/**
 * The store a WhatsApp number (channel) is connected to: GET /api/integrations/shopify/channel-store?channelId=.
 * The inbox only shows Shopify for a conversation whose number has one.
 */
export interface ShopifyChannelStore {
  id: number;
  name: string | null;
  shopDomain: string;
  status: "connected" | "reauth_required";
  currencyCode: string | null;
}

export interface ShopifyChannelStoreResponse {
  success: true;
  /** null: the number isn't connected to a store (or the store is disconnected, or the member can't use it) */
  store: ShopifyChannelStore | null;
  /** Whether the workspace has a store this member can use: "Associate a store" (true) or "Connect a store" (false) */
  hasStores: boolean;
}

/** Short reference to the store a response's data came from */
export interface ShopifyStoreRef {
  id: number;
  shopDomain: string;
  name: string | null;
  status: string;
}

/** One channel ↔ store mapping */
export interface ShopifyChannelMapping {
  id: number;
  storeId: number;
  channelId: number;
  channel: { id: number; name: string; type: string; status: string; handle: string | null; phoneNumber: string | null };
  store: ShopifyStoreRef;
  createdAt: string;
  updatedAt: string;
}

/** A store with the channels mapped to it: GET /api/integrations/shopify/stores[/:storeId] */
export interface ShopifyStoreWithChannels extends ShopifyStoreInfo {
  channels: ShopifyChannelMapping[];
}

/**
 * Which store each live channel uses: its mapping, or none (there is no default store).
 * GET /api/integrations/shopify/channel-mappings → `channels`
 */
export interface ShopifyChannelStoreStatus {
  channelId: number;
  name: string;
  type: string;
  status: string;
  mappingId: number | null;
  /** The store the channel uses right now; null when it has none (e.g. its mapped store is disconnected) */
  effectiveStoreId: number | null;
  via: "mapping" | "none";
}

/**
 * What disconnecting a channel from its store removes: the store's contact ↔ Shopify customer links and order
 * links of the channel's contacts. Contacts that also use another channel connected to the same store keep theirs.
 * GET /api/integrations/shopify/channel-mappings/:mappingId/impact
 */
export interface ShopifyChannelUnmapImpact {
  mappingId: number;
  channelId: number;
  channelName: string;
  storeId: number;
  storeName: string;
  /** Contacts linked to a Shopify customer of the store */
  linkedContacts: number;
  /** Of linkedContacts: linked by an agent (not re-created automatically on reconnect) */
  manuallyLinkedContacts: number;
  /** Orders linked to the contacts */
  linkedOrders: number;
}

/** DELETE /api/integrations/shopify/channel-mappings/:mappingId */
export interface ShopifyChannelUnmapResult {
  success: true;
  removed: { contactLinks: number; orderLinks: number };
}

/** An order associated with a contact profile: /api/integrations/shopify/contacts/:customerId/order-links */
export interface ShopifyOrderLinkInfo {
  id: number;
  storeId: number;
  store: { id: number; shopDomain: string; name: string | null };
  shopifyOrderId: string;
  orderLegacyId: string;
  orderName: string | null;
  channelId: number | null;
  channelName: string | null;
  source: "auto" | "manual" | string;
  linkedAt: string;
  linkedByName: string | null;
}

export interface ShopifyProductSummary {
  id: string;
  legacyId: string;
  title: string;
  handle: string;
  vendor: string | null;
  imageUrl: string | null;
  priceMin: ShopifyMoney | null;
  priceMax: ShopifyMoney | null;
  variantsCount: number;
  available: boolean;
  sku: string | null;
  productUrl: string | null;
}

export interface ShopifyProductOption {
  name: string;
  values: string[];
}

export interface ShopifyVariant {
  id: string;
  legacyId: string;
  title: string;
  sku: string | null;
  barcode: string | null;
  price: string;
  compareAtPrice: string | null;
  available: boolean;
  selectedOptions: { name: string; value: string }[];
  imageUrl: string | null;
}

export interface ShopifyProductDetail {
  id: string;
  legacyId: string;
  title: string;
  handle: string;
  status: string;
  vendor: string | null;
  productType: string | null;
  description: string;
  currencyCode: string;
  images: { url: string; altText: string | null }[];
  options: ShopifyProductOption[];
  variants: ShopifyVariant[];
  /** True when the product has more variants than were loaded; selection is then validated on the server */
  hasMoreVariants: boolean;
  productUrl: string | null;
}

export interface ShopifyCustomerSummary {
  id: string;
  legacyId: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  numberOfOrders: number;
  amountSpent: ShopifyMoney | null;
  /** The customer's tags in Shopify (e.g. "VIP", "wholesale") */
  tags: string[];
  createdAt: string;
}

export interface ShopifyOrderLineItem {
  id: string;
  title: string;
  variantTitle: string | null;
  quantity: number;
  sku: string | null;
  imageUrl: string | null;
}

export interface ShopifyOrder {
  id: string;
  legacyId: string;
  name: string;
  createdAt: string;
  cancelledAt: string | null;
  closed: boolean;
  financialStatus: string | null;
  fulfillmentStatus: string | null;
  total: ShopifyMoney | null;
  lineItems: ShopifyOrderLineItem[];
  moreLineItems: boolean;
  adminUrl: string;
}

export interface ShopifyPage<T> {
  items: T[];
  hasNextPage: boolean;
  endCursor: string | null;
}

export interface ShopifyCustomerLinkInfo {
  id: number;
  shopifyCustomerId: string;
  /** "auto": matched by the contact's phone number or email; "manual": chosen by an agent */
  source: "auto" | "manual" | string;
  linkedAt: string;
  linkedByName: string | null;
}

/**
 * Why a contact has no linked Shopify customer:
 * - none: no Shopify customer has the phone numbers or emails of the contact's channels
 * - review: several customers match (or the only match is linked to another contact), so an agent has to choose
 * - dismissed: an agent unlinked the contact, so it isn't matched automatically again
 * - no_details: the contact has no phone number or email to match on
 */
export type ShopifyAutoMatchStatus = "none" | "review" | "dismissed" | "no_details";

/** GET /api/integrations/shopify/contacts/:customerId/orders */
export interface ShopifyContactOrdersResponse {
  success: true;
  connected: boolean;
  /** The store the contact's channel uses (its mapping); null when the channel isn't connected to a store */
  store: ShopifyStoreRef | null;
  link: ShopifyCustomerLinkInfo | null;
  /** Null when the linked customer no longer exists in Shopify */
  shopifyCustomer: ShopifyCustomerSummary | null;
  orders: ShopifyPage<ShopifyOrder>;
  /** Set when there's no link: the result of matching the contact's phone numbers and emails */
  autoMatch: { status: ShopifyAutoMatchStatus; candidates: ShopifyCustomerSummary[] } | null;
}

/** A count from Shopify; atLeast when Shopify stopped counting at its limit */
export interface ShopifyCount {
  count: number;
  atLeast: boolean;
}

/** Live details of a store, read from Shopify: GET /api/integrations/shopify/stores/:storeId/overview */
export interface ShopifyStoreOverview {
  name: string;
  email: string | null;
  contactEmail: string | null;
  myshopifyDomain: string;
  currencyCode: string;
  timezone: string | null;
  /** When the shop was created in Shopify */
  shopCreatedAt: string | null;
  plan: { name: string | null; shopifyPlus: boolean; developmentStore: boolean };
  /** "City, Province, Country" of the store's address */
  address: string | null;
  storefrontUrl: string | null;
  counts: { products: ShopifyCount | null; customers: ShopifyCount | null; orders: ShopifyCount | null };
}

/** One row of a store's customer list: GET /api/integrations/shopify/stores/:storeId/customers */
export interface ShopifyStoreCustomer extends ShopifyCustomerSummary {
  /** "City, CC" of the default address */
  location: string | null;
  lastOrder: { name: string; createdAt: string } | null;
  /** The UnoCX contact this customer is linked to in this store */
  linkedContact: { id: number; name: string } | null;
  adminUrl: string;
}

export type ShopifyCustomerListSort = "updated" | "created" | "name";

/** One row of a store's order list: GET /api/integrations/shopify/stores/:storeId/orders */
export interface ShopifyStoreOrder extends ShopifyOrder {
  /** Null for guest checkouts and deleted customers */
  customer: { id: string; legacyId: string; displayName: string; email: string | null } | null;
}

/** Order list filter, as Shopify's order `status` search values */
export type ShopifyOrderStatusFilter = "any" | "open" | "closed" | "cancelled";

/** GET /api/integrations/shopify/stores/:storeId/customers/:customerId/orders */
export interface ShopifyCustomerOrdersPage {
  /** Null when the customer no longer exists in the store */
  customer: ShopifyCustomerSummary | null;
  orders: ShopifyPage<ShopifyOrder>;
}

/** GET /api/integrations/shopify/orders?q= */
export interface ShopifyOrderSearchResult {
  order: ShopifyOrder;
  /** Null for guest checkouts and deleted customers: such an order can't be linked to a contact */
  customer: ShopifyCustomerSummary | null;
}
