import { AppError } from "../errors";

/**
 * Admin API scopes the integration asks the merchant for — read-only, nothing else:
 *  - read_products: product search, product details and variants
 *  - read_customers: find a Shopify customer by email/phone to link to a contact
 *  - read_orders: order history of a linked customer (Shopify limits this to the last 60 days
 *    unless the app is also granted read_all_orders)
 */
export const SHOPIFY_REQUIRED_SCOPES = ["read_products", "read_customers", "read_orders"];

/** Supported Admin API version (Shopify releases quarterly and supports each for 12 months). */
export const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-07";

export interface ShopifyAppConfig {
  apiKey: string;
  apiSecret: string;
  /** Public base URL of this app, e.g. https://app.unocx.in — the OAuth callback is built from it. */
  appUrl: string;
  scopes: string[];
}

export function getShopifyConfig(): ShopifyAppConfig {
  const apiKey = process.env.SHOPIFY_API_KEY;
  const apiSecret = process.env.SHOPIFY_API_SECRET;
  const appUrl = process.env.SHOPIFY_APP_URL || process.env.NEXT_PUBLIC_APP_URL;

  if (!apiKey || !apiSecret || !appUrl) {
    throw new AppError("SHOPIFY_NOT_CONFIGURED", {
      details: { missing: [!apiKey && "SHOPIFY_API_KEY", !apiSecret && "SHOPIFY_API_SECRET", !appUrl && "SHOPIFY_APP_URL"].filter(Boolean) },
    });
  }

  const extra = (process.env.SHOPIFY_SCOPES || "").split(",").map((s) => s.trim()).filter(Boolean);
  return {
    apiKey,
    apiSecret,
    appUrl: appUrl.replace(/\/$/, ""),
    scopes: Array.from(new Set([...SHOPIFY_REQUIRED_SCOPES, ...extra])),
  };
}

export const SHOPIFY_CALLBACK_PATH = "/api/integrations/shopify/callback";

const MYSHOPIFY_DOMAIN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

/**
 * Turns what a merchant types into their permanent `<handle>.myshopify.com` domain.
 * Accepts "my-store", "my-store.myshopify.com", "https://my-store.myshopify.com/admin"
 * and "admin.shopify.com/store/my-store". Returns null for anything else (custom domains can't be used for OAuth).
 */
export function normalizeShopDomain(input: unknown): string | null {
  if (typeof input !== "string") return null;
  let value = input.trim().toLowerCase();
  if (!value) return null;

  const adminMatch = value.match(/admin\.shopify\.com\/store\/([a-z0-9][a-z0-9-]*)/);
  if (adminMatch) return `${adminMatch[1]}.myshopify.com`;

  value = value.replace(/^https?:\/\//, "").split(/[/?#]/)[0];
  if (/^[a-z0-9][a-z0-9-]*$/.test(value)) value = `${value}.myshopify.com`;

  return isValidShopDomain(value) ? value : null;
}

export function isValidShopDomain(shop: unknown): shop is string {
  return typeof shop === "string" && MYSHOPIFY_DOMAIN.test(shop);
}

/** "gid://shopify/Product/123" ← ("Product", "123"); accepts a full GID as-is. Returns null for anything else. */
export function toShopifyGid(type: "Product" | "ProductVariant" | "Customer", id: unknown): string | null {
  const value = String(id ?? "").trim();
  if (/^\d+$/.test(value)) return `gid://shopify/${type}/${value}`;
  const match = value.match(new RegExp(`^gid://shopify/${type}/(\\d+)$`));
  return match ? value : null;
}

/** "123" from "gid://shopify/Product/123" */
export function shopifyLegacyId(gid: string): string {
  return gid.split("/").pop() || gid;
}
