import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest } from "@/lib/security/auth";
import { assertCanManageIntegrations } from "@/lib/security/store-access";
import { shopifyService } from "@/lib/services";
import { parseId } from "@/lib/api/params";

type StoreOverviewRouteContext = { params: Promise<{ storeId: string }> };

/**
 * GET /api/integrations/shopify/stores/[storeId]/overview — live details of the store from Shopify: plan, timezone,
 * address and the number of active products, customers and orders
 */
export const GET = withAuth<StoreOverviewRouteContext>(async (req: AuthenticatedRequest, context) => {
  assertCanManageIntegrations(req.user, "read");
  const storeId = parseId((await context?.params)?.storeId, "storeId");
  const overview = await shopifyService.getStoreOverview(req.user, storeId);
  return NextResponse.json({ success: true, overview });
});
