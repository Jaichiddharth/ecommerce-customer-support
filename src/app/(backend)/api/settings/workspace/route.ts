import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest, assertRole, assertPagePermission } from "@/lib/security/auth";
import { canUser } from "@/lib/security/permissions";
import { organizationRepository } from "@/lib/db/repositories";
import { organizationService } from "@/lib/services";
import { readJson } from "@/lib/api/handler";
import { AppError } from "@/lib/errors";
import type { Organization } from "@/lib/db/schema";

const EDIT_ROLES = ["OWNER", "ADMIN"];

function toWorkspaceDetails(org: Organization, canEdit: boolean) {
  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    createdAt: org.createdAt,
    updatedAt: org.updatedAt,
    canEdit,
  };
}

function canEditWorkspace(user: AuthenticatedRequest["user"]): boolean {
  return EDIT_ROLES.includes((user.role || "").toUpperCase()) && canUser(user, "settings", "update");
}

/** Settings → General: details of the caller's workspace. */
export const GET = withAuth(async (req: AuthenticatedRequest) => {
  assertPagePermission(req.user, "settings", "read");

  const org = await organizationRepository.findById(req.user.organizationId);
  if (!org) throw AppError.notFound("Workspace not found.");

  return NextResponse.json({ success: true, workspace: toWorkspaceDetails(org, canEditWorkspace(req.user)) });
});

/** Renames the caller's workspace (OWNER / ADMIN only). */
export const PATCH = withAuth(async (req: AuthenticatedRequest) => {
  assertRole(req.user.role, EDIT_ROLES);
  assertPagePermission(req.user, "settings", "update");

  const body = (await readJson<{ name?: unknown }>(req)) ?? {};
  const org = await organizationService.updateWorkspaceName(req.user.organizationId, body.name);

  return NextResponse.json({
    success: true,
    message: "Workspace details updated",
    workspace: toWorkspaceDetails(org, true),
  });
});
