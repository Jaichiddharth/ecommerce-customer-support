import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest, assertRole, assertPagePermission } from "@/lib/security/auth";
import { organizationRepository } from "@/lib/db/repositories";
import { readJson } from "@/lib/api/handler";
import { publish } from "@/lib/realtime";

export const GET = withAuth(async (req: AuthenticatedRequest) => {
  assertRole(req.user.role, ["OWNER", "ADMIN"]);
  assertPagePermission(req.user, "settings", "read");

  const orgId = req.user.organizationId;
  const org = await organizationRepository.findById(orgId);
  const stored = (org?.rolePermissions as Record<string, any>) || {};

  return NextResponse.json({
    success: true,
    routingConfig: stored.routingConfig || null,
  });
});

export const POST = withAuth(async (req: AuthenticatedRequest) => {
  assertRole(req.user.role, ["OWNER", "ADMIN"]);
  assertPagePermission(req.user, "settings", "update");

  const orgId = req.user.organizationId;
  const body = (await readJson(req)) ?? {};
  const { routingConfig } = body;

  if (!routingConfig || typeof routingConfig !== "object") {
    return NextResponse.json({ success: false, message: "Invalid routing configuration" }, { status: 400 });
  }

  const org = await organizationRepository.findById(orgId);
  const existing = (org?.rolePermissions as Record<string, any>) || {};

  const updated = {
    ...existing,
    routingConfig,
  };

  await organizationRepository.updatePermissions(orgId, updated);
  publish(orgId, { type: "routing.updated" });

  return NextResponse.json({
    success: true,
    message: "Routing and business hours saved successfully",
    routingConfig,
  });
});

