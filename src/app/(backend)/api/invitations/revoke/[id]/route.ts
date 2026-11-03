import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest, assertRole } from "@/lib/security/auth";
import { invitationService } from "@/lib/services/invitation.service";
import { invitationRepository, userRepository } from "@/lib/db/repositories";
import { AppError } from "@/lib/errors";

/**
 * DELETE /api/invitations/revoke/[id]
 * Revokes a pending invitation and cleans up any pending invited user record.
 */
export const DELETE = withAuth<{ params: Promise<{ id: string }> }>(
  async (req: AuthenticatedRequest, context) => {
    assertRole(req.user.role, ["OWNER", "ADMIN"]);

    const resolved = await context?.params;
    const invitationId = Number(resolved?.id);
    if (!invitationId || isNaN(invitationId)) {
      throw AppError.validation("Invalid invitation ID.", "id");
    }

    const orgId = req.user.organizationId;
    const invites = await invitationRepository.listByOrg(orgId);
    const target = invites.find((i) => i.id === invitationId);

    if (!target) {
      throw AppError.notFound("Invitation not found.");
    }

    // Revoke the invitation
    await invitationService.revokeInvitation(invitationId, orgId);

    // If an invited user row exists with status 'invited', delete it
    const existingUser = await userRepository.findByEmailAndOrg(orgId, target.email);
    if (existingUser && existingUser.status === "invited") {
      await userRepository.deleteTeamMember(existingUser.id, orgId);
    }

    return NextResponse.json({
      success: true,
      message: `Invitation for ${target.email} has been revoked.`,
    });
  }
);
