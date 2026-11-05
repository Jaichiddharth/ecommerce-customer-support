import { db } from "../index";
import { invitations, Invitation, NewInvitation, organizations, users } from "../schema";
import { eq, and, desc, sql, gt, count } from "drizzle-orm";

export interface InvitationWithDetails extends Invitation {
  organizationName?: string;
  inviterName?: string | null;
  inviterEmail?: string | null;
}

export class InvitationRepository {
  async create(data: {
    organizationId: number;
    email: string;
    name?: string | null;
    role: string;
    customPermissions?: Record<string, boolean> | null;
    teams?: string[];
    languages?: string[];
    stores?: string[];
    token: string;
    invitedById?: number | null;
    expiresAt: Date;
  }): Promise<Invitation> {
    const [created] = await db
      .insert(invitations)
      .values({
        organizationId: data.organizationId,
        email: data.email.toLowerCase().trim(),
        name: data.name?.trim() || null,
        role: data.role.toUpperCase(),
        customPermissions: data.customPermissions || null,
        teams: data.teams ?? [],
        languages: data.languages ?? ["EN"],
        stores: data.stores ?? [],
        token: data.token,
        invitedById: data.invitedById || null,
        status: "pending",
        expiresAt: data.expiresAt,
      })
      .returning();

    return created;
  }

  async findByToken(token: string): Promise<InvitationWithDetails | null> {
    const rows = await db
      .select({
        invitation: invitations,
        orgName: organizations.name,
        inviterName: users.name,
        inviterEmail: users.email,
      })
      .from(invitations)
      .innerJoin(organizations, eq(invitations.organizationId, organizations.id))
      .leftJoin(users, eq(invitations.invitedById, users.id))
      .where(eq(invitations.token, token))
      .limit(1);

    if (rows.length === 0) return null;
    const row = rows[0];
    return {
      ...row.invitation,
      organizationName: row.orgName,
      inviterName: row.inviterName,
      inviterEmail: row.inviterEmail,
    };
  }

  async findPendingByOrgAndEmail(organizationId: number, email: string): Promise<Invitation | null> {
    const [row] = await db
      .select()
      .from(invitations)
      .where(
        and(
          eq(invitations.organizationId, organizationId),
          eq(invitations.email, email.toLowerCase().trim()),
          eq(invitations.status, "pending"),
          gt(invitations.expiresAt, new Date())
        )
      )
      .limit(1);

    return row || null;
  }

  async listByOrg(organizationId: number): Promise<InvitationWithDetails[]> {
    const rows = await db
      .select({
        invitation: invitations,
        inviterName: users.name,
        inviterEmail: users.email,
      })
      .from(invitations)
      .leftJoin(users, eq(invitations.invitedById, users.id))
      .where(eq(invitations.organizationId, organizationId))
      .orderBy(desc(invitations.createdAt));

    return rows.map((r) => ({
      ...r.invitation,
      inviterName: r.inviterName,
      inviterEmail: r.inviterEmail,
    }));
  }

  async countPendingByOrg(organizationId: number): Promise<number> {
    const [result] = await db
      .select({ count: count() })
      .from(invitations)
      .where(
        and(
          eq(invitations.organizationId, organizationId),
          eq(invitations.status, "pending"),
          gt(invitations.expiresAt, new Date())
        )
      );

    return Number(result?.count || 0);
  }

  async markAccepted(id: number): Promise<Invitation | null> {
    const [updated] = await db
      .update(invitations)
      .set({
        status: "accepted",
        acceptedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(invitations.id, id))
      .returning();

    return updated || null;
  }

  async revoke(id: number, organizationId: number): Promise<boolean> {
    const [updated] = await db
      .update(invitations)
      .set({
        status: "revoked",
        updatedAt: new Date(),
      })
      .where(and(eq(invitations.id, id), eq(invitations.organizationId, organizationId)))
      .returning();

    return Boolean(updated);
  }

  async renew(id: number, organizationId: number, newToken: string, newExpiresAt: Date): Promise<Invitation | null> {
    const [updated] = await db
      .update(invitations)
      .set({
        token: newToken,
        status: "pending",
        expiresAt: newExpiresAt,
        updatedAt: new Date(),
      })
      .where(and(eq(invitations.id, id), eq(invitations.organizationId, organizationId)))
      .returning();

    return updated || null;
  }

  async delete(id: number, organizationId: number): Promise<boolean> {
    const [deleted] = await db
      .delete(invitations)
      .where(and(eq(invitations.id, id), eq(invitations.organizationId, organizationId)))
      .returning();

    return Boolean(deleted);
  }
}

export const invitationRepository = new InvitationRepository();
