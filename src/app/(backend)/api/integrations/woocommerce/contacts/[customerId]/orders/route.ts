import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest } from "@/lib/security/auth";
import { wooCommerceInboxService } from "@/lib/services";
import { parseId } from "@/lib/api/params";

type ContactRouteContext = { params: Promise<{ customerId: string }> };

/**
 * GET /api/integrations/woocommerce/contacts/[customerId]/orders?storeId= — the contact's orders in the store picked
 * in the inbox's switcher (matched by the billing email or phone of any of the contact profile's identities).
 */
export const GET = withAuth<ContactRouteContext>(async (req: AuthenticatedRequest, context) => {
  const customerId = parseId((await context?.params)?.customerId, "customerId");
  const storeId = parseId(req.nextUrl.searchParams.get("storeId"), "storeId");
  const result = await wooCommerceInboxService.getContactOrders(req.user, customerId, storeId);
  return NextResponse.json({ success: true, ...result });
});
