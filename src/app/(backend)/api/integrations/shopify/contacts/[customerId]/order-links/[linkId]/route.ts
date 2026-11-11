import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest, assertPagePermission } from "@/lib/security/auth";
import { shopifyService } from "@/lib/services";
import { parseId } from "@/lib/api/params";

type OrderLinkRouteContext = { params: Promise<{ customerId: string; linkId: string }> };

/** DELETE /api/integrations/shopify/contacts/[customerId]/order-links/[linkId] — remove the order association */
export const DELETE = withAuth<OrderLinkRouteContext>(async (req: AuthenticatedRequest, context) => {
  assertPagePermission(req.user, "contacts", "update");
  const params = await context?.params;
  await shopifyService.unlinkOrder(req.user, parseId(params?.customerId, "customerId"), parseId(params?.linkId, "linkId"));
  return NextResponse.json({ success: true });
});
