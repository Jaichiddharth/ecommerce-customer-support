import { AppError } from "../errors";
import type { AuthUser } from "./auth";
import { assertPagePermission, type CrudAction } from "./permissions";

/** Owners and admins always see every store; other members may be limited to some stores (users.stores). */
const UNRESTRICTED_ROLES = new Set(["OWNER", "ADMIN"]);

/**
 * Whether the member may work with this store. users.stores holds shop domains ('<handle>.myshopify.com');
 * an empty list or "All" means every store of the workspace. The store must already be one of the user's
 * workspace (repositories always filter by organization_id); this only narrows within the workspace.
 */
export function canAccessStore(user: Pick<AuthUser, "role" | "stores">, store: { shopDomain: string }): boolean {
  if (UNRESTRICTED_ROLES.has((user.role || "").toUpperCase())) return true;
  const allowed = (user.stores ?? []).map((s) => String(s).trim().toLowerCase()).filter(Boolean);
  if (allowed.length === 0 || allowed.includes("all")) return true;
  return allowed.includes(store.shopDomain.toLowerCase());
}

export function assertCanAccessStore(user: Pick<AuthUser, "role" | "stores">, store: { id: number; shopDomain: string }): void {
  if (!canAccessStore(user, store)) {
    throw new AppError("SHOPIFY_STORE_ACCESS_DENIED", { details: { storeId: store.id }, expected: true });
  }
}

/** Store connections and channel mappings: the Integrations page permission plus manage_billing_and_integrations */
export function assertCanManageIntegrations(user: AuthUser, action: CrudAction): void {
  assertPagePermission(user, "integrations", action);
  if (!user.permissions?.manage_billing_and_integrations) {
    throw new AppError("FORBIDDEN", { message: "You do not have permission to manage billing and integrations.", expected: true });
  }
}
