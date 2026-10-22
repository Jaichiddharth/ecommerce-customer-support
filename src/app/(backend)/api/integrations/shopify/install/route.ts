import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest } from "@/lib/security/auth";
import { shopifyService } from "@/lib/services";
import { AppError } from "@/lib/errors";
import { readJson } from "@/lib/api/handler";
import { normalizeShopDomain, SHOPIFY_CALLBACK_PATH } from "@/lib/shopify/config";
import { OAUTH_NONCE_COOKIE, OAUTH_STATE_TTL_SECONDS } from "@/lib/shopify/oauth";

/**
 * POST /api/integrations/shopify/install  { shop: "my-store" | "my-store.myshopify.com" }
 * Returns the Shopify authorization URL; the browser navigates to it. Admins only.
 */
export const POST = withAuth(async (req: AuthenticatedRequest) => {
  if (req.user.role !== "ADMIN") {
    throw new AppError("FORBIDDEN", { message: "Only workspace admins can connect a Shopify store.", expected: true });
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
