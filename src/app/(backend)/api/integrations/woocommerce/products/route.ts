import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest } from "@/lib/security/auth";
import { wooCommerceInboxService } from "@/lib/services";
import { parseId } from "@/lib/api/params";
import { wooInboxScopeFromQuery } from "@/lib/api/store-scope";

/**
 * GET /api/integrations/woocommerce/products?storeId=&channelId=&customerId=&q=&page= — published products by name or
 * SKU, 20 per page. storeId is the store picked in the inbox's switcher; it must be linked to the conversation's
 * number. Any member may read it (members limited to some stores only reach theirs).
 */
export const GET = withAuth(async (req: AuthenticatedRequest) => {
  const { searchParams } = req.nextUrl;
  const pageParam = searchParams.get("page");
  const page = pageParam ? parseId(pageParam, "page") : 1;
  const result = await wooCommerceInboxService.searchProducts(req.user, wooInboxScopeFromQuery(searchParams), searchParams.get("q") || "", page);
  return NextResponse.json({ success: true, ...result });
});
