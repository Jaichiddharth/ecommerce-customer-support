import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest } from "@/lib/security/auth";
import { assertCanManageIntegrations } from "@/lib/security/store-access";
import { shopifyService } from "@/lib/services";
import { parseId } from "@/lib/api/params";

type CustomerOrdersRouteContext = { params: Promise<{ storeId: string; customerId: string }> };

/**
 * GET /api/integrations/shopify/stores/[storeId]/customers/[customerId]/orders?after=
 * A Shopify customer of the store (customerId: numeric Shopify id or GID) with their orders, newest first, 10 per page.
 */
export const GET = withAuth<CustomerOrdersRouteContext>(async (req: AuthenticatedRequest, context) => {
  assertCanManageIntegrations(req.user, "read");
  const params = await context?.params;
  const storeId = parseId(params?.storeId, "storeId");

  const result = await shopifyService.getStoreCustomerOrders(
    req.user,
    storeId,
    decodeURIComponent(params?.customerId ?? ""),
    req.nextUrl.searchParams.get("after")
  );
  return NextResponse.json({ success: true, ...result });
});
