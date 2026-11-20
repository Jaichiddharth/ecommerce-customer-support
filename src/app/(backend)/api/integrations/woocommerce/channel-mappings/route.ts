import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest } from "@/lib/security/auth";
import { assertCanManageIntegrations } from "@/lib/security/store-access";
import { commerceStoreConnectionService } from "@/lib/services";
import { readJson } from "@/lib/api/handler";
import { parseId } from "@/lib/api/params";
import { optionalBodyId } from "@/lib/api/store-scope";

/**
 * GET /api/integrations/woocommerce/channel-mappings?storeId=&channelId= — channel ↔ WooCommerce store connections,
 * plus every WooCommerce store each live channel is connected to (`channels[].links`).
 */
export const GET = withAuth(async (req: AuthenticatedRequest) => {
  assertCanManageIntegrations(req.user, "read");
  const { searchParams } = req.nextUrl;
  const result = await commerceStoreConnectionService.getChannelMappings(req.user.organizationId, "woocommerce", {
    storeId: optionalBodyId(searchParams.get("storeId"), "storeId"),
    channelId: optionalBodyId(searchParams.get("channelId"), "channelId"),
  });
  return NextResponse.json({ success: true, ...result });
});

/**
 * POST /api/integrations/woocommerce/channel-mappings  { storeId, channelId } — connect a channel to a WooCommerce
 * store. Many to many: a channel can use several WooCommerce and Shopify stores. 201 created / 200 already
 * connected to that store.
 */
export const POST = withAuth(async (req: AuthenticatedRequest) => {
  assertCanManageIntegrations(req.user, "create");
  const body = (await readJson(req)) ?? {};
  const { mapping, created } = await commerceStoreConnectionService.createChannelMapping(req.user, "woocommerce", {
    storeId: parseId(body.storeId != null ? String(body.storeId) : null, "storeId"),
    channelId: parseId(body.channelId != null ? String(body.channelId) : null, "channelId"),
  });
  return NextResponse.json({ success: true, mapping, created }, { status: created ? 201 : 200 });
});
