import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest, assertRole, DEFAULT_ROLE_PERMISSIONS } from "@/lib/security/auth";
import { organizationRepository } from "@/lib/db/repositories";
import { readJson } from "@/lib/api/handler";
import { publish } from "@/lib/realtime";

export const GET = withAuth(async (req: AuthenticatedRequest) => {
  const orgId = req.user.organizationId;
  const org = await organizationRepository.findById(orgId);
  const storedPermissions = (org?.rolePermissions as Record<string, Record<string, boolean>>) || {};

  const mergedPermissions = {
    OWNER: DEFAULT_ROLE_PERMISSIONS.OWNER,
    ADMIN: { ...DEFAULT_ROLE_PERMISSIONS.ADMIN, ...(storedPermissions.ADMIN || {}) },
    AGENT: { ...DEFAULT_ROLE_PERMISSIONS.AGENT, ...(storedPermissions.AGENT || {}) },
    VIEWER: { ...DEFAULT_ROLE_PERMISSIONS.VIEWER, ...(storedPermissions.VIEWER || {}) },
  };

  return NextResponse.json({
    success: true,
    permissions: mergedPermissions,
  });
});

export const PATCH = withAuth(async (req: AuthenticatedRequest) => {
  assertRole(req.user.role, ["OWNER", "ADMIN"]);

  const orgId = req.user.organizationId;
  const body = (await readJson(req)) ?? {};
  const { permissions, reset } = body;

  if (reset === true || permissions === null) {
    await organizationRepository.updatePermissions(orgId, null as any);
    publish(orgId, { type: "permissions.updated" });
    return NextResponse.json({
      success: true,
      message: "Role permissions reset to defaults",
      permissions: DEFAULT_ROLE_PERMISSIONS,
    });
  }

  if (!permissions || typeof permissions !== "object") {
    return NextResponse.json({ success: false, message: "Invalid permissions object" }, { status: 400 });
  }

  // Ensure OWNER always stays 100% true
  const sanitized = {
    ...permissions,
    OWNER: DEFAULT_ROLE_PERMISSIONS.OWNER,
  };

  await organizationRepository.updatePermissions(orgId, sanitized);
  publish(orgId, { type: "permissions.updated" });

  return NextResponse.json({
    success: true,
    message: "Role permissions saved successfully",
    permissions: sanitized,
  });
});
