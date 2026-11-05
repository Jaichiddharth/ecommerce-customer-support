import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest, hasPermission, assertPagePermission } from "@/lib/security/auth";
import { shopifyService } from "@/lib/services";
import { organizationRepository } from "@/lib/db/repositories";
import { AppError } from "@/lib/errors";
import { readJson } from "@/lib/api/handler";
import { normalizeShopDomain, SHOPIFY_CALLBACK_PATH } from "@/lib/shopify/config";
import { OAUTH_NONCE_COOKIE, OAUTH_STATE_TTL_SECONDS } from "@/lib/shopify/oauth";

/**
 * POST /api/integrations/shopify/install  { shop: "my-store" | "my-store.myshopify.com" }
 * Returns the Shopify authorization URL; the browser navigates to it. Requires manage_billing_and_integrations.
 */
export const POST = withAuth(async (req: AuthenticatedRequest) => {
  assertPagePermission(req.user, 'integrations', 'create');

  const org = await organizationRepository.findById(req.user.organizationId);
  const canManage = hasPermission(req.user.role, "manage_billing_and_integrations", org?.rolePermissions as any);
  if (!canManage) {
    throw new AppError("FORBIDDEN", { message: "You do not have permission to manage billing and integrations.", expected: true });
  }

  const body = (await readJson(req)) ?? {};
  const shop = normalizeShopDomain(body.shop);
  if (!shop) {
    throw AppError.validation("Enter your store's myshopify.com address, e.g. my-store.myshopify.com.", "shop");
  }

  const { authorizeUrl, nonce } = await shopifyService.startInstall(req.user, shop);

  const response = NextResponse.json({ success: true, authorizeUrl, shop });
  // Binds the callback to this browser; SameSite=Lax is still sent on Shopify's top-level redirect back.
  // Use secure:true whenever the app is served over HTTPS (covers ngrok tunnels in dev too).
  const isHttps = (process.env.SHOPIFY_APP_URL || process.env.NEXT_PUBLIC_APP_URL || "").startsWith("https://");
  response.cookies.set(OAUTH_NONCE_COOKIE, nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production" || isHttps,
    sameSite: "lax",
    path: SHOPIFY_CALLBACK_PATH,
    maxAge: OAUTH_STATE_TTL_SECONDS,
  });
  return response;
});
