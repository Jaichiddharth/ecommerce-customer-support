import { db } from "..";
import { users, type User } from "../schema";
import { eq, and } from "drizzle-orm";

export class UserRepository {
  /**
   * Find a user by email within an organization
   */
  async findByEmailAndOrg(organizationId: number, email: string): Promise<User | null> {
    const [user] = await db
      .select()
      .from(users)
      .where(
        and(
          eq(users.organizationId, organizationId),
          eq(users.email, email.toLowerCase())
        )
      )
      .limit(1);

    return user || null;
  }

  /**
   * Find a user by their ID, optionally scoped to an organization
   */
  async findById(id: number, organizationId?: number): Promise<User | null> {
    const condition = organizationId !== undefined
      ? and(eq(users.id, id), eq(users.organizationId, organizationId))
      : eq(users.id, id);

    const [user] = await db
      .select()
      .from(users)
      .where(condition)
      .limit(1);

    return user || null;
  }

  /**
   * Find a user by Firebase ID Token (UID)
   */
  async findByFirebaseIdToken(firebaseIdToken: string, organizationId?: number): Promise<User | null> {
    const condition = organizationId
      ? and(eq(users.firebaseIdToken, firebaseIdToken), eq(users.organizationId, organizationId))
      : eq(users.firebaseIdToken, firebaseIdToken);

    const [user] = await db
      .select()
      .from(users)
      .where(condition)
      .limit(1);

    return user || null;
  }

