import type { DecodedIdToken } from "firebase-admin/auth";
import { userRepository } from "../db/repositories/user.repository";
import { User } from "../db/schema";
import { organizationService } from "./organization.service";
import { AppError } from "../errors";

/** Profile fields the client may send; identity, organization and role always come from the server. */
export interface SyncProfileDTO {
  name?: string;
  avatarUrl?: string | null;
  firebaseGcmToken?: string;
}

export class UserService {
  /**
   * Syncs the Firebase-authenticated user into the PostgreSQL users table.
   *
   * SIGN-IN path (no workspaceSlug):
   *   Looks up the user by Firebase UID, then by email across all orgs.
   *   Throws NOT_FOUND if the user has no DB record — they must sign up first.
   *
   * SIGN-UP path (workspaceSlug provided):
   *   The slug must NOT yet exist — it will be created.
   *   Throws CONFLICT if the slug is already taken.
   *   The first user in a new workspace becomes ADMIN.
   */
  async syncUser(decodedToken: DecodedIdToken, profile: SyncProfileDTO = {}, workspaceSlug?: string): Promise<User> {
    const uid = decodedToken.uid;
    const email = decodedToken.email?.toLowerCase().trim();
    if (!email) {
      throw AppError.validation("Your sign-in account has no email address. Please use an account with an email.", "email");
    }

    const profileUpdates = {
      ...(profile.name ? { name: profile.name } : {}),
      ...(profile.avatarUrl !== undefined ? { avatarUrl: profile.avatarUrl } : {}),
      ...(profile.firebaseGcmToken ? { firebaseGcmToken: profile.firebaseGcmToken } : {}),
      isOnline: true,
    };

    // ── Always check UID first (fastest path for returning users) ────────
    const existingByUid = await userRepository.findByFirebaseIdToken(uid);
    if (existingByUid) {
      return await userRepository.updateProfile(existingByUid.id, profileUpdates);
    }

    // ── SIGN-IN path ─────────────────────────────────────────────────────
    if (!workspaceSlug) {
      // Look up by email across all orgs (covers first Google sign-in by an
      // existing email/password user who gets a different Firebase UID).
      const existingByEmail = await userRepository.findByEmail(email);
      if (existingByEmail) {
        return await userRepository.updateProfile(existingByEmail.id, {
          ...profileUpdates,
          firebaseIdToken: uid, // link the new UID
        });
      }
      // No record found — user was never registered in any workspace
      throw new AppError("NOT_FOUND", {
        message: "No account found for this email. Please sign up or ask your administrator to add you to a workspace.",
        details: { email },
        expected: true,
      });
    }

    // ── SIGN-UP path ─────────────────────────────────────────────────────
    // The workspace slug must be AVAILABLE (not yet in DB).
    // We create the org here, and the first user becomes ADMIN.
    const existingOrg = await organizationService.getOrganizationBySlug(workspaceSlug);
    if (existingOrg) {
      throw new AppError("CONFLICT", {
        message: `Workspace "${workspaceSlug}" is already taken. Please choose a different name.`,
        details: { workspaceSlug },
        expected: true,
      });
    }

    // Create the new organization
    const org = await organizationService.createOrganization({
      name: workspaceSlug
        .split('-')
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' '),
      slug: workspaceSlug,
    });

    // First user in the workspace is always ADMIN
    return await userRepository.create({
      organizationId: org.id,
      email,
      name: profile.name || decodedToken.name || email.split("@")[0] || "Team Member",
      role: "ADMIN",
      avatarUrl: profile.avatarUrl ?? (decodedToken.picture as string | undefined) ?? null,
      isOnline: true,
      firebaseIdToken: uid,
      firebaseGcmToken: profile.firebaseGcmToken,
    });
  }



  /**
   * Get user profile by email and organization ID
   */
  async getUserByEmail(email: string, organizationId: number): Promise<User | null> {
    return await userRepository.findByEmailAndOrg(organizationId, email);
  }

  /**
   * Get user by ID
   */
  async getUserById(id: number): Promise<User | null> {
    return await userRepository.findById(id);
  }

  /**
   * List all users for an organization
   */
  async listUsers(organizationId: number): Promise<User[]> {
    return await userRepository.listByOrg(organizationId);
  }

  /**
   * Set user online/offline status
   */
  async setUserOnlineStatus(userId: number, isOnline: boolean): Promise<User | null> {
    return await userRepository.updateOnlineStatus(userId, isOnline);
  }
}

export const userService = new UserService();
