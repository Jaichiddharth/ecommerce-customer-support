import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest, hasPermission } from "@/lib/security/auth";
import { shopifyService } from "@/lib/services";
import { organizationRepository } from "@/lib/db/repositories";
import { AppError } from "@/lib/errors";

/** GET /api/integrations/shopify — the organization's store connections (never includes tokens) */
export const GET = withAuth(async (req: AuthenticatedRequest) => {
  const org = await organizationRepository.findById(req.user.organizationId);
  const canManage = hasPermission(req.user.role, "manage_billing_and_integrations", org?.rolePermissions as any);
  if (!canManage) {
    return NextResponse.json({ success: true, configured: false, stores: [], restricted: true });
  }

  const connection = await shopifyService.getConnection(req.user.organizationId);
  return NextResponse.json({ success: true, ...connection });
});

/** DELETE /api/integrations/shopify?storeId=… — disconnect one store */
export const DELETE = withAuth(async (req: AuthenticatedRequest) => {
  const org = await organizationRepository.findById(req.user.organizationId);
  const canManage = hasPermission(req.user.role, "manage_billing_and_integrations", org?.rolePermissions as any);
  if (!canManage) {
    throw new AppError("FORBIDDEN", { message: "You do not have permission to manage billing and integrations.", expected: true });
  }
  const storeId = Number(req.nextUrl.searchParams.get("storeId"));
  if (!Number.isInteger(storeId) || storeId <= 0) {
    throw AppError.validation("Choose the store to disconnect.", "storeId");
  }
  await shopifyService.disconnect(req.user.organizationId, storeId);
  return NextResponse.json({ success: true });
});
