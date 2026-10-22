import { NextRequest, NextResponse } from "next/server";
import { userService } from "@/lib/services/user.service";
import { adminAuth } from "@/lib/firebase/admin";
import { verifyFirebaseToken } from "@/lib/security/auth";
import { apiHandler } from "@/lib/api/handler";
import { createLogger, setRequestContext } from "@/lib/logger";
import { organizationRepository } from "@/lib/db/repositories/organization.repository";

const log = createLogger("auth.sync");

/**
 * POST /api/auth/sync
 * Registers / refreshes the signed-in Firebase user in PostgreSQL.
 * Identity (uid, email) comes from the verified ID token; organization and role are decided by the server.
 * Body (optional): { name, avatarUrl, firebaseGcmToken, workspaceSlug, workspaceName }
 */
export const POST = apiHandler(async (req: NextRequest) => {
  // Throws AUTH_TOKEN_MISSING / AUTH_TOKEN_EXPIRED / AUTH_TOKEN_INVALID (401)
  const decodedToken = await verifyFirebaseToken(req);

  // The body is optional, so a missing/invalid one is treated as empty
  const body = await req.json().catch(() => ({}));
  const { name, avatarUrl, firebaseGcmToken, workspaceSlug, workspaceName } = body ?? {};

  const user = await userService.syncUser(
    decodedToken,
    {
      name: typeof name === "string" ? name.trim() : undefined,
      avatarUrl: typeof avatarUrl === "string" ? avatarUrl : avatarUrl === null ? null : undefined,
      firebaseGcmToken: typeof firebaseGcmToken === "string" ? firebaseGcmToken : undefined,
    },
    typeof workspaceSlug === "string" ? workspaceSlug.trim().toLowerCase() : undefined,
    typeof workspaceName === "string" && workspaceName.trim() ? workspaceName.trim().slice(0, 255) : undefined,
  );

  setRequestContext({ userId: user.id, orgId: user.organizationId });

  // Set custom user claims in Firebase so every token automatically carries organizationId and userId
  try {
    await adminAuth.setCustomUserClaims(decodedToken.uid, {
      organizationId: user.organizationId,
      userId: user.id,
      role: user.role,
    });
  } catch (err) {
    // Non-fatal: the server resolves the user from the database on every request anyway
    log.warn("Could not set Firebase custom claims", { err, uid: decodedToken.uid });
  }

  const organization = await organizationRepository.findById(user.organizationId);

  return NextResponse.json({
    success: true,
    user: {
      id: user.id,
      organizationId: user.organizationId,
      organizationName: organization?.name ?? null,
      name: user.name,
      email: user.email,
      role: user.role,
      avatarUrl: user.avatarUrl,
      isOnline: user.isOnline,
      createdAt: user.createdAt,
    },
  });
});
