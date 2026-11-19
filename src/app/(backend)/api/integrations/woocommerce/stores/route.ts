import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest } from "@/lib/security/auth";
import { assertCanManageIntegrations } from "@/lib/security/store-access";
import { wooCommerceService } from "@/lib/services";

/** GET /api/integrations/woocommerce/stores — connected stores with their channels */
export const GET = withAuth(async (req: AuthenticatedRequest) => {
  assertCanManageIntegrations(req.user, "read");
  const stores = await wooCommerceService.listStores(req.user.organizationId);
  return NextResponse.json({ success: true, stores });
});
