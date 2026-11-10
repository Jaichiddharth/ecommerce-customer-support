import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest } from "@/lib/security/auth";
import { assertCanManageIntegrations } from "@/lib/security/store-access";
import { shopifyStoreConnectionService } from "@/lib/services";
import { parseId } from "@/lib/api/params";

type MappingRouteContext = { params: Promise<{ mappingId: string }> };

/**
 * GET /api/integrations/shopify/channel-mappings/[mappingId]/impact — what disconnecting the channel from its
 * store would remove (contact ↔ Shopify customer links and order links of the channel's contacts). Changes nothing.
 */
export const GET = withAuth<MappingRouteContext>(async (req: AuthenticatedRequest, context) => {
  assertCanManageIntegrations(req.user, "read");
  const mappingId = parseId((await context?.params)?.mappingId, "mappingId");
  const impact = await shopifyStoreConnectionService.getChannelUnmapImpact(req.user.organizationId, mappingId);
  return NextResponse.json({ success: true, impact });
});
