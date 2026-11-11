import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest } from "@/lib/security/auth";
import { assertCanManageIntegrations } from "@/lib/security/store-access";
import { shopifyStoreConnectionService } from "@/lib/services";

/**
 * GET /api/integrations/shopify/stores — every store connection of the workspace (connected or needing
 * re-authorization, oldest first), each with the channels mapped to it. Never includes tokens.
 * Requires integrations:read + manage_billing_and_integrations.
 */
export const GET = withAuth(async (req: AuthenticatedRequest) => {
  assertCanManageIntegrations(req.user, "read");
  const stores = await shopifyStoreConnectionService.listStores(req.user.organizationId);
  return NextResponse.json({ success: true, stores });
});
