import { db } from "..";
import { and, asc, desc, eq, inArray, isNotNull, ne, notInArray, sql } from "drizzle-orm";
import { toAppError } from "../../errors";
import {
  shopifyStores,
  shopifyCustomerLinks,
  shopifyStoreChannels,
  shopifyOrderLinks,
  channels,
  customers,
  users,
  ShopifyStoreStatus,
  ShopifyLinkSource,
  type ShopifyLinkSourceValue,
  type ShopifyStore,
  type NewShopifyStore,
  type ShopifyCustomerLink,
  type ShopifyStoreChannel,
  type ShopifyOrderLink,
} from "../schema";

export type ShopifyStoreWithUser = ShopifyStore & { connectedByName: string | null };
export type ShopifyCustomerLinkWithUser = ShopifyCustomerLink & { linkedByName: string | null };

export type ShopifyStoreChannelRow = ShopifyStoreChannel & {
  channelName: string;
  channelType: string;
  channelStatus: string;
  channelHandle: string | null;
  channelPhoneNumber: string | null;
  storeShopDomain: string;
  storeName: string | null;
  storeStatus: string;
};

export type ShopifyOrderLinkRow = ShopifyOrderLink & {
  linkedByName: string | null;
  channelName: string | null;
  storeShopDomain: string;
  storeName: string | null;
};

const isActiveStore = ne(shopifyStores.status, ShopifyStoreStatus.DISCONNECTED);

const storeChannelColumns = {
  mapping: shopifyStoreChannels,
  channelName: channels.name,
  channelType: channels.type,
  channelStatus: channels.status,
  channelHandle: channels.handle,
  channelPhoneNumber: channels.phoneNumber,
  storeShopDomain: shopifyStores.shopDomain,
  storeName: shopifyStores.name,
  storeStatus: shopifyStores.status,
};

type StoreChannelSelect = {
  mapping: ShopifyStoreChannel;
  channelName: string;
  channelType: string;
  channelStatus: string;
  channelHandle: string | null;
  channelPhoneNumber: string | null;
  storeShopDomain: string;
  storeName: string | null;
  storeStatus: string;
};

const toStoreChannelRow = ({ mapping, ...rest }: StoreChannelSelect): ShopifyStoreChannelRow => ({ ...mapping, ...rest });

type DbOrTx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/** A contact's profile: links are stored on the profile's primary contact */
const profileIdOfCustomer = sql<number>`coalesce(${customers.primaryCustomerId}, ${customers.id})`;

/**
 * Which of a store's links belong to a channel: those of profiles with a contact on the channel, except profiles
 * that also have a contact on another channel connected to the same store (that channel still uses the links).
 */
function channelLinkScope(organizationId: number, storeId: number, channelId: number, conn: DbOrTx = db) {
  return {
    channelProfiles: conn
      .select({ id: profileIdOfCustomer })
      .from(customers)
      .where(and(eq(customers.organizationId, organizationId), eq(customers.channelId, channelId))),
    sharedProfiles: conn
      .select({ id: profileIdOfCustomer })
      .from(customers)
      .innerJoin(
        shopifyStoreChannels,
        and(eq(shopifyStoreChannels.channelId, customers.channelId), eq(shopifyStoreChannels.organizationId, customers.organizationId))
      )
      .where(
        and(
          eq(customers.organizationId, organizationId),
          eq(shopifyStoreChannels.shopifyStoreId, storeId),
          ne(shopifyStoreChannels.channelId, channelId)
        )
      ),
  };
}

export class ShopifyRepository {
  /* ---------------- Stores ---------------- */

  /** The organization's stores that are connected or need re-authorization, oldest connection first */
  async findActiveStores(organizationId: number): Promise<ShopifyStoreWithUser[]> {
    const rows = await db
      .select({ store: shopifyStores, connectedByName: users.name })
      .from(shopifyStores)
      .leftJoin(users, eq(users.id, shopifyStores.connectedById))
      .where(and(eq(shopifyStores.organizationId, organizationId), isActiveStore))
      .orderBy(asc(shopifyStores.connectedAt), asc(shopifyStores.id));

    return rows.map((row) => ({ ...row.store, connectedByName: row.connectedByName }));
  }

