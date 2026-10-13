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
   * Find a user by their ID
   */
  async findById(id: number): Promise<User | null> {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, id))
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
