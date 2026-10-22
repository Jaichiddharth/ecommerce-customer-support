import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest } from "@/lib/security/auth";
import { shopifyService } from "@/lib/services";

type ProductRouteContext = { params: Promise<{ id: string }> };

/** GET /api/integrations/shopify/products/[id] — product details, options and variants (id: numeric Shopify id) */
export const GET = withAuth<ProductRouteContext>(async (req: AuthenticatedRequest, context) => {
  const id = (await context?.params)?.id ?? "";
  const product = await shopifyService.getProduct(req.user.organizationId, id);
  return NextResponse.json({ success: true, product });
});
