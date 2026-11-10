import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest } from "@/lib/security/auth";
import { shopifyService } from "@/lib/services";
import { parseId } from "@/lib/api/params";
import { optionalBodyId } from "@/lib/api/store-scope";

type OrdersRouteContext = { params: Promise<{ customerId: string }> };

/**
 * GET /api/integrations/shopify/contacts/[customerId]/orders?after=&storeId= — link, Shopify customer and their
 * orders (10 per page), from the store of the contact's channel. `store` in the response says which store.
 */
export const GET = withAuth<OrdersRouteContext>(async (req: AuthenticatedRequest, context) => {
  const customerId = parseId((await context?.params)?.customerId, "customerId");
  const { searchParams } = req.nextUrl;

  const result = await shopifyService.getContactOrders(
    req.user,
    customerId,
    searchParams.get("after"),
    optionalBodyId(searchParams.get("storeId"), "storeId")
  );
  return NextResponse.json({ success: true, ...result });
});
