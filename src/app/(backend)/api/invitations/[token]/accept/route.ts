import { NextRequest, NextResponse } from "next/server";
import { apiHandler, readJson } from "@/lib/api/handler";
import { verifyFirebaseToken } from "@/lib/security/auth";
import { invitationService } from "@/lib/services/invitation.service";
import { AppError } from "@/lib/errors";

/**
 * POST /api/invitations/[token]/accept
 * Authenticated endpoint: allows the signed-in user (Google or password) to accept an invitation.
 * Enforces:
 * 1. Single-use: invalidates token upon acceptance.
 * 2. Strict identity match: only the invited email can accept.
 * 3. 2-step verification requirement for Admins and Owners.
 */
export const POST = apiHandler<{ params: Promise<{ token: string }> }>(
  async (req: NextRequest, context) => {
    // Throws AUTH_TOKEN_MISSING / AUTH_TOKEN_EXPIRED / AUTH_TOKEN_INVALID
    const decodedToken = await verifyFirebaseToken(req);
    const resolved = await context?.params;
    const token = resolved?.token;

    if (!token) {
      throw AppError.validation("Invitation token is required.", "token");
    }

    if (!decodedToken.email) {
      throw AppError.validation("Your sign-in provider did not provide an email address.", "email");
    }

    const body = (await readJson(req)) ?? {};
    const { twoFactorVerified } = body;

    const result = await invitationService.acceptInvitation(
      token,
      {
        uid: decodedToken.uid,
        email: decodedToken.email,
        name: decodedToken.name,
        picture: (decodedToken.picture as string | undefined) || null,
      },
      Boolean(twoFactorVerified)
    );

    return NextResponse.json({
      success: true,
      message: `You have successfully joined ${result.workspaceName}!`,
      workspaceSlug: result.workspaceSlug,
      workspaceName: result.workspaceName,
      role: result.role,
    });
  }
);
