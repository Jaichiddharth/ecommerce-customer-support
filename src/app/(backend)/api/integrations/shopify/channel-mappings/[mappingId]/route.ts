import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest } from "@/lib/security/auth";
import { assertCanManageIntegrations } from "@/lib/security/store-access";
import { shopifyStoreConnectionService } from "@/lib/services";
import { parseId } from "@/lib/api/params";

type MappingRouteContext = { params: Promise<{ mappingId: string }> };

const mappingIdFrom = async (context?: MappingRouteContext) => parseId((await context?.params)?.mappingId, "mappingId");

/** GET /api/integrations/shopify/channel-mappings/[mappingId] */
export const GET = withAuth<MappingRouteContext>(async (req: AuthenticatedRequest, context) => {
  assertCanManageIntegrations(req.user, "read");
  const mapping = await shopifyStoreConnectionService.getChannelMapping(req.user.organizationId, await mappingIdFrom(context));
  return NextResponse.json({ success: true, mapping });
});

/**
 * DELETE /api/integrations/shopify/channel-mappings/[mappingId] — disconnect the channel from its store.
 * It then has no store (no Shopify data in its conversations) until it's connected to one (POST /channel-mappings).
 * The store's contact and order links of the channel's contacts are removed too (GET …/impact counts them first);
 * contacts that also use another channel of the same store keep theirs. A channel can't be moved between stores
 * in one step.
 */
export const DELETE = withAuth<MappingRouteContext>(async (req: AuthenticatedRequest, context) => {
  assertCanManageIntegrations(req.user, "delete");
  const removed = await shopifyStoreConnectionService.deleteChannelMapping(req.user, await mappingIdFrom(context));
  return NextResponse.json({ success: true, removed });
});