  /**
   * Find a user by email across all organizations (sign-in path).
   * Used when Firebase UID lookup misses — e.g. first Google sign-in by a user
   * who previously registered with email/password.
   */
  async findByEmail(email: string): Promise<User | null> {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, email.toLowerCase()))
      .limit(1);

    return user || null;
  }

  /**
   * Create a user inside an organization
   */
  async create(data: {
    organizationId: number;
    name: string;
    email: string;
    role: string;
    avatarUrl?: string | null;
    isOnline?: boolean;
    firebaseIdToken: string;
    firebaseGcmToken?: string;
  }): Promise<User> {
    const [upserted] = await db
      .insert(users)
      .values({
        organizationId: data.organizationId,
        name: data.name,
        email: data.email.toLowerCase().trim(),
        passwordHash: "firebase_managed_auth",
        role: data.role,
        avatarUrl: data.avatarUrl || null,
        isOnline: data.isOnline ?? false,
        firebaseIdToken: data.firebaseIdToken,
        firebaseGcmToken: data.firebaseGcmToken || "pending_fcm_token",
      })
      .onConflictDoUpdate({
        target: [users.organizationId, users.email],
        set: {
          // Link the (possibly new) Firebase UID and refresh mutable fields
          firebaseIdToken: data.firebaseIdToken,
          ...(data.name ? { name: data.name } : {}),
          ...(data.avatarUrl !== undefined ? { avatarUrl: data.avatarUrl || null } : {}),
          ...(data.firebaseGcmToken ? { firebaseGcmToken: data.firebaseGcmToken } : {}),
          isOnline: data.isOnline ?? true,
          updatedAt: new Date(),
        },
      })
      .returning();

    return upserted;
  }

  /**
   * Update login/profile fields of an existing user.
   * Organization and role are intentionally not updatable here.
   */
  async updateProfile(
    id: number,
    data: Partial<{
      name: string;
      avatarUrl: string | null;
      isOnline: boolean;
      firebaseIdToken: string;
      firebaseGcmToken: string;
    }>
  ): Promise<User> {
    const [updated] = await db
      .update(users)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();

    return updated;
  }

  /**
   * List all users for a given organization
   */
  async listByOrg(organizationId: number): Promise<User[]> {
    return await db
      .select()
      .from(users)
      .where(eq(users.organizationId, organizationId));
  }

  /**
   * Count total members in an organization
   */
  async countByOrg(organizationId: number): Promise<number> {
    const list = await this.listByOrg(organizationId);
    return list.length;
  }

  /**
   * Invite or create a team member in an organization
   */
  async createTeamMember(data: {
    organizationId: number;
    name: string;
    email: string;
    role: string;
    teams?: string[];
    languages?: string[];
    stores?: string[];
    customPermissions?: Record<string, boolean> | null;
    status?: string;
  }): Promise<User> {
    const [created] = await db
      .insert(users)
      .values({
        organizationId: data.organizationId,
        name: data.name.trim(),
        email: data.email.toLowerCase().trim(),
        passwordHash: "pending_invite",
        role: data.role.toUpperCase(),
        teams: data.teams ?? [],
        languages: data.languages ?? ["EN"],
        stores: data.stores ?? [],
        customPermissions: data.customPermissions || null,
        status: data.status ?? "invited",
        firebaseIdToken: `invite_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
        firebaseGcmToken: "pending_fcm_token",
      })
      .returning();

    return created;
  }

  /**
   * Update a team member's role, teams, languages, stores, permissions, or status
   */
  async updateTeamMember(
    id: number,
    organizationId: number,
    data: Partial<{
      name: string;
      role: string;
      teams: string[];
      languages: string[];
      stores: string[];
      customPermissions: Record<string, any> | null;
      status: string;
      avatarUrl: string | null;
      twoFactorEnabled: boolean;
      twoFactorSecret: string | null;
      twoFactorBackupCodes: string[];
    }>
  ): Promise<User | null> {
    const updatePayload: Record<string, unknown> = {
      updatedAt: new Date(),
    };
    if (data.name !== undefined) updatePayload.name = data.name.trim();
    if (data.role !== undefined) updatePayload.role = data.role.toUpperCase();
    if (data.teams !== undefined) updatePayload.teams = data.teams;
    if (data.languages !== undefined) updatePayload.languages = data.languages;
    if (data.stores !== undefined) updatePayload.stores = data.stores;
    if (data.customPermissions !== undefined) updatePayload.customPermissions = data.customPermissions;
    if (data.status !== undefined) updatePayload.status = data.status;
    if (data.avatarUrl !== undefined) updatePayload.avatarUrl = data.avatarUrl;
    if (data.twoFactorEnabled !== undefined) updatePayload.twoFactorEnabled = data.twoFactorEnabled;
    if (data.twoFactorSecret !== undefined) updatePayload.twoFactorSecret = data.twoFactorSecret;
    if (data.twoFactorBackupCodes !== undefined) updatePayload.twoFactorBackupCodes = data.twoFactorBackupCodes;

    const [updated] = await db
      .update(users)
      .set(updatePayload)
      .where(and(eq(users.id, id), eq(users.organizationId, organizationId)))
      .returning();

    return updated || null;
  }

  /**
   * Activate an invited user upon acceptance of invitation
   */
  async activateInvitedUser(
    organizationId: number,
    email: string,
    data: {
      name: string;
      role: string;
      teams: string[];
      languages: string[];
      stores?: string[];
      customPermissions?: Record<string, boolean> | null;
      firebaseIdToken: string;
      avatarUrl?: string | null;
    }
  ): Promise<User> {
    const existing = await this.findByEmailAndOrg(organizationId, email);
    if (existing) {
      const [updated] = await db
        .update(users)
        .set({
          name: data.name.trim() || existing.name,
          role: data.role.toUpperCase(),
          teams: data.teams,
          languages: data.languages,
          stores: data.stores ?? existing.stores ?? [],
          customPermissions: data.customPermissions !== undefined ? data.customPermissions : existing.customPermissions,
          status: "active",
          firebaseIdToken: data.firebaseIdToken,
          avatarUrl: data.avatarUrl ?? existing.avatarUrl,
          updatedAt: new Date(),
        })
        .where(eq(users.id, existing.id))
        .returning();
      return updated;
    }

    // Otherwise create brand new user row in this org
    const [created] = await db
      .insert(users)
      .values({
        organizationId,
        name: data.name.trim(),
        email: email.toLowerCase().trim(),
        passwordHash: "firebase_managed_auth",
        role: data.role.toUpperCase(),
        teams: data.teams,
        languages: data.languages,
        stores: data.stores ?? [],
        customPermissions: data.customPermissions || null,
        status: "active",
        firebaseIdToken: data.firebaseIdToken,
        firebaseGcmToken: "pending_fcm_token",
        avatarUrl: data.avatarUrl || null,
      })
      .returning();

    return created;
  }

  /**
   * Remove a member from an organization
   */
  async deleteTeamMember(id: number, organizationId: number): Promise<boolean> {
    const [deleted] = await db
      .delete(users)
      .where(and(eq(users.id, id), eq(users.organizationId, organizationId)))
      .returning();

    return Boolean(deleted);
  }

  /**
   * Update online status of a user
   */
  async updateOnlineStatus(userId: number, isOnline: boolean): Promise<User | null> {
    const [updated] = await db
      .update(users)
      .set({ isOnline, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();
    return updated || null;
  }
}

export const userRepository = new UserRepository();
