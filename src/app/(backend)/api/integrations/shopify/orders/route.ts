import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest } from "@/lib/security/auth";
import { shopifyService } from "@/lib/services";
import { storeScopeFromQuery } from "@/lib/api/store-scope";

/** GET /api/integrations/shopify/orders?q=&storeId=&channelId=&customerId= — find orders by number or email, each with its customer */
export const GET = withAuth(async (req: AuthenticatedRequest) => {
  const { searchParams } = req.nextUrl;
  const results = await shopifyService.searchOrders(req.user, storeScopeFromQuery(searchParams), searchParams.get("q") || "");
  return NextResponse.json({ success: true, results });
});
