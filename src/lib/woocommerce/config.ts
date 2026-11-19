import crypto from "crypto";
import { AppError } from "../errors";

/**
 * WooCommerce connection via the WooCommerce "Application Authentication Endpoint" (/wc-auth/v1/authorize):
 * the merchant approves UnoCX in their WordPress admin and WooCommerce generates a REST API key for us, POSTing it
 * to our callback. Unlike Shopify there is no app to register and no client id/secret: each store is its own
 * server, so the only server setting is the public HTTPS URL WooCommerce sends the key to.
 */

/** "read" | "write" | "read_write". write is needed later to register webhooks (orders → automations). */
export type WooCommerceScope = "read" | "write" | "read_write";

export const WOOCOMMERCE_APP_NAME = process.env.WOOCOMMERCE_APP_NAME || "UnoCX";
export const WOOCOMMERCE_CALLBACK_PATH = "/api/integrations/woocommerce/callback";
export const WOOCOMMERCE_RETURN_PATH = "/api/integrations/woocommerce/return";
export const WOOCOMMERCE_API_NAMESPACE = "wc/v3";
/** How long the merchant has to approve the key on their store */
export const WOOCOMMERCE_STATE_TTL_SECONDS = 30 * 60;

export function getWooCommerceScope(): WooCommerceScope {
  const value = (process.env.WOOCOMMERCE_SCOPE || "").trim().toLowerCase();
  return value === "read" || value === "write" || value === "read_write" ? value : "read_write";
}

export interface WooCommerceAppConfig {
  /** Public HTTPS base URL of this app; WooCommerce only POSTs keys to an https callback_url */
  appUrl: string;
  /** Key used to sign the `user_id` (our state) round-tripped through WooCommerce */
  stateSecret: Buffer;
  scope: WooCommerceScope;
}

export function getWooCommerceConfig(): WooCommerceAppConfig {
  const appUrl = (process.env.WOOCOMMERCE_APP_URL || process.env.SHOPIFY_APP_URL || process.env.NEXT_PUBLIC_APP_URL || "").trim();
  const secret = process.env.WOOCOMMERCE_STATE_SECRET || process.env.TOKEN_ENCRYPTION_KEY;
  const missing = [!appUrl && "WOOCOMMERCE_APP_URL", !secret && "WOOCOMMERCE_STATE_SECRET or TOKEN_ENCRYPTION_KEY"].filter(Boolean);
  if (missing.length > 0) throw new AppError("WOOCOMMERCE_NOT_CONFIGURED", { details: { missing } });
  if (!/^https:\/\//i.test(appUrl)) {
    throw new AppError("WOOCOMMERCE_NOT_CONFIGURED", {
      message: "WooCommerce needs an HTTPS app URL (WOOCOMMERCE_APP_URL) to send the API key to.",
      details: { reason: "app_url_not_https" },
    });
  }
  return {
    appUrl: appUrl.replace(/\/+$/, ""),
    // Derived with a label so the state key differs from the token encryption key itself
    stateSecret: crypto.createHmac("sha256", secret!).update("woocommerce-auth-state").digest(),
    scope: getWooCommerceScope(),
  };
}

export function isWooCommerceConfigured(): boolean {
  try {
    getWooCommerceConfig();
    return true;
  } catch {
    return false;
  }
}

export interface NormalizedStoreUrl {
  /** https://shop.example.com or https://example.com/shop (no trailing slash) */
  storeUrl: string;
  /** shop.example.com or example.com/shop: the store's identity in a workspace and in users.stores */
  storeHost: string;
  isHttps: boolean;
}

/**
 * What a merchant types → the store's base URL. Accepts "shop.example.com", "https://shop.example.com/",
 * "https://example.com/shop/wp-admin/admin.php?page=wc-settings" (sub-directory installs keep their path).
 * Defaults to https. Returns null for anything that isn't a plain http(s) URL.
 */
export function normalizeStoreUrl(input: unknown): NormalizedStoreUrl | null {
  if (typeof input !== "string") return null;
  let value = input.trim();
  if (!value) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) value = `https://${value}`;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  const hostname = url.hostname.toLowerCase();
  if (!hostname || (!hostname.includes(".") && hostname !== "localhost")) return null;

  // Drop WordPress admin/API paths pasted by mistake, keep a sub-directory install's path
  let path = url.pathname.replace(/\/(wp-admin|wp-json|wp-login\.php|index\.php|wc-auth)(\/.*)?$/i, "").replace(/\/+$/, "");
  path = path.replace(/\/{2,}/g, "/");

  const port = url.port ? `:${url.port}` : "";
  const storeUrl = `${url.protocol}//${hostname}${port}${path}`;
  return { storeUrl, storeHost: `${hostname}${port}${path}`.toLowerCase(), isHttps: url.protocol === "https:" };
}

/** Whether plain-HTTP stores may be connected (keys then travel unencrypted; OAuth 1.0a signing is used) */
export function allowHttpStores(): boolean {
  return process.env.WOOCOMMERCE_ALLOW_HTTP === "true" || process.env.NODE_ENV !== "production";
}
