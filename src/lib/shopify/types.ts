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
  /** The primary store, used by the inbox for products, customers and orders */
  store: ShopifyStoreInfo | null;
  /** Every connected store (or needing re-authorization), oldest first */
  stores: ShopifyStoreInfo[];
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
  linkedAt: string;
  linkedByName: string | null;
}

/** GET /api/integrations/shopify/contacts/:customerId/orders */
export interface ShopifyContactOrdersResponse {
  success: true;
  connected: boolean;
  link: ShopifyCustomerLinkInfo | null;
  /** Null when the linked customer no longer exists in Shopify */
  shopifyCustomer: ShopifyCustomerSummary | null;
  orders: ShopifyPage<ShopifyOrder>;
}
