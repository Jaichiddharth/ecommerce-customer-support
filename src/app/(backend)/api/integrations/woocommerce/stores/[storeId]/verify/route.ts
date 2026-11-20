import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest } from "@/lib/security/auth";
import { assertCanManageIntegrations } from "@/lib/security/store-access";
import { wooCommerceService } from "@/lib/services";
import { parseId } from "@/lib/api/params";

type StoreRouteContext = { params: Promise<{ storeId: string }> };

/**
 * POST /api/integrations/woocommerce/stores/[storeId]/verify — test the API key against the store and refresh its
 * name and currency. A rejected key marks the store reauth_required (422 WOOCOMMERCE_CREDENTIALS_REJECTED).
 */
export const POST = withAuth<StoreRouteContext>(async (req: AuthenticatedRequest, context) => {
  assertCanManageIntegrations(req.user, "update");
  const store = await wooCommerceService.verifyStore(req.user, parseId((await context?.params)?.storeId, "storeId"));
  return NextResponse.json({ success: true, store });
});