  /** One active store of the organization. There is no default store: a channel only uses the store it's mapped to. */
  async findActiveStore(organizationId: number, storeId: number): Promise<ShopifyStoreWithUser | null> {
    const stores = await this.findActiveStores(organizationId);
    return stores.find((store) => store.id === storeId) ?? null;
  }

  async findStoreByDomain(organizationId: number, shopDomain: string): Promise<ShopifyStore | null> {
    const [store] = await db
      .select()
      .from(shopifyStores)
      .where(and(eq(shopifyStores.organizationId, organizationId), eq(shopifyStores.shopDomain, shopDomain)))
      .limit(1);

    return store || null;
  }

  /**
   * Connections of this shop that are still live (connected or needing re-authorization) in any workspace.
   * A shop is connected to one workspace at a time: disconnecting revokes the app's access for the whole shop.
   */
  async findActiveStoresByDomain(shopDomain: string): Promise<ShopifyStore[]> {
    return await db
      .select()
      .from(shopifyStores)
      .where(and(eq(shopifyStores.shopDomain, shopDomain), isActiveStore));
  }

  /** Creates the connection, or reactivates the organization's earlier row for the same shop */
  async upsertStore(data: NewShopifyStore & { organizationId: number; shopDomain: string }): Promise<ShopifyStore> {
    const now = new Date();
    const [store] = await db
      .insert(shopifyStores)
      .values({ ...data, isDefault: false, connectedAt: now, updatedAt: now })
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

  /** Disconnects a store: clears its tokens (and the unused legacy default flag). Its channel mappings and links are kept for a reconnect. */
  async markStoreDisconnected(id: number, organizationId: number): Promise<ShopifyStore | null> {
    const [updated] = await db
      .update(shopifyStores)
      .set({
        status: ShopifyStoreStatus.DISCONNECTED,
        isDefault: false,
        accessToken: null,
        refreshToken: null,
        tokenExpiresAt: null,
        lastError: null,
        updatedAt: new Date(),
      })
      .where(and(eq(shopifyStores.id, id), eq(shopifyStores.organizationId, organizationId)))
      .returning();

    return updated || null;
  }

  /* ---------------- Store ↔ channel mappings ---------------- */

  /** Mappings of the workspace, optionally of one store or one channel, with channel and store details */
  async listChannelMappings(organizationId: number, filter: { storeId?: number; channelId?: number } = {}): Promise<ShopifyStoreChannelRow[]> {
    const rows = await db
      .select(storeChannelColumns)
      .from(shopifyStoreChannels)
      .innerJoin(channels, and(eq(channels.id, shopifyStoreChannels.channelId), eq(channels.organizationId, shopifyStoreChannels.organizationId)))
      .innerJoin(
        shopifyStores,
        and(eq(shopifyStores.id, shopifyStoreChannels.shopifyStoreId), eq(shopifyStores.organizationId, shopifyStoreChannels.organizationId))
      )
      .where(
        and(
          eq(shopifyStoreChannels.organizationId, organizationId),
          filter.storeId !== undefined ? eq(shopifyStoreChannels.shopifyStoreId, filter.storeId) : undefined,
          filter.channelId !== undefined ? eq(shopifyStoreChannels.channelId, filter.channelId) : undefined
        )
      )
      .orderBy(asc(shopifyStoreChannels.shopifyStoreId), asc(channels.name), asc(shopifyStoreChannels.id));

    return rows.map(toStoreChannelRow);
  }

  async findChannelMapping(organizationId: number, mappingId: number): Promise<ShopifyStoreChannelRow | null> {
    const [row] = await db
      .select(storeChannelColumns)
      .from(shopifyStoreChannels)
      .innerJoin(channels, and(eq(channels.id, shopifyStoreChannels.channelId), eq(channels.organizationId, shopifyStoreChannels.organizationId)))
      .innerJoin(
        shopifyStores,
        and(eq(shopifyStores.id, shopifyStoreChannels.shopifyStoreId), eq(shopifyStores.organizationId, shopifyStoreChannels.organizationId))
      )
      .where(and(eq(shopifyStoreChannels.id, mappingId), eq(shopifyStoreChannels.organizationId, organizationId)))
      .limit(1);

    return row ? toStoreChannelRow(row) : null;
  }

  /** The store a channel is mapped to (whatever its status), or null when the channel isn't mapped */
  async findStoreForChannel(organizationId: number, channelId: number): Promise<ShopifyStoreWithUser | null> {
    const [row] = await db
      .select({ store: shopifyStores, connectedByName: users.name })
      .from(shopifyStoreChannels)
      .innerJoin(
        shopifyStores,
        and(eq(shopifyStores.id, shopifyStoreChannels.shopifyStoreId), eq(shopifyStores.organizationId, shopifyStoreChannels.organizationId))
      )
      .leftJoin(users, eq(users.id, shopifyStores.connectedById))
      .where(and(eq(shopifyStoreChannels.organizationId, organizationId), eq(shopifyStoreChannels.channelId, channelId)))
      .limit(1);

    return row ? { ...row.store, connectedByName: row.connectedByName } : null;
  }

  /**
   * Connects a channel to a store. Fails with a unique violation (23505) when the channel is already connected
   * to a store: a channel belongs to one store, and has to be disconnected (deleteChannelMapping) before it can
   * be connected to another. Rows are never re-pointed at another store.
   */
  async createChannelMapping(data: { organizationId: number; storeId: number; channelId: number; userId: number }): Promise<ShopifyStoreChannel> {
    const [created] = await db
      .insert(shopifyStoreChannels)
      .values({
        organizationId: data.organizationId,
        shopifyStoreId: data.storeId,
        channelId: data.channelId,
        createdById: data.userId,
        updatedById: data.userId,
      })
      .returning();

    return created;
  }

  /**
   * Disconnects a channel from its store and, in the same transaction, removes the store's links that belong to
   * the channel's contacts (see channelLinkScope): their contact ↔ Shopify customer links (including "unlinked by
   * an agent" markers) and their order links.
   */
  async deleteChannelMapping(
    organizationId: number,
    mappingId: number
  ): Promise<{ mapping: ShopifyStoreChannel; removedContactLinks: number; removedOrderLinks: number } | null> {
    return db.transaction(async (tx) => {
      const [deleted] = await tx
        .delete(shopifyStoreChannels)
        .where(and(eq(shopifyStoreChannels.id, mappingId), eq(shopifyStoreChannels.organizationId, organizationId)))
        .returning();
      if (!deleted) return null;

      const scope = channelLinkScope(organizationId, deleted.shopifyStoreId, deleted.channelId, tx);
      const contactLinks = await tx
        .delete(shopifyCustomerLinks)
        .where(
          and(
            eq(shopifyCustomerLinks.organizationId, organizationId),
            eq(shopifyCustomerLinks.shopifyStoreId, deleted.shopifyStoreId),
            inArray(shopifyCustomerLinks.customerId, scope.channelProfiles),
            notInArray(shopifyCustomerLinks.customerId, scope.sharedProfiles)
          )
        )
        .returning({ id: shopifyCustomerLinks.id, shopifyCustomerId: shopifyCustomerLinks.shopifyCustomerId });
      const orderLinks = await tx
        .delete(shopifyOrderLinks)
        .where(
          and(
            eq(shopifyOrderLinks.organizationId, organizationId),
            eq(shopifyOrderLinks.shopifyStoreId, deleted.shopifyStoreId),
            inArray(shopifyOrderLinks.customerId, scope.channelProfiles),
            notInArray(shopifyOrderLinks.customerId, scope.sharedProfiles)
          )
        )
        .returning({ id: shopifyOrderLinks.id });

      return {
        mapping: deleted,
        // "Unlinked by an agent" markers are cleaned up too, but they aren't links
        removedContactLinks: contactLinks.filter((l) => l.shopifyCustomerId !== null).length,
        removedOrderLinks: orderLinks.length,
      };
    });
  }

  /** What deleteChannelMapping would remove for this channel and store (nothing is changed) */
  async countChannelLinks(
    organizationId: number,
    storeId: number,
    channelId: number
  ): Promise<{ linkedContacts: number; manuallyLinkedContacts: number; linkedOrders: number }> {
    const scope = channelLinkScope(organizationId, storeId, channelId);
    const [[contacts], [orders]] = await Promise.all([
      db
        .select({
          linked: sql<number>`count(*)::int`,
          manual: sql<number>`count(*) filter (where ${shopifyCustomerLinks.source} <> ${ShopifyLinkSource.AUTO})::int`,
        })
        .from(shopifyCustomerLinks)
        .where(
          and(
            eq(shopifyCustomerLinks.organizationId, organizationId),
            eq(shopifyCustomerLinks.shopifyStoreId, storeId),
            isNotNull(shopifyCustomerLinks.shopifyCustomerId),
            inArray(shopifyCustomerLinks.customerId, scope.channelProfiles),
            notInArray(shopifyCustomerLinks.customerId, scope.sharedProfiles)
          )
        ),
      db
        .select({ linked: sql<number>`count(*)::int` })
        .from(shopifyOrderLinks)
        .where(
          and(
            eq(shopifyOrderLinks.organizationId, organizationId),
            eq(shopifyOrderLinks.shopifyStoreId, storeId),
            inArray(shopifyOrderLinks.customerId, scope.channelProfiles),
            notInArray(shopifyOrderLinks.customerId, scope.sharedProfiles)
          )
        ),
    ]);

    return { linkedContacts: contacts?.linked ?? 0, manuallyLinkedContacts: contacts?.manual ?? 0, linkedOrders: orders?.linked ?? 0 };
  }

  /* ---------------- Contact ↔ Shopify customer links ---------------- */

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

  /** The contacts (profiles) these Shopify customers of the store are linked to */
  async findLinkedContacts(
    organizationId: number,
    storeId: number,
    shopifyCustomerIds: string[]
  ): Promise<{ shopifyCustomerId: string; customerId: number; customerName: string }[]> {
    if (shopifyCustomerIds.length === 0) return [];
    const rows = await db
      .select({ shopifyCustomerId: shopifyCustomerLinks.shopifyCustomerId, customerId: customers.id, customerName: customers.name })
      .from(shopifyCustomerLinks)
      .innerJoin(customers, and(eq(customers.id, shopifyCustomerLinks.customerId), eq(customers.organizationId, shopifyCustomerLinks.organizationId)))
      .where(
        and(
          eq(shopifyCustomerLinks.organizationId, organizationId),
          eq(shopifyCustomerLinks.shopifyStoreId, storeId),
          inArray(shopifyCustomerLinks.shopifyCustomerId, shopifyCustomerIds)
        )
      );

    return rows.filter((r): r is { shopifyCustomerId: string; customerId: number; customerName: string } => r.shopifyCustomerId !== null);
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

  /**
   * Links the contact profile (its primary contact id). A manual link replaces any earlier link or "unlinked"
   * marker of the profile in this store; an automatic one is only added when the profile has no row yet.
   */
  async upsertLink(data: {
    organizationId: number;
    storeId: number;
    customerId: number;
    shopifyCustomerId: string;
    linkedById: number | null;
    source: ShopifyLinkSourceValue;
  }): Promise<ShopifyCustomerLink | null> {
    const now = new Date();
    const insert = db.insert(shopifyCustomerLinks).values({
      organizationId: data.organizationId,
      shopifyStoreId: data.storeId,
      customerId: data.customerId,
      shopifyCustomerId: data.shopifyCustomerId,
      linkedById: data.linkedById,
      source: data.source,
    });

    const [link] =
      data.source === ShopifyLinkSource.AUTO
        ? await insert.onConflictDoNothing({ target: [shopifyCustomerLinks.shopifyStoreId, shopifyCustomerLinks.customerId] }).returning()
        : await insert
            .onConflictDoUpdate({
              target: [shopifyCustomerLinks.shopifyStoreId, shopifyCustomerLinks.customerId],
              set: {
                shopifyCustomerId: data.shopifyCustomerId,
                linkedById: data.linkedById,
                source: data.source,
                createdAt: now,
                updatedAt: now,
              },
              // The conflicting row has the same store, so the same workspace; checked anyway
              setWhere: eq(shopifyCustomerLinks.organizationId, data.organizationId),
            })
            .returning();

    return link ?? null;
  }

  /** Clears the profile's link but keeps the row, so automatic matching doesn't link it again */
  async markUnlinked(organizationId: number, storeId: number, customerId: number, unlinkedById: number): Promise<boolean> {
    const updated = await db
      .update(shopifyCustomerLinks)
      .set({ shopifyCustomerId: null, source: ShopifyLinkSource.MANUAL, linkedById: unlinkedById, updatedAt: new Date() })
      .where(
        and(
          eq(shopifyCustomerLinks.organizationId, organizationId),
          eq(shopifyCustomerLinks.shopifyStoreId, storeId),
          eq(shopifyCustomerLinks.customerId, customerId),
          isNotNull(shopifyCustomerLinks.shopifyCustomerId)
        )
      )
      .returning({ id: shopifyCustomerLinks.id });

    return updated.length > 0;
  }

  /* ---------------- Contact ↔ order links ---------------- */

  /** Orders associated with a contact profile, newest first; optionally of one store */
  async listOrderLinks(organizationId: number, customerId: number, storeId?: number): Promise<ShopifyOrderLinkRow[]> {
    const rows = await db
      .select({
        link: shopifyOrderLinks,
        linkedByName: users.name,
        channelName: channels.name,
        storeShopDomain: shopifyStores.shopDomain,
        storeName: shopifyStores.name,
      })
      .from(shopifyOrderLinks)
      .innerJoin(
        shopifyStores,
        and(eq(shopifyStores.id, shopifyOrderLinks.shopifyStoreId), eq(shopifyStores.organizationId, shopifyOrderLinks.organizationId))
      )
      .leftJoin(users, eq(users.id, shopifyOrderLinks.linkedById))
      .leftJoin(channels, and(eq(channels.id, shopifyOrderLinks.channelId), eq(channels.organizationId, shopifyOrderLinks.organizationId)))
      .where(
        and(
          eq(shopifyOrderLinks.organizationId, organizationId),
          eq(shopifyOrderLinks.customerId, customerId),
          storeId !== undefined ? eq(shopifyOrderLinks.shopifyStoreId, storeId) : undefined
        )
      )
      .orderBy(desc(shopifyOrderLinks.createdAt), desc(shopifyOrderLinks.id));

    return rows.map(({ link, ...rest }) => ({ ...link, ...rest }));
  }

  async findOrderLinkByOrder(organizationId: number, storeId: number, shopifyOrderId: string): Promise<ShopifyOrderLink | null> {
    const [link] = await db
      .select()
      .from(shopifyOrderLinks)
      .where(
        and(
          eq(shopifyOrderLinks.organizationId, organizationId),
          eq(shopifyOrderLinks.shopifyStoreId, storeId),
          eq(shopifyOrderLinks.shopifyOrderId, shopifyOrderId)
        )
      )
      .limit(1);

    return link || null;
  }

  /** Associates an order with a profile. Fails with a unique violation (23505) when the order is already associated. */
  async createOrderLink(data: {
    organizationId: number;
    storeId: number;
    customerId: number;
    channelId: number | null;
    shopifyOrderId: string;
    orderName: string | null;
    linkedById: number | null;
    source: ShopifyLinkSourceValue;
  }): Promise<ShopifyOrderLink> {
    const [created] = await db
      .insert(shopifyOrderLinks)
      .values({
        organizationId: data.organizationId,
        shopifyStoreId: data.storeId,
        customerId: data.customerId,
        channelId: data.channelId,
        shopifyOrderId: data.shopifyOrderId,
        orderName: data.orderName,
        linkedById: data.linkedById,
        source: data.source,
      })
      .returning();

    return created;
  }

  async deleteOrderLink(organizationId: number, customerId: number, linkId: number): Promise<ShopifyOrderLink | null> {
    const [deleted] = await db
      .delete(shopifyOrderLinks)
      .where(
        and(eq(shopifyOrderLinks.id, linkId), eq(shopifyOrderLinks.organizationId, organizationId), eq(shopifyOrderLinks.customerId, customerId))
      )
      .returning();

    return deleted || null;
  }
}

export const shopifyRepository = new ShopifyRepository();
