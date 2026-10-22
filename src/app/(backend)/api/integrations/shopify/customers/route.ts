import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest } from "@/lib/security/auth";
import { shopifyService } from "@/lib/services";

/** GET /api/integrations/shopify/customers?email=&phone= — find Shopify customers to link to a contact */
export const GET = withAuth(async (req: AuthenticatedRequest) => {
  const { searchParams } = req.nextUrl;
  const customers = await shopifyService.searchCustomers(req.user.organizationId, {
    email: searchParams.get("email") || undefined,
    phone: searchParams.get("phone") || undefined,
  });
  return NextResponse.json({ success: true, customers });
});
