import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest } from "@/lib/security/auth";
import { shopifyService } from "@/lib/services";

/** GET /api/integrations/shopify/products?q=&after= — active products by title, SKU or barcode; 20 per page */
export const GET = withAuth(async (req: AuthenticatedRequest) => {
  const { searchParams } = req.nextUrl;
  const page = await shopifyService.searchProducts(req.user.organizationId, searchParams.get("q") || "", searchParams.get("after"));
  return NextResponse.json({ success: true, ...page });
});
