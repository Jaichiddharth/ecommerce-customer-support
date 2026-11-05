import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest, assertRole } from "@/lib/security/auth";
import { invitationService } from "@/lib/services/invitation.service";
import { invitationRepository } from "@/lib/db/repositories";
import { readJson } from "@/lib/api/handler";
import { AppError } from "@/lib/errors";

/**
 * POST /api/invitations/resend
 * Resends an invitation with a fresh 7-day token.
 */
export const POST = withAuth(async (req: AuthenticatedRequest) => {
  assertRole(req.user.role, ["OWNER", "ADMIN"]);

  const orgId = req.user.organizationId;
  const body = (await readJson(req)) ?? {};
  const { invitationId, email } = body;

  let targetId = Number(invitationId);

  if (!targetId && email) {
    const list = await invitationRepository.listByOrg(orgId);
    const found = list.find((i) => i.email.toLowerCase() === String(email).toLowerCase().trim() && i.status === "pending");
    if (found) targetId = found.id;
  }

  if (!targetId) {
    throw AppError.validation("A valid invitationId or email is required to resend.", "invitationId");
  }

  const forwardedHost = req.headers.get("x-forwarded-host");
  const forwardedProto = req.headers.get("x-forwarded-proto") || "https";
  const headerOrigin = forwardedHost ? `${forwardedProto}://${forwardedHost}` : req.headers.get("origin");
  const originUrl = body.originUrl || headerOrigin || req.nextUrl.origin;
  const result = await invitationService.resendInvitation(
    targetId,
    orgId,
    { name: req.user.name, email: req.user.email },
    originUrl
  );

  return NextResponse.json({
    success: true,
    message: `Invitation resent to ${result.email}`,
    invitation: result,
  });
});
