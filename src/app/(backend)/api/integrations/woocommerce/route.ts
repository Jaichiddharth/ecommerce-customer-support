import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest } from "@/lib/security/auth";
import { assertCanManageIntegrations } from "@/lib/security/store-access";
import { wooCommerceService } from "@/lib/services";

/** GET /api/integrations/woocommerce — the workspace's WooCommerce store connections (never includes credentials) */
export const GET = withAuth(async (req: AuthenticatedRequest) => {
  if (!req.user.permissions?.manage_billing_and_integrations) {
    return NextResponse.json({ success: true, configured: false, scope: "read_write", stores: [], restricted: true });
  }
  assertCanManageIntegrations(req.user, "read");
  const connection = await wooCommerceService.getConnection(req.user.organizationId);
  return NextResponse.json({ success: true, ...connection });
});
