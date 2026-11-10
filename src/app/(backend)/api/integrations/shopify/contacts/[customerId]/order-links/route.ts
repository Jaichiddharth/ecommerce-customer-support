import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest, assertPagePermission } from "@/lib/security/auth";
import { shopifyService } from "@/lib/services";
import { AppError } from "@/lib/errors";
import { readJson } from "@/lib/api/handler";
import { parseId } from "@/lib/api/params";
import { optionalBodyId } from "@/lib/api/store-scope";

type OrderLinksRouteContext = { params: Promise<{ customerId: string }> };

const contactIdFrom = async (context?: OrderLinksRouteContext) => parseId((await context?.params)?.customerId, "customerId");

/** GET /api/integrations/shopify/contacts/[customerId]/order-links?storeId= — orders associated with the contact's profile */
export const GET = withAuth<OrderLinksRouteContext>(async (req: AuthenticatedRequest, context) => {
  const customerId = await contactIdFrom(context);
  const links = await shopifyService.listOrderLinks(req.user, customerId, optionalBodyId(req.nextUrl.searchParams.get("storeId"), "storeId"));
  return NextResponse.json({ success: true, links });
});

/**
 * POST /api/integrations/shopify/contacts/[customerId]/order-links  { orderId, channelId?, storeId? }
 * Associates an order (numeric id or GID) with the contact's profile, through a channel (default: the contact's).
 * The order must exist in that channel's store. 201 when created, 200 when it was already associated.
 */
export const POST = withAuth<OrderLinksRouteContext>(async (req: AuthenticatedRequest, context) => {
  assertPagePermission(req.user, "contacts", "update");
  const customerId = await contactIdFrom(context);
  const body = (await readJson(req)) ?? {};
  if (!body.orderId) throw AppError.validation("Choose an order.", "orderId");

  const { link, created } = await shopifyService.linkOrder(req.user, customerId, {
    orderId: String(body.orderId),
    channelId: optionalBodyId(body.channelId, "channelId"),
    storeId: optionalBodyId(body.storeId, "storeId"),
  });
  return NextResponse.json({ success: true, link, created }, { status: created ? 201 : 200 });
});
