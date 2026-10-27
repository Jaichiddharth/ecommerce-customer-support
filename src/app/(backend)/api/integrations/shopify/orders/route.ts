import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest } from "@/lib/security/auth";
import { shopifyService } from "@/lib/services";

/** GET /api/integrations/shopify/orders?q= — find orders by number or email, each with its customer */
export const GET = withAuth(async (req: AuthenticatedRequest) => {
  const results = await shopifyService.searchOrders(req.user.organizationId, req.nextUrl.searchParams.get("q") || "");
  return NextResponse.json({ success: true, results });
});
