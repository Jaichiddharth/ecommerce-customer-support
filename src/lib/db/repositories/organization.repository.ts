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

  async listAll(): Promise<Organization[]> {
    return await db.select().from(organizations);
  }
}

export const organizationRepository = new OrganizationRepository();
