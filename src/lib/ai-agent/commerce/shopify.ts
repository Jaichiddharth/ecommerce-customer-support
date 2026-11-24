import { shopifyRepository, type ShopifyStoreWithUser } from "@/lib/db/repositories/shopify.repository";
import { ShopifyStoreStatus } from "@/lib/db/schema";
import { shopifyService } from "@/lib/services/shopify.service";
import type { AgentAddress, AgentOrder, CommerceProvider, CommerceStoreRef } from "./types";

type Node = Record<string, any>;

/** How many recent orders the agent can talk about per store */
const ORDERS_PER_STORE = 10;

const DELIVERY_STATUS: Record<string, string> = {
  IN_TRANSIT: "in_transit",
  OUT_FOR_DELIVERY: "out_for_delivery",
  ATTEMPTED_DELIVERY: "attempted_delivery",
  READY_FOR_PICKUP: "ready_for_pickup",
  FAILURE: "failure",
  NOT_DELIVERED: "failure",
};

const LIVE_FULFILLMENT = new Set(["SUCCESS", "OPEN", "PENDING"]);
const isDelivered = (f: Node) => Boolean(f.deliveredAt) || f.displayStatus === "DELIVERED" || f.displayStatus === "PICKED_UP";
const latest = (dates: (string | null | undefined)[]) => dates.filter(Boolean).sort().pop() ?? null;

/** One Shopify order (AGENT_ORDERS_QUERY) in the AI service's platform-neutral shape */
const clip = (v: unknown, n = 120): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);

/** A Shopify address (GraphQL or REST field names) as the AI service's shipping address; null when empty */
export function toAgentAddress(a: Node | null | undefined): AgentAddress | null {
  if (!a || typeof a !== "object") return null;
  const name = clip(a.name) ?? clip([a.firstName ?? a.first_name, a.lastName ?? a.last_name].filter(Boolean).join(" "));
  const line1 = clip(a.address1, 200);
  const city = clip(a.city);
  const zip = clip(a.zip, 20);
  if (!line1 && !city && !zip) return null;
  const digits = String(a.phone ?? "").replace(/\D/g, "");
  return {
    name,
    line1,
    line2: clip(a.address2, 200),
    city,
    province: clip(a.province),
    zip,
    country: clip(a.country),
    phone_last4: digits.length >= 4 ? digits.slice(-4) : null,
  };
}

export function toAgentOrder(o: Node): AgentOrder {
  const lines: Node[] = o.lineItems?.nodes ?? [];
  const more = Math.max(0, lines.length - 1) + (o.lineItems?.pageInfo?.hasNextPage ? 1 : 0);
  const first = lines[0]?.title ? String(lines[0].title).slice(0, 120) : "your items";
  const items = more > 0 ? `${first} + ${o.lineItems?.pageInfo?.hasNextPage ? "more" : `${more} more`}` : first;
  const quantity = Number(o.currentSubtotalLineItemsQuantity ?? lines.reduce((n, li) => n + Number(li.quantity ?? 0), 0)) || 1;
  const amount = o.totalPriceSet?.shopMoney?.amount;

  const order: AgentOrder = {
    order_number: String(o.name ?? "").slice(0, 60) || "your order",
    order_id: o.id ?? null,
    items,
    quantity,
    total: amount !== undefined && amount !== null ? Number(amount) : null,
    currency: o.totalPriceSet?.shopMoney?.currencyCode ?? null,
    status: "Pending",
    delivery_status: null,
    partially_shipped: false,
    order_date: o.createdAt,
    shipping_date: null,
    expected_delivery: null,
    delivered_at: null,
    cancelled_at: null,
    courier: null,
    tracking_number: null,
    tracking_url: null,
    shipping_address: toAgentAddress(o.shippingAddress),
  };

  if (o.cancelledAt) return { ...order, status: "Cancelled", cancelled_at: o.cancelledAt };

  const shipments = ((o.fulfillments ?? []) as Node[])
    .filter((f) => LIVE_FULFILLMENT.has(f.status))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  if (shipments.length === 0) return order;

  const fullyShipped = o.displayFulfillmentStatus === "FULFILLED";
  if (fullyShipped && shipments.every(isDelivered)) {
    const last = shipments[0];
    return {
      ...order,
      status: "Delivered",
      delivered_at: latest(shipments.map((f) => f.deliveredAt)),
      courier: last.trackingInfo?.[0]?.company ?? null,
      tracking_number: last.trackingInfo?.[0]?.number ?? null,
    };
  }

  // Still on its way: talk about the newest shipment that hasn't arrived
  const f = shipments.find((s) => !isDelivered(s)) ?? shipments[0];
  const tracking = f.trackingInfo?.[0] ?? {};
  return {
    ...order,
    status: "Shipped",
    partially_shipped: !fullyShipped,
    delivery_status: DELIVERY_STATUS[f.displayStatus] ?? null,
    shipping_date: f.inTransitAt ?? f.createdAt ?? null,
    expected_delivery: f.estimatedDeliveryAt ?? null,
    courier: tracking.company ?? null,
    tracking_number: tracking.number ?? null,
    tracking_url: typeof tracking.url === "string" && /^https:\/\//.test(tracking.url) ? tracking.url.slice(0, 500) : null,
  };
}

const toRef = (s: ShopifyStoreWithUser): CommerceStoreRef<ShopifyStoreWithUser> => ({
  platform: "shopify",
  id: s.id,
  name: s.name ?? s.shopDomain,
  needsReauth: s.status === ShopifyStoreStatus.REAUTH_REQUIRED,
  raw: s,
});

export const shopifyCommerceProvider: CommerceProvider<ShopifyStoreWithUser> = {
  platform: "shopify",

  async listStores(organizationId) {
    return (await shopifyRepository.findActiveStores(organizationId)).map(toRef);
  },

  async storeForChannel(organizationId, channelId) {
    // A channel can use several stores: the agent answers from the first one still connected
    const stores = await shopifyRepository.findStoresForChannel(organizationId, channelId);
    const store = stores.find((s) => s.status !== ShopifyStoreStatus.DISCONNECTED);
    return store ? toRef(store) : null;
  },

  async isLinked(organizationId, store, profileId) {
    return Boolean((await shopifyRepository.findLink(organizationId, store.id, profileId))?.shopifyCustomerId);
  },

  async customerOrders(organizationId, store, subject) {
    const customerRef =
      subject.kind === "contact"
        ? await shopifyService.agentCustomerFor(store.raw, organizationId, subject.profileId)
        : await shopifyService.agentFindCustomer(store.raw, subject);
    if (!customerRef) return { customerRef: null, customerName: null, orders: [] };

    const found = await shopifyService.agentCustomerOrders(store.raw, customerRef, ORDERS_PER_STORE);
    // Deleted or merged in Shopify since it was linked: nothing to tell the customer about
    if (!found) return { customerRef: null, customerName: null, orders: [] };
    return { customerRef, customerName: found.name, orders: found.orders.map(toAgentOrder) };
  },
};
