import { organizationRepository } from "../db/repositories/organization.repository";
import { Organization } from "../db/schema";
import { AppError } from "../errors";

/**
 * Organization that newly signed-up users join until invitations exist.
 * Seeded by `npm run db:seed` (scripts/seed-org.mjs) — keep the slug in sync.
 */
export const DEFAULT_ORG_SLUG = process.env.DEFAULT_ORG_SLUG || "la-confianza-tech";

export const WORKSPACE_NAME_MIN = 2;
export const WORKSPACE_NAME_MAX = 100;

export class OrganizationService {
  async getDefaultOrganization(): Promise<Organization> {
    const org = await organizationRepository.findBySlug(DEFAULT_ORG_SLUG);
    if (!org) {
      throw new AppError("INTERNAL_ERROR", {
        message: "Your workspace is not set up yet. Please contact your administrator.",
        cause: new Error(`Default organization "${DEFAULT_ORG_SLUG}" not found. Run "npm run db:seed" to create it.`),
      });
    }
    return org;
  }

  async getOrganizationBySlug(slug: string): Promise<Organization | null> {
    return await organizationRepository.findBySlug(slug);
  }

  async getOrganizationById(id: number): Promise<Organization | null> {
    return await organizationRepository.findById(id);
  }

  /** Renames a workspace. The slug stays fixed: it identifies the workspace at sign-in. */
  async updateWorkspaceName(id: number, rawName: unknown): Promise<Organization> {
    const name = typeof rawName === "string" ? rawName.trim().replace(/\s+/g, " ") : "";
    if (name.length < WORKSPACE_NAME_MIN || name.length > WORKSPACE_NAME_MAX) {
      throw AppError.validation(
        `Workspace name must be between ${WORKSPACE_NAME_MIN} and ${WORKSPACE_NAME_MAX} characters.`,
        "name"
      );
    }
    const updated = await organizationRepository.updateDetails(id, { name });
    if (!updated) throw AppError.notFound("Workspace not found.");
    return updated;
  }

  /** Creates a brand-new workspace (called during sign-up). */
  async createOrganization(data: { name: string; slug: string }): Promise<Organization> {
    return await organizationRepository.create({
      name: data.name,
      slug: data.slug,
    });
  }
}

export const organizationService = new OrganizationService();
