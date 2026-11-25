/**
 * Order data sent to the AI service with each conversation turn (`commerce` in POST /v1/chat).
 * Platform-neutral: every store platform (Shopify today) is mapped into these shapes, so the AI service never
 * needs store tokens or platform APIs. Mirrors CommerceContext in ai-service/app/models.py — change both together.
 * Addresses, payment details and line-item prices are deliberately left out: replies never show them.
 */

export type AgentOrderStatus = "Pending" | "Shipped" | "Delivered" | "Returned" | "Cancelled";

/**
 * Where the order is being delivered. Shown only to the customer who owns the order (verified identity), in a
 * reply built by code: the AI model never receives it, and it's blanked out of the AI logs.
 */
export interface AgentAddress {
  name: string | null;
  line1: string | null;
  line2: string | null;
  city: string | null;
  province: string | null;
  zip: string | null;
  country: string | null;
  /** Last 4 digits of the delivery phone only */
  phone_last4: string | null;
}

export interface AgentOrder {
  /** As the customer sees it, e.g. "#1001" */
  order_number: string;
  /** Platform id, e.g. gid://shopify/Order/123 */
  order_id: string | null;
  /** "Linen shirt + 2 more" */
  items: string;
  quantity: number;
  /** Only for the "hand over high-value orders" rule */
  total: number | null;
  currency: string | null;
  status: AgentOrderStatus;
  /** Carrier detail beyond "shipped": in_transit, out_for_delivery, attempted_delivery, ready_for_pickup, failure */
  delivery_status: string | null;
  partially_shipped: boolean;
  order_date: string;
  shipping_date: string | null;
  expected_delivery: string | null;
  delivered_at: string | null;
  cancelled_at: string | null;
  courier: string | null;
  tracking_number: string | null;
  tracking_url: string | null;
  /** Null when unknown, or the store hasn't granted access to addresses */
  shipping_address?: AgentAddress | null;
  /**
   * Test data only (AI agent > Test data): every column of the uploaded file for this order, by its header as
   * written. Columns whose value differs between the order's item rows are in `item_details`, one entry per item.
   * Orders from connected stores never carry these.
   */
  details?: Record<string, string>;
  item_details?: Record<string, string>[];
}

export interface AgentStoreOrders {
  /** "<platform>:<store id in UnoCX>", e.g. "shopify:12" */
  ref: string;
  platform: string;
  name: string | null;
  /** unavailable: the store couldn't be read right now (connection needs re-authorizing, timeout) */
  status: "ok" | "unavailable";
  /** The store's customer id; null when no customer of this store is linked to / matches the contact */
  customer_ref: string | null;
  customer_name: string | null;
  orders: AgentOrder[];
}

export interface AgentCommerceContext {
  /** no_store: the workspace has stores, but none applies to this conversation's channel */
  status: "ok" | "no_store";
  stores: AgentStoreOrders[];
}

/** Who the conversation is with, as far as the store lookup is concerned */
export type CommerceSubject =
  /** A real contact: its profile's store links are used (and matched automatically, like the contact panel) */
  | { kind: "contact"; profileId: number }
  /** Dashboard test chats: a read-only lookup by the tester's "test as" details; nothing is linked */
  | { kind: "test"; phone?: string | null; email?: string | null };

/** A connected store of one platform, as the resolver hands it to that platform's provider */
export interface CommerceStoreRef<S = unknown> {
  platform: string;
  id: number;
  name: string | null;
  needsReauth: boolean;
  raw: S;
}

/**
 * One store platform. Adding a platform (WooCommerce, Magento, ...) means implementing this and registering it
 * in ./index.ts; nothing in the AI service or the automation engine changes.
 */
export interface CommerceProvider<S = unknown> {
  platform: string;
  /** Active stores of the workspace (connected, or needing re-authorization) */
  listStores(organizationId: number): Promise<CommerceStoreRef<S>[]>;
  /** The store a channel is connected to, if any */
  storeForChannel(organizationId: number, channelId: number): Promise<CommerceStoreRef<S> | null>;
  /** Whether the contact profile is already linked to a customer of this store (no remote call) */
  isLinked(organizationId: number, store: CommerceStoreRef<S>, profileId: number): Promise<boolean>;
  /** The subject's customer and latest orders in this store. Throws when the store can't be read. */
  customerOrders(
    organizationId: number,
    store: CommerceStoreRef<S>,
    subject: CommerceSubject
  ): Promise<{ customerRef: string | null; customerName: string | null; orders: AgentOrder[] }>;
}
