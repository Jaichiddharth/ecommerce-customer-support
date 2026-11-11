import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest } from "@/lib/security/auth";
import { assertCanManageIntegrations } from "@/lib/security/store-access";
import { shopifyService, shopifyStoreConnectionService } from "@/lib/services";
import { parseId } from "@/lib/api/params";

type StoreRouteContext = { params: Promise<{ storeId: string }> };

const storeIdFrom = async (context?: StoreRouteContext) => parseId((await context?.params)?.storeId, "storeId");

/** GET /api/integrations/shopify/stores/[storeId] — one store connection with its mapped channels */
export const GET = withAuth<StoreRouteContext>(async (req: AuthenticatedRequest, context) => {
  assertCanManageIntegrations(req.user, "read");
  const store = await shopifyStoreConnectionService.getStore(req.user.organizationId, await storeIdFrom(context));
  return NextResponse.json({ success: true, store });
});

/**
 * DELETE /api/integrations/shopify/stores/[storeId] — disconnect the store (token revoked and deleted).
 * Its channel mappings and contact/order links are kept, so reconnecting the same shop restores them;
 * meanwhile its mapped channels have no store.
 */
export const DELETE = withAuth<StoreRouteContext>(async (req: AuthenticatedRequest, context) => {
  assertCanManageIntegrations(req.user, "delete");
  await shopifyService.disconnect(req.user.organizationId, await storeIdFrom(context));
  return NextResponse.json({ success: true });
});
