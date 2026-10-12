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
   * 1. Existing user matched by Firebase UID keeps its organization and role.
   * 2. A pre-created user row is linked by email only when Firebase has verified that email.
   * 3. Otherwise a new AGENT is created in the default organization.
   */
  async syncUser(decodedToken: DecodedIdToken, profile: SyncProfileDTO = {}): Promise<User> {
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

    const existingByUid = await userRepository.findByFirebaseIdToken(uid);
    if (existingByUid) {
      return await userRepository.updateProfile(existingByUid.id, profileUpdates);
    }

    const defaultOrg = await organizationService.getDefaultOrganization();
    const existingByEmail = await userRepository.findByEmailAndOrg(defaultOrg.id, email);
    if (existingByEmail) {
      if (!decodedToken.email_verified) {
        throw new AppError("CONFLICT", {
          message: "An account with this email already exists. Verify your email address to link it.",
          details: { email },
          expected: true,
        });
      }
      return await userRepository.updateProfile(existingByEmail.id, {
        ...profileUpdates,
        firebaseIdToken: uid,
      });
    }

    // Demo convenience: the seeded admin email becomes ADMIN, everyone else starts as AGENT
    const role = email === "admin@gmail.com" ? "ADMIN" : "AGENT";

    return await userRepository.create({
      organizationId: defaultOrg.id,
      email,
      name: profile.name || decodedToken.name || email.split("@")[0] || "Team Member",
      role,
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
