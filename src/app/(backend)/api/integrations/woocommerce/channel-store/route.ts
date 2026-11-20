import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest } from "@/lib/security/auth";
import { commerceStoreConnectionService } from "@/lib/services";
import { parseId } from "@/lib/api/params";

/**
 * GET /api/integrations/woocommerce/channel-store?channelId= — the WooCommerce stores a channel is connected to
 * (`stores`, oldest connection first; empty when none); `hasStores`: whether the workspace has a WooCommerce store
 * this member can use. For the inbox; any member may read it.
 */
export const GET = withAuth(async (req: AuthenticatedRequest) => {
  const channelId = parseId(req.nextUrl.searchParams.get("channelId"), "channelId");
  const result = await commerceStoreConnectionService.getWooChannelStores(req.user, channelId);
  return NextResponse.json({ success: true, ...result });
});
