import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest } from "@/lib/security/auth";
import { shopifyStoreConnectionService } from "@/lib/services";
import { parseId } from "@/lib/api/params";

/**
 * GET /api/integrations/shopify/channel-store?channelId= — the Shopify stores the WhatsApp number (channel) is
 * connected to (`stores`, oldest connection first; empty when none); `hasStores`: whether the workspace has any
 * store this member can use. Used by the inbox's store switcher: Shopify products and orders only show for a
 * conversation whose number is connected to a store. Like the other inbox Shopify calls, any member may read it;
 * members limited to some stores don't get the others.
 */
export const GET = withAuth(async (req: AuthenticatedRequest) => {
  const channelId = parseId(req.nextUrl.searchParams.get("channelId"), "channelId");
  const { stores, hasStores } = await shopifyStoreConnectionService.getChannelStores(req.user, channelId);
  return NextResponse.json({ success: true, stores, hasStores });
});
