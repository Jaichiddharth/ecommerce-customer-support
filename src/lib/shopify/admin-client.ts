import axios from "axios";
import { AppError, toAppError } from "../errors";
import { createLogger } from "../logger";
import { SHOPIFY_API_VERSION } from "./config";

/**
 * Transport for every Shopify Admin GraphQL call.
 * - logs each call once (operation, shop, status, duration, query cost) — never variables, which can hold emails/phones
 * - waits and retries when Shopify throttles the query (leaky-bucket cost limit), at most twice
 * - converts HTTP and GraphQL failures into AppErrors (SHOPIFY_*)
 */

const log = createLogger("ShopifyApi");

const MAX_THROTTLE_RETRIES = 2;
const MAX_THROTTLE_WAIT_MS = 5_000;

interface GraphQLError {
  message: string;
  extensions?: { code?: string; [key: string]: unknown };
}

interface ThrottleStatus {
  maximumAvailable: number;
  currentlyAvailable: number;
  restoreRate: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function shopifyGraphql<T>(
  shop: string,
  accessToken: string,
  operation: string,
  query: string,
  variables: Record<string, unknown> = {}
): Promise<T> {
  const url = `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;

  for (let attempt = 0; ; attempt++) {
    const startedAt = performance.now();
    let data: { data?: T; errors?: GraphQLError[] | string; extensions?: { cost?: { requestedQueryCost?: number; throttleStatus?: ThrottleStatus } } };
    let traceId: string | undefined;

    try {
      const res = await axios.post(url, { query, variables }, {
        timeout: 20_000,
        headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken },
        operation: `shopify.${operation}`,
      });
      data = res.data ?? {};
      traceId = res.headers?.["x-request-id"];
    } catch (err) {
      const appError = toAppError(err);
      log.warn(`POST graphql → ${appError.provider?.httpStatus ?? "no response"} · ${Math.round(performance.now() - startedAt)}ms`, {
        where: `shopify:${operation}`,
        shop,
        code: appError.code,
        ...(appError.provider?.traceId ? { shopifyRequestId: appError.provider.traceId } : {}),
      });
      if (appError.code === "SHOPIFY_RATE_LIMITED" && attempt < MAX_THROTTLE_RETRIES) {
        const retryAfter = Number(appError.details?.retryAfterSeconds) || 1;
        await sleep(Math.min(retryAfter * 1000, MAX_THROTTLE_WAIT_MS));
        continue;
      }
      throw appError;
    }

    const durationMs = Math.round(performance.now() - startedAt);
    const cost = data.extensions?.cost;
    const errors = Array.isArray(data.errors) ? data.errors : data.errors ? [{ message: String(data.errors) }] : [];
    const provider = { name: "shopify" as const, method: "POST", url, operation: `shopify.${operation}`, durationMs, traceId };

    if (errors.length === 0 && data.data) {
      log.http(`POST graphql → 200 · ${durationMs}ms`, {
        where: `shopify:${operation}`,
        shop,
        ...(cost?.requestedQueryCost !== undefined ? { cost: cost.requestedQueryCost } : {}),
      });
      return data.data;
    }

    const codes = errors.map((e) => e.extensions?.code).filter(Boolean);
    log.warn(`POST graphql → 200 with errors · ${durationMs}ms`, { where: `shopify:${operation}`, shop, codes, shopifyRequestId: traceId });

    if (codes.includes("THROTTLED")) {
      if (attempt < MAX_THROTTLE_RETRIES) {
        const status = cost?.throttleStatus;
        const needed = (cost?.requestedQueryCost ?? 100) - (status?.currentlyAvailable ?? 0);
        const waitMs = status?.restoreRate ? Math.ceil((Math.max(needed, 1) / status.restoreRate) * 1000) : 1000;
        await sleep(Math.min(waitMs, MAX_THROTTLE_WAIT_MS));
        continue;
      }
      throw new AppError("SHOPIFY_RATE_LIMITED", { provider: { ...provider, code: "THROTTLED" } });
    }

    const message = errors.map((e) => e.message).join("; ");
    if (codes.includes("ACCESS_DENIED")) {
      // Usually missing protected-customer-data approval or a scope the merchant didn't grant
      throw new AppError("SHOPIFY_API_ERROR", {
        status: 403,
        message: "Shopify denied access to this data. Check the app's permissions and protected customer data access.",
        provider: { ...provider, code: "ACCESS_DENIED", message },
        expected: true,
      });
    }
    throw new AppError("SHOPIFY_API_ERROR", { provider: { ...provider, code: codes[0] as string | undefined, message } });
  }
}

/** Removes the stored token on Shopify's side (uninstalls the app). Best effort: callers ignore failures. */
export async function revokeShopifyAccess(shop: string, accessToken: string): Promise<void> {
  await axios.delete(`https://${shop}/admin/api_permissions/current.json`, {
    timeout: 10_000,
    headers: { "X-Shopify-Access-Token": accessToken },
    operation: "shopify.revoke",
  });
}
