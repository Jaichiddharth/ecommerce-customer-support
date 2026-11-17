import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest } from "@/lib/security/auth";
import { assertCanManageIntegrations } from "@/lib/security/store-access";
import { shopifyService } from "@/lib/services";
import { parseId } from "@/lib/api/params";

type StoreRouteContext = { params: Promise<{ storeId: string }> };

const storeIdFrom = async (context?: StoreRouteContext) => parseId((await context?.params)?.storeId, "storeId");

/**
 * GET /api/integrations/shopify/stores/[storeId]/webhooks
 * Lists all registered webhooks for this store on Shopify.
 */
export const GET = withAuth<StoreRouteContext>(async (req: AuthenticatedRequest, context) => {
  assertCanManageIntegrations(req.user, "read");
  const storeId = await storeIdFrom(context);
  const webhooks = await shopifyService.listStoreWebhooks(req.user.organizationId, storeId);
  return NextResponse.json({ success: true, webhooks });
});

/**
 * POST /api/integrations/shopify/stores/[storeId]/webhooks
 * Subscribes this store to:
 * - orders/create
 * - orders/cancelled
 * - orders/paid
 * - checkouts/create
 * - checkouts/update
 */
export const POST = withAuth<StoreRouteContext>(async (req: AuthenticatedRequest, context) => {
  assertCanManageIntegrations(req.user, "create");
  const storeId = await storeIdFrom(context);
  const result = await shopifyService.subscribeStoreWebhooks(req.user.organizationId, storeId);
  return NextResponse.json({ success: true, ...result });
});
