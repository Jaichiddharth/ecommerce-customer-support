import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest, assertRole, assertPagePermission } from "@/lib/security/auth";
import { userRepository } from "@/lib/db/repositories";
import { AppError } from "@/lib/errors";
import { readJson } from "@/lib/api/handler";

export const PATCH = withAuth<{ params: Promise<{ id: string }> }>(
  async (req: AuthenticatedRequest, context) => {
    assertRole(req.user.role, ["OWNER", "ADMIN"]);
    assertPagePermission(req.user, 'settings', 'update');

    const resolved = await context?.params;
    const memberId = Number(resolved?.id);
    if (!memberId || isNaN(memberId)) {
      throw AppError.validation("Invalid member ID.", "id");
    }

    const orgId = req.user.organizationId;
    const targetUser = await userRepository.findById(memberId, orgId);
    if (!targetUser) {
      throw AppError.notFound("Team member not found.");
    }

    // Admins cannot edit an Owner or promote someone to Owner
    const isOwner = req.user.role.toUpperCase() === "OWNER";
    if (targetUser.role?.toUpperCase() === "OWNER" && !isOwner) {
      throw new AppError("FORBIDDEN", {
        message: "Only workspace Owners can modify an Owner's account.",
        expected: true,
      });
    }

    const body = (await readJson(req)) ?? {};
    const { role, teams, languages, stores, customPermissions, status, name } = body;

    if (role && role.toUpperCase() === "OWNER" && !isOwner) {
      throw new AppError("FORBIDDEN", {
        message: "Only workspace Owners can promote a member to Owner.",
        expected: true,
      });
    }

    const updated = await userRepository.updateTeamMember(memberId, orgId, {
      role: role ? String(role).toUpperCase() : undefined,
      teams: Array.isArray(teams) ? teams : undefined,
      languages: Array.isArray(languages) ? languages : undefined,
      stores: Array.isArray(stores) ? stores : undefined,
      customPermissions: customPermissions !== undefined ? customPermissions : undefined,
      status: status ? String(status) : undefined,
      name: name ? String(name) : undefined,
    });

    return NextResponse.json({
      success: true,
      member: updated,
    });
  }
);

export const DELETE = withAuth<{ params: Promise<{ id: string }> }>(
  async (req: AuthenticatedRequest, context) => {
    assertRole(req.user.role, ["OWNER", "ADMIN"]);
    assertPagePermission(req.user, 'settings', 'delete');

    const resolved = await context?.params;
    const memberId = Number(resolved?.id);
    if (!memberId || isNaN(memberId)) {
      throw AppError.validation("Invalid member ID.", "id");
    }

    const orgId = req.user.organizationId;
    if (req.user.id === memberId) {
      throw AppError.validation("You cannot remove your own account from the workspace.", "id");
    }

    const targetUser = await userRepository.findById(memberId, orgId);
    if (!targetUser) {
      throw AppError.notFound("Team member not found.");
    }

    // Admins cannot remove an Owner
    const isOwner = req.user.role.toUpperCase() === "OWNER";
    if (targetUser.role?.toUpperCase() === "OWNER" && !isOwner) {
      throw new AppError("FORBIDDEN", {
        message: "Only workspace Owners can remove an Owner.",
        expected: true,
      });
    }

    await userRepository.deleteTeamMember(memberId, orgId);

    return NextResponse.json({
      success: true,
      message: `${targetUser.name} has been removed from the workspace.`,
    });
  }
);
