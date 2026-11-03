import { NextRequest, NextResponse } from "next/server";
import { userService } from "@/lib/services/user.service";
import { adminAuth } from "@/lib/firebase/admin";
import { verifyFirebaseToken, hasPermission, UserRole, PermissionKey } from "@/lib/security/auth";
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
  const normRole = (user.role || "AGENT").toUpperCase() as UserRole;
  const storedPermissions = (organization?.rolePermissions as any) || {};

  const effectivePermissions: Record<PermissionKey, boolean> = {
    view_and_reply_chats: hasPermission(normRole, "view_and_reply_chats", storedPermissions),
    see_all_chats: hasPermission(normRole, "see_all_chats", storedPermissions),
    send_templates_outside_24h: hasPermission(normRole, "send_templates_outside_24h", storedPermissions),
    create_and_launch_campaigns: hasPermission(normRole, "create_and_launch_campaigns", storedPermissions),
    edit_bots_and_flows: hasPermission(normRole, "edit_bots_and_flows", storedPermissions),
    export_contacts_and_consent: hasPermission(normRole, "export_contacts_and_consent", storedPermissions),
    erase_contacts: hasPermission(normRole, "erase_contacts", storedPermissions),
    manage_billing_and_integrations: hasPermission(normRole, "manage_billing_and_integrations", storedPermissions),
  };

  return NextResponse.json({
    success: true,
    user: {
      id: user.id,
      organizationId: user.organizationId,
      organizationName: organization?.name ?? null,
      organizationSlug: organization?.slug ?? null,
      organizationPlan: organization?.plan ?? null,
      organizationSeats: organization?.maxSeats ?? null,
      name: user.name,
      email: user.email,
      role: user.role,
      permissions: effectivePermissions,
      avatarUrl: user.avatarUrl,
      isOnline: user.isOnline,
      createdAt: user.createdAt,
    },
  });
});
