import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest } from "@/lib/security/auth";
import { shopifyService } from "@/lib/services";
import { storeScopeFromQuery } from "@/lib/api/store-scope";

/**
 * GET /api/integrations/shopify/customers?q=&email=&phone=&tag=&storeId=&channelId=&customerId= — find Shopify
 * customers (q: name, email or phone; tag: only customers with that tag) to link to a contact. Each result has its
 * tags. Pass customerId so the search runs in the contact's store.
 */
export const GET = withAuth(async (req: AuthenticatedRequest) => {
  const { searchParams } = req.nextUrl;
  const customers = await shopifyService.searchCustomers(req.user, storeScopeFromQuery(searchParams), {
    q: searchParams.get("q") || undefined,
    email: searchParams.get("email") || undefined,
    phone: searchParams.get("phone") || undefined,
    tag: searchParams.get("tag") || undefined,
  });
  return NextResponse.json({ success: true, customers });
});
