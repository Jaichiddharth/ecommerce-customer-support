import { NextRequest, NextResponse } from "next/server";
import { getShopifyConfig } from "@/lib/shopify/config";
import { verifyShopifyWebhookHmac } from "@/lib/shopify/webhooks";
import { createLogger } from "@/lib/logger";
import { db } from "@/lib/db";
import { shopifyStores, ShopifyLinkSource } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { publishToOrg } from "@/lib/realtime";
import { customerRepository } from "@/lib/db/repositories/customer.repository";
import { shopifyRepository } from "@/lib/db/repositories/shopify.repository";
import { forgetStoreOrders } from "@/lib/ai-agent/commerce";

const log = createLogger("ShopifyWebhookReceiver");

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/integrations/shopify/webhooks
 * Receives and processes Shopify webhooks:
 * - orders/create
 * - orders/cancelled
 * - orders/paid
 * - checkouts/create
 * - checkouts/update
 */
export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  const topic = req.headers.get("x-shopify-topic") || "";
  const hmacHeader = req.headers.get("x-shopify-hmac-sha256");
  const shopDomain = req.headers.get("x-shopify-shop-domain") || "";
  const webhookId = req.headers.get("x-shopify-webhook-id") || "";

  if (!topic || !shopDomain) {
    log.warn("Rejected webhook: missing topic or shop domain", { topic, shopDomain });
    return NextResponse.json({ error: "Missing required headers" }, { status: 400 });
  }

  let rawBody = "";
  try {
    rawBody = await req.text();
  } catch (err: any) {
    log.error("Failed to read raw body of Shopify webhook", { err: err?.message });
    return NextResponse.json({ error: "Failed to read request body" }, { status: 400 });
  }

  // Verify HMAC signature
  try {
    const config = getShopifyConfig();
    const isValid = verifyShopifyWebhookHmac(rawBody, hmacHeader, config.apiSecret);
    if (!isValid) {
      log.warn("Shopify webhook rejected: HMAC verification failed", { shopDomain, topic, webhookId });
      return NextResponse.json({ error: "Invalid webhook signature" }, { status: 401 });
    }
  } catch (err: any) {
    log.error("Shopify webhook secret missing or verification failed", { err: err?.message });
    return NextResponse.json({ error: "Webhook verification misconfigured" }, { status: 500 });
  }

  let payload: any = {};
  try {
    payload = JSON.parse(rawBody);
  } catch {
    log.warn("Shopify webhook payload is not valid JSON", { shopDomain, topic });
  }

  // Look up store in database to ensure tenant isolation & active connection
  const [store] = await db
    .select({
      id: shopifyStores.id,
      organizationId: shopifyStores.organizationId,
      status: shopifyStores.status,
    })
    .from(shopifyStores)
    .where(eq(shopifyStores.shopDomain, shopDomain))
    .limit(1);

  if (!store) {
    log.warn("Shopify webhook received for unknown store", { shopDomain, topic });
    return NextResponse.json({ received: true, warning: "Store not found" });
  }

  // Extract customer contact identifiers from order or checkout payload
  const customerPhone =
    payload?.customer?.phone ||
    payload?.phone ||
    payload?.shipping_address?.phone ||
    payload?.billing_address?.phone ||
    null;
  const customerEmail = payload?.customer?.email || payload?.email || null;
  const orderNumber = payload?.order_number
    ? `#${payload.order_number}`
    : payload?.name || (payload?.id ? `#${payload.id}` : "");
  const shopifyOrderId = payload?.admin_graphql_api_id || (payload?.id ? `gid://shopify/Order/${payload.id}` : null);
  const shopifyCustomerId =
    payload?.customer?.admin_graphql_api_id ||
    (payload?.customer?.id ? `gid://shopify/Customer/${payload.customer.id}` : null);

  let matchedCustomerId: number | null = null;
  try {
    if (customerPhone) {
      const contact = await customerRepository.findByPhone(store.organizationId, customerPhone);
      if (contact) matchedCustomerId = contact.id;
    }
    if (!matchedCustomerId && customerEmail) {
      const contact = await customerRepository.findByEmail(store.organizationId, customerEmail);
      if (contact) matchedCustomerId = contact.id;
    }
  } catch (findErr: any) {
    log.warn("Error matching customer for incoming Shopify order", { err: findErr?.message });
  }

  log.info(`Shopify webhook processed: ${topic}`, {
    organizationId: store.organizationId,
    storeId: store.id,
    shopDomain,
    topic,
    webhookId,
    orderId: payload?.id,
    orderNumber,
    matchedCustomerId,
    durationMs: Date.now() - startedAt,
  });

  // The AI agent's cached order data for this store is stale now
  if (topic.startsWith("orders/")) forgetStoreOrders(store.organizationId, `shopify:${store.id}`);

  // Handle specific topics & broadcast realtime events to frontend
  switch (topic) {
    case "orders/create": {
      if (matchedCustomerId) {
        try {
          // Auto-link customer if unlinked
          if (shopifyCustomerId) {
            await shopifyRepository.upsertLink({
              organizationId: store.organizationId,
              storeId: store.id,
              customerId: matchedCustomerId,
              shopifyCustomerId,
              linkedById: null,
              source: ShopifyLinkSource.AUTO,
            });
          }
          // Associate order link
          if (shopifyOrderId) {
            const existingOrderLink = await shopifyRepository.findOrderLinkByOrder(
              store.organizationId,
              store.id,
              shopifyOrderId
            );
            if (!existingOrderLink) {
              await shopifyRepository.createOrderLink({
                organizationId: store.organizationId,
                storeId: store.id,
                customerId: matchedCustomerId,
                channelId: null,
                shopifyOrderId,
                orderName: orderNumber,
                linkedById: null,
                source: ShopifyLinkSource.AUTO,
              });
            }
          }
        } catch (linkErr: any) {
          log.warn("Could not auto-link incoming Shopify order to customer profile", { err: linkErr?.message });
        }
      }

      // Realtime event to UI: New order created
      publishToOrg(store.organizationId, {
        type: "shopify.order.created",
        storeId: store.id,
        shopDomain,
        customerId: matchedCustomerId,
        order: {
          id: payload.id,
          orderNumber,
          totalPrice: payload.total_price || payload.current_total_price || null,
          currency: payload.currency || payload.presentment_currency || null,
          financialStatus: payload.financial_status || null,
          customerEmail: customerEmail || null,
          customerPhone: customerPhone || null,
          customerName:
            [payload.customer?.first_name, payload.customer?.last_name].filter(Boolean).join(" ") || null,
          createdAt: payload.created_at || new Date().toISOString(),
        },
      });
      break;
    }

    case "orders/cancelled": {
      publishToOrg(store.organizationId, {
        type: "shopify.order.updated",
        storeId: store.id,
        shopDomain,
        customerId: matchedCustomerId,
        order: {
          id: payload.id,
          orderNumber,
          financialStatus: payload.financial_status || null,
          fulfillmentStatus: payload.fulfillment_status || null,
          cancelReason: payload.cancel_reason || null,
          cancelledAt: payload.cancelled_at || new Date().toISOString(),
        },
      });
      break;
    }

    case "orders/paid": {
      publishToOrg(store.organizationId, {
        type: "shopify.order.updated",
        storeId: store.id,
        shopDomain,
        customerId: matchedCustomerId,
        order: {
          id: payload.id,
          orderNumber,
          financialStatus: payload.financial_status || "paid",
          fulfillmentStatus: payload.fulfillment_status || null,
        },
      });
      break;
    }

    case "checkouts/create":
    case "checkouts/update": {
      publishToOrg(store.organizationId, {
        type: "shopify.checkout.updated",
        storeId: store.id,
        shopDomain,
        customerId: matchedCustomerId,
        checkout: {
          token: payload.token || "",
          email: payload.email || customerEmail || null,
          totalPrice: payload.total_price || null,
        },
      });
      break;
    }

    default:
      log.info(`Unhandled Shopify webhook topic: ${topic}`, { storeId: store.id });
      break;
  }

  return NextResponse.json({
    received: true,
    topic,
    webhookId,
    storeId: store.id,
    matchedCustomerId,
  });
}

