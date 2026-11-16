import { NextRequest, NextResponse } from "next/server";
import { getShopifyConfig } from "@/lib/shopify/config";
import { verifyShopifyWebhookHmac } from "@/lib/shopify/webhooks";
import { createLogger } from "@/lib/logger";
import { db } from "@/lib/db";
import { shopifyStores } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

const log = createLogger("ShopifyWebhookReceiver");

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

  log.info(`Shopify webhook processed: ${topic}`, {
    organizationId: store.organizationId,
    storeId: store.id,
    shopDomain,
    topic,
    webhookId,
    orderId: payload?.id,
    orderNumber: payload?.order_number,
    checkoutToken: payload?.token,
    durationMs: Date.now() - startedAt,
  });

  // Handle specific topics
  switch (topic) {
    case "orders/create":
      log.info("New Shopify order received", {
        storeId: store.id,
        orderId: payload?.id,
        orderNumber: payload?.order_number || payload?.name,
        totalPrice: payload?.total_price,
        customerEmail: payload?.customer?.email || payload?.email,
        customerPhone: payload?.customer?.phone || payload?.phone,
      });
      break;

    case "orders/cancelled":
      log.info("Shopify order cancelled", {
        storeId: store.id,
        orderId: payload?.id,
        cancelReason: payload?.cancel_reason,
        cancelledAt: payload?.cancelled_at,
      });
      break;

    case "orders/paid":
      log.info("Shopify order paid", {
        storeId: store.id,
        orderId: payload?.id,
        financialStatus: payload?.financial_status,
      });
      break;

    case "checkouts/create":
      log.info("Shopify checkout created", {
        storeId: store.id,
        checkoutToken: payload?.token,
        email: payload?.email,
        totalPrice: payload?.total_price,
      });
      break;

    case "checkouts/update":
      log.info("Shopify checkout updated", {
        storeId: store.id,
        checkoutToken: payload?.token,
        email: payload?.email,
        updatedAt: payload?.updated_at,
      });
      break;

    default:
      log.info(`Unhandled Shopify webhook topic: ${topic}`, { storeId: store.id });
      break;
  }

  return NextResponse.json({
    received: true,
    topic,
    webhookId,
    storeId: store.id,
  });
}

