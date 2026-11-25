import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest, assertPagePermission, hasPermission } from "@/lib/security/auth";
import { organizationRepository } from "@/lib/db/repositories";
import { AppError } from "@/lib/errors";
import { billingService } from "@/lib/services";

/**
 * GET /api/billing/usage?days=30: the workspace's real usage over the last `days` days (conversations per channel,
 * AI replies and tokens, charged WhatsApp templates) and the model prices, to start the cost calculator from.
 * Requires manage_billing_and_integrations.
 */
export const GET = withAuth(async (req: AuthenticatedRequest) => {
  assertPagePermission(req.user, "settings", "read");
  const org = await organizationRepository.findById(req.user.organizationId);
  if (!hasPermission(req.user.role, "manage_billing_and_integrations", org?.rolePermissions as any)) {
    throw new AppError("FORBIDDEN", { message: "You do not have permission to view billing and usage.", expected: true });
  }
  const raw = Number(new URL(req.url).searchParams.get("days") ?? 30);
  const days = Number.isInteger(raw) && raw >= 1 && raw <= 365 ? raw : 30;
  return NextResponse.json({ success: true, usage: await billingService.usageForEstimate(req.user, days) });
});
