import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest } from "@/lib/security/auth";
import { assertCanManageIntegrations } from "@/lib/security/store-access";
import { commerceStoreConnectionService } from "@/lib/services";
import { parseId } from "@/lib/api/params";

type MappingRouteContext = { params: Promise<{ mappingId: string }> };

const mappingIdFrom = async (context?: MappingRouteContext) => parseId((await context?.params)?.mappingId, "mappingId");

/** GET /api/integrations/woocommerce/channel-mappings/[mappingId] */
export const GET = withAuth<MappingRouteContext>(async (req: AuthenticatedRequest, context) => {
  assertCanManageIntegrations(req.user, "read");
  const mapping = await commerceStoreConnectionService.getChannelMapping(req.user.organizationId, await mappingIdFrom(context), "woocommerce");
  return NextResponse.json({ success: true, mapping });
});

/** DELETE /api/integrations/woocommerce/channel-mappings/[mappingId] — disconnect the channel from its WooCommerce store */
export const DELETE = withAuth<MappingRouteContext>(async (req: AuthenticatedRequest, context) => {
  assertCanManageIntegrations(req.user, "delete");
  await commerceStoreConnectionService.deleteChannelMapping(req.user, await mappingIdFrom(context), "woocommerce");
  return NextResponse.json({ success: true });
});
