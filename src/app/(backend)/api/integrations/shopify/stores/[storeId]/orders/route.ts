import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest } from "@/lib/security/auth";
import { assertCanManageIntegrations } from "@/lib/security/store-access";
import { shopifyService } from "@/lib/services";
import { AppError } from "@/lib/errors";
import { parseId } from "@/lib/api/params";
import type { ShopifyOrderStatusFilter } from "@/lib/shopify/types";

type StoreOrdersRouteContext = { params: Promise<{ storeId: string }> };

const STATUSES: ShopifyOrderStatusFilter[] = ["any", "open", "closed", "cancelled"];

/**
 * GET /api/integrations/shopify/stores/[storeId]/orders?q=&status=any|open|closed|cancelled&after=
 * The store's orders, newest first, 20 per page, each with its customer. q: order number, email or other text.
 */
export const GET = withAuth<StoreOrdersRouteContext>(async (req: AuthenticatedRequest, context) => {
  assertCanManageIntegrations(req.user, "read");
  const storeId = parseId((await context?.params)?.storeId, "storeId");
  const { searchParams } = req.nextUrl;

  const status = searchParams.get("status") || undefined;
  if (status !== undefined && !STATUSES.includes(status as ShopifyOrderStatusFilter)) {
    throw AppError.validation(`Status must be one of: ${STATUSES.join(", ")}.`, "status");
  }

  const page = await shopifyService.listStoreOrders(req.user, storeId, {
    q: searchParams.get("q") || undefined,
    status: status as ShopifyOrderStatusFilter | undefined,
    after: searchParams.get("after"),
  });
  return NextResponse.json({ success: true, ...page });
});
