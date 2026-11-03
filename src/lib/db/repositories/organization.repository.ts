import { db } from "..";
import { organizations, type Organization, type NewOrganization } from "../schema";
import { eq } from "drizzle-orm";

export class OrganizationRepository {
  async findById(id: number): Promise<Organization | null> {
    const [org] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, id))
      .limit(1);

    return org || null;
  }

  async findBySlug(slug: string): Promise<Organization | null> {
    const [org] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.slug, slug))
      .limit(1);

    return org || null;
  }

  async create(data: NewOrganization): Promise<Organization> {
    const [org] = await db.insert(organizations).values(data).returning();
    return org;
  }

  async updatePermissions(id: number, permissions: Record<string, unknown>): Promise<Organization | null> {
    const [updated] = await db
      .update(organizations)
      .set({ rolePermissions: permissions, updatedAt: new Date() })
      .where(eq(organizations.id, id))
      .returning();
    return updated || null;
  }
}

export const organizationRepository = new OrganizationRepository();
