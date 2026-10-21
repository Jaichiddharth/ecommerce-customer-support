import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest } from "@/lib/security/auth";
import { shopifyService } from "@/lib/services";
import { AppError } from "@/lib/errors";

type OrdersRouteContext = { params: Promise<{ customerId: string }> };

/** GET /api/integrations/shopify/contacts/[customerId]/orders?after= — link, Shopify customer and their orders (10 per page) */
export const GET = withAuth<OrdersRouteContext>(async (req: AuthenticatedRequest, context) => {
  const customerId = Number((await context?.params)?.customerId);
  if (!customerId || isNaN(customerId)) throw AppError.validation("Invalid customer id.", "customerId");

  const result = await shopifyService.getContactOrders(req.user.organizationId, customerId, req.nextUrl.searchParams.get("after"));
  return NextResponse.json({ success: true, ...result });
});
