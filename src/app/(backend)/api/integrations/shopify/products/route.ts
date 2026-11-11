import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest } from "@/lib/security/auth";
import { shopifyService } from "@/lib/services";
import { storeScopeFromQuery } from "@/lib/api/store-scope";

/**
 * GET /api/integrations/shopify/products?q=&after=&storeId=&channelId=&customerId= — active products by title,
 * SKU or barcode; 20 per page. The store comes from storeId, else the channel's (or contact's channel's) store;
 * there is no default store.
 */
export const GET = withAuth(async (req: AuthenticatedRequest) => {
  const { searchParams } = req.nextUrl;
  const page = await shopifyService.searchProducts(req.user, storeScopeFromQuery(searchParams), searchParams.get("q") || "", searchParams.get("after"));
  return NextResponse.json({ success: true, ...page });
});
