import { db } from "..";
import { and, asc, eq, ne } from "drizzle-orm";
import {
  commerceStores,
  commerceStoreChannels,
  channels,
  users,
  CommerceStoreStatus,
  type CommercePlatformValue,
  type CommerceStore,
  type CommerceStoreChannel,
  type CommerceStoreSettings,
  type NewCommerceStore,
} from "../schema";

export type CommerceStoreWithUser = CommerceStore & { connectedByName: string | null };

export type CommerceStoreChannelRow = CommerceStoreChannel & {
  channelName: string;
  channelType: string;
  channelStatus: string;
  channelHandle: string | null;
  channelPhoneNumber: string | null;
  storePlatform: string;
  storeHost: string;
  storeName: string | null;
  storeStatus: string;
};

const isActiveStore = ne(commerceStores.status, CommerceStoreStatus.DISCONNECTED);

const storeChannelColumns = {
  mapping: commerceStoreChannels,
  channelName: channels.name,
  channelType: channels.type,
  channelStatus: channels.status,
  channelHandle: channels.handle,
  channelPhoneNumber: channels.phoneNumber,
  storePlatform: commerceStores.platform,
  storeHost: commerceStores.storeHost,
  storeName: commerceStores.name,
  storeStatus: commerceStores.status,
};

type StoreChannelSelect = { mapping: CommerceStoreChannel } & Omit<CommerceStoreChannelRow, keyof CommerceStoreChannel>;

const toStoreChannelRow = ({ mapping, ...rest }: StoreChannelSelect): CommerceStoreChannelRow => ({ ...mapping, ...rest });

/**
 * Store connections of every commerce platform kept in commerce_stores (WooCommerce today). Every query is scoped
 * by organization_id; the composite foreign keys reject cross-workspace rows on top of that.
 */
export class CommerceRepository {
  /* ---------------- Stores ---------------- */

  /** Stores that are connected or need re-authorization, oldest connection first */
  async findActiveStores(organizationId: number, platform?: CommercePlatformValue): Promise<CommerceStoreWithUser[]> {
    const rows = await db
      .select({ store: commerceStores, connectedByName: users.name })
      .from(commerceStores)
      .leftJoin(users, eq(users.id, commerceStores.connectedById))
      .where(
        and(
          eq(commerceStores.organizationId, organizationId),
          isActiveStore,
          platform ? eq(commerceStores.platform, platform) : undefined
        )
      )
      .orderBy(asc(commerceStores.connectedAt), asc(commerceStores.id));

    return rows.map((row) => ({ ...row.store, connectedByName: row.connectedByName }));
  }

  async findActiveStore(organizationId: number, storeId: number, platform?: CommercePlatformValue): Promise<CommerceStoreWithUser | null> {
    const [row] = await db
      .select({ store: commerceStores, connectedByName: users.name })
      .from(commerceStores)
      .leftJoin(users, eq(users.id, commerceStores.connectedById))
      .where(
        and(
          eq(commerceStores.organizationId, organizationId),
          eq(commerceStores.id, storeId),
          isActiveStore,
          platform ? eq(commerceStores.platform, platform) : undefined
        )
      )
      .limit(1);

    return row ? { ...row.store, connectedByName: row.connectedByName } : null;
  }

  /** The workspace's row for this store whatever its status (a disconnected row is reused on reconnect) */
  async findStoreByHost(organizationId: number, platform: CommercePlatformValue, storeHost: string): Promise<CommerceStore | null> {
    const [store] = await db
      .select()
      .from(commerceStores)
      .where(
        and(eq(commerceStores.organizationId, organizationId), eq(commerceStores.platform, platform), eq(commerceStores.storeHost, storeHost))
      )
      .limit(1);
    return store ?? null;
  }

