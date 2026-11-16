import crypto from "crypto";
import axios from "axios";
import { createLogger } from "../logger";
import { SHOPIFY_API_VERSION } from "./config";

const log = createLogger("ShopifyWebhooks");

export interface ShopifyWebhookTopicConfig {
  restTopic: string;
  graphqlTopic: string;
  description: string;
}

export const SHOPIFY_SUBSCRIBED_TOPICS: ShopifyWebhookTopicConfig[] = [
  { restTopic: "orders/create", graphqlTopic: "ORDERS_CREATE", description: "Triggered when a new order is placed" },
  { restTopic: "orders/cancelled", graphqlTopic: "ORDERS_CANCELLED", description: "Triggered when an order is cancelled" },
  { restTopic: "orders/paid", graphqlTopic: "ORDERS_PAID", description: "Triggered when an order payment is confirmed" },
  { restTopic: "checkouts/create", graphqlTopic: "CHECKOUTS_CREATE", description: "Triggered when a new checkout is started" },
  { restTopic: "checkouts/update", graphqlTopic: "CHECKOUTS_UPDATE", description: "Triggered when an existing checkout is updated" },
];

export interface WebhookSubscriptionResult {
  topic: string;
  status: "created" | "already_subscribed" | "failed";
  webhookId?: string | number;
  error?: string;
}

/**
 * Verifies the X-Shopify-Hmac-Sha256 header against the raw request body using the app's secret.
 */
export function verifyShopifyWebhookHmac(
  rawBody: string | Buffer,
  hmacHeader: string | null | undefined,
  secret: string
): boolean {
  if (!hmacHeader || !secret) return false;
  try {
    const generated = crypto.createHmac("sha256", secret).update(rawBody).digest("base64");
    const generatedBuf = Buffer.from(generated);
    const headerBuf = Buffer.from(hmacHeader);
    return generatedBuf.length === headerBuf.length && crypto.timingSafeEqual(generatedBuf, headerBuf);
  } catch (err) {
    log.error("Failed to verify Shopify webhook HMAC", { err });
    return false;
  }
}

/**
 * Lists all registered webhooks for a shop via Shopify Admin API.
 */
export async function listShopifyWebhooks(
  shop: string,
  accessToken: string
): Promise<Array<{ id: number; topic: string; address: string; format: string }>> {
  const url = `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/webhooks.json`;
  const res = await axios.get(url, {
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    timeout: 10_000,
  });
  return res.data?.webhooks || [];
}

/**
 * Subscribes a Shopify store to the required webhooks:
 * orders/create, orders/cancelled, orders/paid, checkouts/create, checkouts/update
 */
export async function subscribeShopifyWebhooks(
  shop: string,
  accessToken: string,
  callbackUrl: string
): Promise<{
  allSubscribed: boolean;
  results: WebhookSubscriptionResult[];
}> {
  let existingWebhooks: Array<{ id: number; topic: string; address: string }> = [];

  try {
    existingWebhooks = await listShopifyWebhooks(shop, accessToken);
  } catch (err: any) {
    log.warn("Could not list existing webhooks before subscribing", {
      shop,
      err: err.response?.data || err.message,
    });
  }

  const results: WebhookSubscriptionResult[] = [];

  for (const { restTopic } of SHOPIFY_SUBSCRIBED_TOPICS) {
    const existing = existingWebhooks.find((w) => w.topic === restTopic);

    if (existing && existing.address === callbackUrl) {
      results.push({
        topic: restTopic,
        status: "already_subscribed",
        webhookId: existing.id,
      });
      continue;
    }

    try {
      if (existing && existing.address !== callbackUrl) {
        // Update endpoint
        const updateUrl = `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/webhooks/${existing.id}.json`;
        const res = await axios.put(
          updateUrl,
          { webhook: { address: callbackUrl } },
          {
            headers: {
              "Content-Type": "application/json",
              "X-Shopify-Access-Token": accessToken,
            },
            timeout: 10_000,
          }
        );
        results.push({
          topic: restTopic,
          status: "created",
          webhookId: res.data?.webhook?.id || existing.id,
        });
      } else {
        // Create new webhook
        const createUrl = `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/webhooks.json`;
        const res = await axios.post(
          createUrl,
          {
            webhook: {
              topic: restTopic,
              address: callbackUrl,
              format: "json",
            },
          },
          {
            headers: {
              "Content-Type": "application/json",
              "X-Shopify-Access-Token": accessToken,
            },
            timeout: 10_000,
          }
        );
        results.push({
          topic: restTopic,
          status: "created",
          webhookId: res.data?.webhook?.id,
        });
      }
    } catch (err: any) {
      const errorMsg =
        typeof err.response?.data?.errors === "string"
          ? err.response.data.errors
          : JSON.stringify(err.response?.data?.errors || err.message);

      log.warn(`Failed to subscribe webhook topic ${restTopic}`, {
        shop,
        error: errorMsg,
      });

      results.push({
        topic: restTopic,
        status: "failed",
        error: errorMsg,
      });
    }
  }

  const allSubscribed = results.every((r) => r.status === "created" || r.status === "already_subscribed");
  return { allSubscribed, results };
}

