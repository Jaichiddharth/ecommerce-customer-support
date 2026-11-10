import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest } from "@/lib/security/auth";
import { shopifyService } from "@/lib/services";
import { storeScopeFromQuery } from "@/lib/api/store-scope";

type ProductRouteContext = { params: Promise<{ id: string }> };

/** GET /api/integrations/shopify/products/[id]?storeId=&channelId=&customerId= — product details, options and variants (id: numeric Shopify id) */
export const GET = withAuth<ProductRouteContext>(async (req: AuthenticatedRequest, context) => {
  const id = (await context?.params)?.id ?? "";
  const product = await shopifyService.getProduct(req.user, storeScopeFromQuery(req.nextUrl.searchParams), id);
  return NextResponse.json({ success: true, product });
});
