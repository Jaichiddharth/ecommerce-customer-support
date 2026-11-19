import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest } from "@/lib/security/auth";
import { assertCanManageIntegrations } from "@/lib/security/store-access";
import { wooCommerceService } from "@/lib/services";
import { parseId } from "@/lib/api/params";

type StoreRouteContext = { params: Promise<{ storeId: string }> };

const storeIdFrom = async (context?: StoreRouteContext) => parseId((await context?.params)?.storeId, "storeId");

/** GET /api/integrations/woocommerce/stores/[storeId] — one store with its channels */
export const GET = withAuth<StoreRouteContext>(async (req: AuthenticatedRequest, context) => {
  assertCanManageIntegrations(req.user, "read");
  const store = await wooCommerceService.getStore(req.user.organizationId, await storeIdFrom(context));
  return NextResponse.json({ success: true, store });
});

/**
 * DELETE /api/integrations/woocommerce/stores/[storeId] — disconnect: the API key is deleted on our side.
 * WooCommerce can't revoke keys over its API; `keyId` tells the merchant which key to revoke in WooCommerce.
 * Channel connections are kept for a reconnect; meanwhile those channels have no store.
 */
export const DELETE = withAuth<StoreRouteContext>(async (req: AuthenticatedRequest, context) => {
  assertCanManageIntegrations(req.user, "delete");
  const { keyId } = await wooCommerceService.disconnect(req.user.organizationId, await storeIdFrom(context));
  return NextResponse.json({ success: true, keyId });
});
