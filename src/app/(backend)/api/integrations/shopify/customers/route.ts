import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest } from "@/lib/security/auth";
import { shopifyService } from "@/lib/services";

/** GET /api/integrations/shopify/customers?q=&email=&phone= — find Shopify customers (q: name, email or phone) to link to a contact */
export const GET = withAuth(async (req: AuthenticatedRequest) => {
  const { searchParams } = req.nextUrl;
  const customers = await shopifyService.searchCustomers(req.user.organizationId, {
    q: searchParams.get("q") || undefined,
    email: searchParams.get("email") || undefined,
    phone: searchParams.get("phone") || undefined,
  });
  return NextResponse.json({ success: true, customers });
});
