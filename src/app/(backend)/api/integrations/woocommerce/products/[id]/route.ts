import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest } from "@/lib/security/auth";
import { wooCommerceInboxService } from "@/lib/services";
import { parseId } from "@/lib/api/params";
import { wooInboxScopeFromQuery } from "@/lib/api/store-scope";

type ProductRouteContext = { params: Promise<{ id: string }> };

/** GET /api/integrations/woocommerce/products/[id]?storeId=&channelId=&customerId= — product with its variations */
export const GET = withAuth<ProductRouteContext>(async (req: AuthenticatedRequest, context) => {
  const productId = parseId((await context?.params)?.id, "id");
  const product = await wooCommerceInboxService.getProduct(req.user, wooInboxScopeFromQuery(req.nextUrl.searchParams), productId);
  return NextResponse.json({ success: true, product });
});
