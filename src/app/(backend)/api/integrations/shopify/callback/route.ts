import { NextRequest, NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { shopifyService } from "@/lib/services";
import { toAppError } from "@/lib/errors";
import { createLogger } from "@/lib/logger";
import { getShopifyConfig, SHOPIFY_CALLBACK_PATH } from "@/lib/shopify/config";
import { OAUTH_NONCE_COOKIE } from "@/lib/shopify/oauth";

const log = createLogger("ShopifyCallback");
/**
 * GET /api/integrations/shopify/callback — Shopify's OAuth redirect.
 * There's no Firebase session on a browser redirect: the request is trusted only after the
 * Shopify HMAC, our signed state and the nonce cookie all check out (shopifyService.completeInstall).
 * Always answers with a redirect back to the app's Store page.
 */
export const GET = apiHandler(async (req: NextRequest) => {
  let origin = req.nextUrl.origin;
  try {
    origin = getShopifyConfig().appUrl;
  } catch {
    // Not configured: completeInstall reports it below
  }
  const target = new URL("/", origin);
  target.searchParams.set("tab", "store");

  try {
    const store = await shopifyService.completeInstall(req.nextUrl.searchParams, req.cookies.get(OAUTH_NONCE_COOKIE)?.value);
    target.searchParams.set("shopify", "connected");
    target.searchParams.set("shop", store.shopDomain);
  } catch (err) {
    const appError = toAppError(err);
    log.warn("Shopify connection failed", { err: appError });
    target.searchParams.set("shopify", "error");
    target.searchParams.set("code", appError.code);
    if (appError.status < 500) target.searchParams.set("message", appError.message);
  }

  const response = NextResponse.redirect(target);
  response.cookies.set(OAUTH_NONCE_COOKIE, "", { path: SHOPIFY_CALLBACK_PATH, maxAge: 0 });
  return response;
});
