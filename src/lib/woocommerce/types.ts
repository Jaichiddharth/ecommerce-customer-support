/**
 * Shapes returned by /api/integrations/woocommerce/*. Shared by the API routes and the UI, so this file must stay
 * free of server-only imports.
 */

import type { ChannelStoreLink } from "../shopify/types";

export type { ChannelStoreLink };

export type CommerceStoreStatusName = "connected" | "reauth_required" | "disconnected";

export interface WooCommerceStoreInfo {
  id: number;
  platform: "woocommerce";
  /** https://shop.example.com (sub-directory installs keep their path) */
  storeUrl: string;
  /** shop.example.com: the store's identity, also what users.stores lists */
  storeHost: string;
  name: string | null;
  currencyCode: string | null;
  status: CommerceStoreStatusName | string;
  /** Permission of the generated API key: read | write | read_write */
  keyPermissions: string | null;
  /** WooCommerce's id of the generated key (WooCommerce → Settings → Advanced → REST API) */
  keyId: number | null;
  isHttps: boolean;
  lastError: string | null;
  lastVerifiedAt: string | null;
  connectedAt: string;
  connectedByName: string | null;
}

export interface WooCommerceConnectionResponse {
  success: true;
  /** False when the server has no HTTPS app URL for WooCommerce to send keys to */
  configured: boolean;
  /** Permission requested for new keys */
  scope: "read" | "write" | "read_write";
  stores: WooCommerceStoreInfo[];
}

/** Short reference to a store of any commerce platform */
export interface CommerceStoreRef {
  id: number;
  platform: string;
  storeHost: string;
  name: string | null;
  status: string;
}

/** One channel ↔ store connection in commerce_store_channels */
export interface CommerceChannelMapping {
  id: number;
  storeId: number;
  channelId: number;
  channel: { id: number; name: string; type: string; status: string; handle: string | null; phoneNumber: string | null };
  store: CommerceStoreRef;
  createdAt: string;
  updatedAt: string;
}

export interface WooCommerceStoreWithChannels extends WooCommerceStoreInfo {
  channels: CommerceChannelMapping[];
}

/** Which WooCommerce stores every live channel is connected to: GET /api/integrations/woocommerce/channel-mappings */
export interface CommerceChannelStoreStatus {
  channelId: number;
  name: string;
  type: string;
  status: string;
  /** Every store of the platform the channel is connected to, oldest connection first; empty when none */
  links: ChannelStoreLink[];
}

/** A WooCommerce store a channel is connected to (for the inbox): GET /api/integrations/woocommerce/channel-store */
export interface WooCommerceChannelStore {
  id: number;
  name: string | null;
  storeUrl: string;
  storeHost: string;
  status: "connected" | "reauth_required";
  currencyCode: string | null;
}

export interface WooCommerceStoreOverview {
  name: string;
  storeUrl: string;
  description: string | null;
  currencyCode: string | null;
  timezone: string | null;
  /** null when the store didn't return the count (report endpoints disabled, permission missing) */
  counts: { products: number | null; orders: number | null; customers: number | null };
}

/* ---------------- Inbox: products, sharing, orders ---------------- */

/** One product in the inbox's product search: GET /api/integrations/woocommerce/products */
export interface WooProductSummary {
  id: number;
  name: string;
  imageUrl: string | null;
  /** Current price ("" when the store has none, e.g. a variable product without priced variations) */
  price: string;
  currencyCode: string;
  available: boolean;
  /** simple | variable | grouped | external */
  type: string;
  variationsCount: number;
  sku: string | null;
}

export interface WooProductPage {
  items: WooProductSummary[];
  page: number;
  hasNextPage: boolean;
}

/** A purchasable option of a variable product (Size: L, Color: Blue) */
export interface WooVariation {
  id: number;
  price: string;
  regularPrice: string | null;
  sku: string | null;
  available: boolean;
  imageUrl: string | null;
  /** The variation's attribute values; an attribute missing here means "any value" */
  attributes: { name: string; option: string }[];
}

/** GET /api/integrations/woocommerce/products/:id */
export interface WooProductDetail {
  id: number;
  name: string;
  type: string;
  /** Plain text (HTML removed) */
  description: string | null;
  permalink: string | null;
  sku: string | null;
  price: string;
  regularPrice: string | null;
  currencyCode: string;
  available: boolean;
  images: { url: string; altText: string | null }[];
  /** Attributes used for variations, with their values */
  attributes: { name: string; options: string[] }[];
  /** Empty for simple products */
  variations: WooVariation[];
  hasMoreVariations: boolean;
}

/** One order of the contact: GET /api/integrations/woocommerce/contacts/:customerId/orders */
export interface WooOrderSummary {
  id: number;
  number: string;
  status: string;
  total: string;
  currencyCode: string;
  createdAt: string | null;
  items: { name: string; quantity: number }[];
  /** Order page in the store's WordPress admin */
  adminUrl: string;
}

export interface WooContactOrders {
  store: { id: number; name: string | null; storeHost: string };
  /** How the contact was matched to the store's orders: their email, their phone number, or nothing to match on */
  matchedBy: "email" | "phone" | "email_or_phone" | null;
  orders: WooOrderSummary[];
}
