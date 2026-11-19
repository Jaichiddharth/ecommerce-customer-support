import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest } from "@/lib/security/auth";
import { assertCanManageIntegrations } from "@/lib/security/store-access";
import { wooCommerceService } from "@/lib/services";
import { parseId } from "@/lib/api/params";

type StoreRouteContext = { params: Promise<{ storeId: string }> };

/** GET /api/integrations/woocommerce/stores/[storeId]/overview — live details and counts from the store */
export const GET = withAuth<StoreRouteContext>(async (req: AuthenticatedRequest, context) => {
  assertCanManageIntegrations(req.user, "read");
  const overview = await wooCommerceService.getStoreOverview(req.user, parseId((await context?.params)?.storeId, "storeId"));
  return NextResponse.json({ success: true, overview });
});
