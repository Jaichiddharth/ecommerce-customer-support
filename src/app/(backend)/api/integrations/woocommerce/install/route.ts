import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest } from "@/lib/security/auth";
import { assertCanManageIntegrations } from "@/lib/security/store-access";
import { wooCommerceService } from "@/lib/services";
import { readJson } from "@/lib/api/handler";

/**
 * POST /api/integrations/woocommerce/install  { storeUrl: "shop.example.com" | "https://example.com/shop", reauthorize?: boolean }
 * Checks the address is a WordPress site with WooCommerce's REST API and returns the store's approval URL
 * (/wc-auth/v1/authorize); the browser opens it. The merchant approves there, WooCommerce POSTs a new API key to
 * /callback and sends the browser to /return.
 * 409 CONFLICT (details.reason "store_already_connected") when the store is still connected and not re-authorizing.
 */
export const POST = withAuth(async (req: AuthenticatedRequest) => {
  assertCanManageIntegrations(req.user, "create");
  const body = (await readJson(req)) ?? {};
  const result = await wooCommerceService.startInstall(req.user, body.storeUrl, { reauthorize: body.reauthorize === true });
  return NextResponse.json({ success: true, ...result });
});
