import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest } from "@/lib/security/auth";
import { shopifyService } from "@/lib/services";
import { AppError } from "@/lib/errors";

/** GET /api/integrations/shopify — the organization's store connection (never includes tokens) */
export const GET = withAuth(async (req: AuthenticatedRequest) => {
  const connection = await shopifyService.getConnection(req.user.organizationId);
  return NextResponse.json({ success: true, ...connection });
});

/** DELETE /api/integrations/shopify — disconnect the store (admins only) */
export const DELETE = withAuth(async (req: AuthenticatedRequest) => {
  if (req.user.role !== "ADMIN") {
    throw new AppError("FORBIDDEN", { message: "Only workspace admins can disconnect the Shopify store.", expected: true });
  }
  await shopifyService.disconnect(req.user.organizationId);
  return NextResponse.json({ success: true });
});
