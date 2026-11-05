import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest, assertRole, hasPermission } from "@/lib/security/auth";
import { organizationRepository } from "@/lib/db/repositories";
import { db } from "@/lib/db";
import { organizations } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { readJson } from "@/lib/api/handler";
import { AppError } from "@/lib/errors";

const PLAN_SEATS: Record<string, number> = {
  Starter: 3,
  Growth: 10,
  Pro: 25,
  Enterprise: 100,
};

/**
 * POST /api/team/upgrade
 * Upgrades the organization's plan and seat limits.
 */
export const POST = withAuth(async (req: AuthenticatedRequest) => {
  const org = await organizationRepository.findById(req.user.organizationId);
  const canManage = hasPermission(req.user.role, "manage_billing_and_integrations", org?.rolePermissions as any);
  if (!canManage) {
    throw new AppError("FORBIDDEN", { message: "You do not have permission to manage billing and upgrade plans.", expected: true });
  }

  const orgId = req.user.organizationId;
  const body = (await readJson(req)) ?? {};
  const requestedPlan = body.plan ? String(body.plan).trim() : "Pro";

  const targetPlan =
    Object.keys(PLAN_SEATS).find((p) => p.toLowerCase() === requestedPlan.toLowerCase()) || "Pro";

  const newSeats = PLAN_SEATS[targetPlan] || 25;

  const [updated] = await db
    .update(organizations)
    .set({
      plan: targetPlan.toLowerCase(),
      maxSeats: newSeats,
      updatedAt: new Date(),
    })
    .where(eq(organizations.id, orgId))
    .returning();

  return NextResponse.json({
    success: true,
    message: `Plan upgraded to ${targetPlan} with ${newSeats} seats.`,
    plan: targetPlan,
    maxSeats: newSeats,
  });
});