  /** Creates the connection, or reactivates the workspace's earlier row for the same store */
  async upsertStore(
    data: Omit<NewCommerceStore, "id" | "createdAt" | "updatedAt" | "connectedAt" | "status"> & {
      organizationId: number;
      platform: CommercePlatformValue;
      storeUrl: string;
      storeHost: string;
    }
  ): Promise<CommerceStore> {
    const now = new Date();
    const [store] = await db
      .insert(commerceStores)
      .values({ ...data, status: CommerceStoreStatus.CONNECTED, connectedAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: [commerceStores.organizationId, commerceStores.platform, commerceStores.storeHost],
        set: {
          storeUrl: data.storeUrl,
          credentials: data.credentials,
          settings: data.settings,
          scopes: data.scopes,
          status: CommerceStoreStatus.CONNECTED,
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
    data: Partial<
      Pick<
        CommerceStore,
        "name" | "email" | "currencyCode" | "externalId" | "status" | "lastError" | "credentials" | "settings" | "lastVerifiedAt" | "storeUrl"
      >
    >
  ): Promise<CommerceStore | null> {
    const [updated] = await db
      .update(commerceStores)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(commerceStores.id, id), eq(commerceStores.organizationId, organizationId)))
      .returning();
    return updated ?? null;
  }

  /** Merges keys into settings without overwriting the others */
  async mergeSettings(store: Pick<CommerceStore, "id" | "organizationId" | "settings">, patch: CommerceStoreSettings) {
    return this.updateStore(store.id, store.organizationId, { settings: { ...(store.settings ?? {}), ...patch } });
  }

  /** Clears the credentials; channel mappings are kept so reconnecting the same store restores them */
  async markStoreDisconnected(id: number, organizationId: number): Promise<CommerceStore | null> {
    return this.updateStore(id, organizationId, { status: CommerceStoreStatus.DISCONNECTED, credentials: null, lastError: null });
  }

  /* ---------------- Store ↔ channel mappings ---------------- */

  async listChannelMappings(
    organizationId: number,
    filter: { storeId?: number; channelId?: number; platform?: CommercePlatformValue } = {}
  ): Promise<CommerceStoreChannelRow[]> {
    const rows = await db
      .select(storeChannelColumns)
      .from(commerceStoreChannels)
      .innerJoin(channels, and(eq(channels.id, commerceStoreChannels.channelId), eq(channels.organizationId, commerceStoreChannels.organizationId)))
      .innerJoin(
        commerceStores,
        and(eq(commerceStores.id, commerceStoreChannels.storeId), eq(commerceStores.organizationId, commerceStoreChannels.organizationId))
      )
      .where(
        and(
          eq(commerceStoreChannels.organizationId, organizationId),
          filter.storeId !== undefined ? eq(commerceStoreChannels.storeId, filter.storeId) : undefined,
          filter.channelId !== undefined ? eq(commerceStoreChannels.channelId, filter.channelId) : undefined,
          filter.platform ? eq(commerceStores.platform, filter.platform) : undefined
        )
      )
      .orderBy(asc(commerceStoreChannels.storeId), asc(channels.name), asc(commerceStoreChannels.id));

    return rows.map(toStoreChannelRow);
  }

  async findChannelMapping(organizationId: number, mappingId: number): Promise<CommerceStoreChannelRow | null> {
    const [row] = await db
      .select(storeChannelColumns)
      .from(commerceStoreChannels)
      .innerJoin(channels, and(eq(channels.id, commerceStoreChannels.channelId), eq(channels.organizationId, commerceStoreChannels.organizationId)))
      .innerJoin(
        commerceStores,
        and(eq(commerceStores.id, commerceStoreChannels.storeId), eq(commerceStores.organizationId, commerceStoreChannels.organizationId))
      )
      .where(and(eq(commerceStoreChannels.id, mappingId), eq(commerceStoreChannels.organizationId, organizationId)))
      .limit(1);
    return row ? toStoreChannelRow(row) : null;
  }

  /** The stores of one platform a channel is mapped to (whatever their status), oldest connection first */
  async findStoresForChannel(organizationId: number, channelId: number, platform: CommercePlatformValue): Promise<CommerceStoreWithUser[]> {
    const rows = await db
      .select({ store: commerceStores, connectedByName: users.name })
      .from(commerceStoreChannels)
      .innerJoin(
        commerceStores,
        and(eq(commerceStores.id, commerceStoreChannels.storeId), eq(commerceStores.organizationId, commerceStoreChannels.organizationId))
      )
      .leftJoin(users, eq(users.id, commerceStores.connectedById))
      .where(
        and(
          eq(commerceStoreChannels.organizationId, organizationId),
          eq(commerceStoreChannels.channelId, channelId),
          eq(commerceStores.platform, platform)
        )
      )
      .orderBy(asc(commerceStoreChannels.id));
    return rows.map((row) => ({ ...row.store, connectedByName: row.connectedByName }));
  }

  /** A channel can use many stores; fails with a unique violation (23505) when it's already connected to this one */
  async createChannelMapping(data: { organizationId: number; storeId: number; channelId: number; userId: number }): Promise<CommerceStoreChannel> {
    const [created] = await db
      .insert(commerceStoreChannels)
      .values({
        organizationId: data.organizationId,
        storeId: data.storeId,
        channelId: data.channelId,
        createdById: data.userId,
        updatedById: data.userId,
      })
      .returning();
    return created;
  }

  async deleteChannelMapping(organizationId: number, mappingId: number): Promise<CommerceStoreChannel | null> {
    const [deleted] = await db
      .delete(commerceStoreChannels)
      .where(and(eq(commerceStoreChannels.id, mappingId), eq(commerceStoreChannels.organizationId, organizationId)))
      .returning();
    return deleted ?? null;
  }
}

export const commerceRepository = new CommerceRepository();
