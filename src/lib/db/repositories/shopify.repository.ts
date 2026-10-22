import { db } from "..";
import { and, asc, eq, ne } from "drizzle-orm";
import {
  shopifyStores,
  shopifyCustomerLinks,
  users,
  ShopifyStoreStatus,
  type ShopifyStore,
  type NewShopifyStore,
  type ShopifyCustomerLink,
} from "../schema";

export type ShopifyStoreWithUser = ShopifyStore & { connectedByName: string | null };
export type ShopifyCustomerLinkWithUser = ShopifyCustomerLink & { linkedByName: string | null };

/** The store the inbox uses: the oldest working connection, else the oldest one needing re-authorization */
export function pickPrimaryStore<T extends ShopifyStore>(stores: T[]): T | null {
  return stores.find((store) => store.status === ShopifyStoreStatus.CONNECTED) ?? stores[0] ?? null;
}

export class ShopifyRepository {
  /** The organization's stores that are connected or need re-authorization, oldest connection first */
  async findActiveStores(organizationId: number): Promise<ShopifyStoreWithUser[]> {
    const rows = await db
      .select({ store: shopifyStores, connectedByName: users.name })
      .from(shopifyStores)
      .leftJoin(users, eq(users.id, shopifyStores.connectedById))
      .where(and(eq(shopifyStores.organizationId, organizationId), ne(shopifyStores.status, ShopifyStoreStatus.DISCONNECTED)))
      .orderBy(asc(shopifyStores.connectedAt), asc(shopifyStores.id));

    return rows.map((row) => ({ ...row.store, connectedByName: row.connectedByName }));
  }

  /** One active store: the given one, or else the primary store (pickPrimaryStore) */
  async findActiveStore(organizationId: number, storeId?: number): Promise<ShopifyStoreWithUser | null> {
    const stores = await this.findActiveStores(organizationId);
    if (storeId !== undefined) return stores.find((store) => store.id === storeId) ?? null;
    return pickPrimaryStore(stores);
  }

  async findStoreByDomain(organizationId: number, shopDomain: string): Promise<ShopifyStore | null> {
    const [store] = await db
      .select()
      .from(shopifyStores)
      .where(and(eq(shopifyStores.organizationId, organizationId), eq(shopifyStores.shopDomain, shopDomain)))
      .limit(1);

    return store || null;
  }

  /** Creates the connection, or reactivates the organization's earlier row for the same shop */
  async upsertStore(data: NewShopifyStore & { organizationId: number; shopDomain: string }): Promise<ShopifyStore> {
    const now = new Date();
    const [store] = await db
      .insert(shopifyStores)
      .values({ ...data, connectedAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: [shopifyStores.organizationId, shopifyStores.shopDomain],
        set: {
          shopifyShopId: data.shopifyShopId,
          name: data.name,
          email: data.email,
          currencyCode: data.currencyCode,
          primaryDomainUrl: data.primaryDomainUrl,
          accessToken: data.accessToken,
          refreshToken: data.refreshToken ?? null,
          tokenExpiresAt: data.tokenExpiresAt ?? null,
          scopes: data.scopes,
          status: ShopifyStoreStatus.CONNECTED,
          lastError: null,
          connectedById: data.connectedById,
          connectedAt: now,
          updatedAt: now,
        },
      })
      .returning();

    return store;
  }

  async updateStore(
    id: number,
    organizationId: number,
    data: Partial<Pick<ShopifyStore, "status" | "lastError" | "accessToken" | "refreshToken" | "tokenExpiresAt">>
  ): Promise<ShopifyStore | null> {
    const [updated] = await db
      .update(shopifyStores)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(shopifyStores.id, id), eq(shopifyStores.organizationId, organizationId)))
      .returning();

    return updated || null;
  }

  async findLink(organizationId: number, storeId: number, customerId: number): Promise<ShopifyCustomerLinkWithUser | null> {
    const [row] = await db
      .select({ link: shopifyCustomerLinks, linkedByName: users.name })
      .from(shopifyCustomerLinks)
      .leftJoin(users, eq(users.id, shopifyCustomerLinks.linkedById))
      .where(
        and(
          eq(shopifyCustomerLinks.organizationId, organizationId),
          eq(shopifyCustomerLinks.shopifyStoreId, storeId),
          eq(shopifyCustomerLinks.customerId, customerId)
        )
      )
      .limit(1);

    return row ? { ...row.link, linkedByName: row.linkedByName } : null;
  }

  async findLinkByShopifyCustomer(organizationId: number, storeId: number, shopifyCustomerId: string): Promise<ShopifyCustomerLink | null> {
    const [link] = await db
      .select()
      .from(shopifyCustomerLinks)
      .where(
        and(
          eq(shopifyCustomerLinks.organizationId, organizationId),
          eq(shopifyCustomerLinks.shopifyStoreId, storeId),
          eq(shopifyCustomerLinks.shopifyCustomerId, shopifyCustomerId)
        )
      )
      .limit(1);

    return link || null;
  }

  /** Links the contact, replacing any earlier link of the same contact in this store */
  async upsertLink(data: {
    organizationId: number;
    storeId: number;
    customerId: number;
    shopifyCustomerId: string;
    linkedById: number;
  }): Promise<ShopifyCustomerLink> {
    const now = new Date();
    const [link] = await db
      .insert(shopifyCustomerLinks)
      .values({
        organizationId: data.organizationId,
        shopifyStoreId: data.storeId,
        customerId: data.customerId,
        shopifyCustomerId: data.shopifyCustomerId,
        linkedById: data.linkedById,
      })
      .onConflictDoUpdate({
        target: [shopifyCustomerLinks.shopifyStoreId, shopifyCustomerLinks.customerId],
        set: { shopifyCustomerId: data.shopifyCustomerId, linkedById: data.linkedById, createdAt: now, updatedAt: now },
      })
      .returning();

    return link;
  }

  async deleteLink(organizationId: number, storeId: number, customerId: number): Promise<boolean> {
    const deleted = await db
      .delete(shopifyCustomerLinks)
      .where(
        and(
          eq(shopifyCustomerLinks.organizationId, organizationId),
          eq(shopifyCustomerLinks.shopifyStoreId, storeId),
          eq(shopifyCustomerLinks.customerId, customerId)
        )
      )
      .returning({ id: shopifyCustomerLinks.id });

    return deleted.length > 0;
  }
}

export const shopifyRepository = new ShopifyRepository();
