import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest } from "@/lib/security/auth";
import { assertCanManageIntegrations } from "@/lib/security/store-access";
import { shopifyStoreConnectionService } from "@/lib/services";
import { readJson } from "@/lib/api/handler";
import { parseId } from "@/lib/api/params";
import { optionalBodyId } from "@/lib/api/store-scope";

/**
 * GET /api/integrations/shopify/channel-mappings?storeId=&channelId= — the channel ↔ store mappings, plus
 * which store every live channel uses right now (`channels[].via`: mapping or none).
 */
export const GET = withAuth(async (req: AuthenticatedRequest) => {
  assertCanManageIntegrations(req.user, "read");
  const { searchParams } = req.nextUrl;
  const result = await shopifyStoreConnectionService.getChannelMappings(req.user.organizationId, {
    storeId: optionalBodyId(searchParams.get("storeId"), "storeId"),
    channelId: optionalBodyId(searchParams.get("channelId"), "channelId"),
  });
  return NextResponse.json({ success: true, ...result });
});

/**
 * POST /api/integrations/shopify/channel-mappings  { storeId, channelId } — connect a channel (number) to a store.
 * A store can have many channels; a channel belongs to one store.
 * 201 when created; 200 when the channel is already connected to that store.
 * 409 SHOPIFY_CHANNEL_ALREADY_MAPPED when it's connected to another store (details: mappingId, storeId, storeName):
 * disconnect it first with DELETE /channel-mappings/:mappingId, then connect it here.
 */
export const POST = withAuth(async (req: AuthenticatedRequest) => {
  assertCanManageIntegrations(req.user, "create");
  const body = (await readJson(req)) ?? {};

  const { mapping, created } = await shopifyStoreConnectionService.createChannelMapping(req.user, {
    storeId: parseId(body.storeId != null ? String(body.storeId) : null, "storeId"),
    channelId: parseId(body.channelId != null ? String(body.channelId) : null, "channelId"),
  });
  return NextResponse.json({ success: true, mapping, created }, { status: created ? 201 : 200 });
});
