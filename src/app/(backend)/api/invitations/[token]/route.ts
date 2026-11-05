import { NextRequest, NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { invitationService } from "@/lib/services/invitation.service";

/**
 * GET /api/invitations/[token]
 * Public endpoint to inspect and validate an invitation token before accepting.
 */
export const GET = apiHandler<{ params: Promise<{ token: string }> }>(
  async (req: NextRequest, context) => {
    const resolved = await context?.params;
    const token = resolved?.token;

    if (!token) {
      return NextResponse.json({
        success: false,
        valid: false,
        reason: "not_found",
        message: "No invitation token provided.",
      });
    }

    const check = await invitationService.getInvitationByToken(token);

    return NextResponse.json({
      success: true,
      valid: check.valid,
      reason: check.reason,
      invitation: check.invitation || null,
    });
  }
);
