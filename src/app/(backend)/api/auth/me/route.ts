import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest } from "@/lib/security/auth";

/**
 * GET /api/auth/me
 * Returns the signed-in user's profile.
 */
export const GET = withAuth(async (req: AuthenticatedRequest) => {
  return NextResponse.json({
    success: true,
    user: req.user,
  });
});
