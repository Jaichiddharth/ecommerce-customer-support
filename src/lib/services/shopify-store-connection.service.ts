import { shopifyRepository, type ShopifyStoreChannelRow, type ShopifyStoreWithUser } from "../db/repositories/shopify.repository";
import { channelRepository } from "../db/repositories/channel.repository";
import { ChannelStatus, ShopifyStoreStatus } from "../db/schema";
import { AppError, toAppError } from "../errors";
import { createLogger } from "../logger";
import type { AuthUser } from "../security/auth";
import { assertCanAccessStore, canAccessStore } from "../security/store-access";
import { toChannelMapping, toStoreInfo } from "../shopify/mappers";
import type {
  ShopifyChannelMapping,
  ShopifyChannelStore,
  ShopifyChannelStoreStatus,
  ShopifyChannelUnmapImpact,
  ShopifyStoreWithChannels,
} from "../shopify/types";
import { customerService } from "./customer.service";

const log = createLogger("ShopifyStoreConnections");

/**
 * What a Shopify call is about. The store is picked from the most specific of these:
 * storeId (explicit) → the store mapped to channelId → the store mapped to the contact's channel.
 * There is no default store: a channel (WhatsApp number) that isn't connected to a store has no store.
 */
export interface StoreScope {
  storeId?: number;
  channelId?: number;
  customerId?: number;
}

export interface ResolvedStore {
  store: ShopifyStoreWithUser;
  via: "explicit" | "mapping";
}

/**
 * Store connections of a workspace: which store each channel uses, and the resolution every Shopify call goes
 * through. Isolation rules enforced here:
 *  - a store, channel or mapping is only ever looked up together with the caller's organization id;
 *  - a channel mapped to a store only ever uses that store: an explicit other store is rejected
 *    (SHOPIFY_STORE_CHANNEL_MISMATCH), and a channel that isn't mapped (or whose store is disconnected) has none;
 *  - members limited to some stores (users.stores) can't use the others (SHOPIFY_STORE_ACCESS_DENIED).
 */
export class ShopifyStoreConnectionService {
  /* ---------------- Resolution ---------------- */

  /** The store for this scope, or null when there is none (the channel isn't connected to a store, or it's disconnected) */
  async resolveStore(user: AuthUser, scope: StoreScope = {}): Promise<ResolvedStore | null> {
    const organizationId = user.organizationId;

    let channelId = scope.channelId;
    if (channelId === undefined && scope.customerId !== undefined) {
      const contact = await customerService.requireVisible(scope.customerId, organizationId);
      channelId = contact.channelId ?? undefined;
    }

    const mapped = channelId !== undefined ? await shopifyRepository.findStoreForChannel(organizationId, channelId) : null;

    if (scope.storeId !== undefined) {
      const store = await shopifyRepository.findActiveStore(organizationId, scope.storeId);
      if (!store) throw new AppError("SHOPIFY_STORE_NOT_FOUND", { details: { storeId: scope.storeId }, expected: true });
      if (mapped && mapped.id !== store.id) {
        throw new AppError("SHOPIFY_STORE_CHANNEL_MISMATCH", {
          details: { channelId, storeId: store.id, mappedStoreId: mapped.id },
          expected: true,
        });
      }
      assertCanAccessStore(user, store);
      return { store, via: "explicit" };
    }

    if (!mapped || mapped.status === ShopifyStoreStatus.DISCONNECTED) return null;
    assertCanAccessStore(user, mapped);
    return { store: mapped, via: "mapping" };
  }

  /**
   * The store a channel (WhatsApp number) is connected to, for the inbox: null when the number isn't connected to a
   * store, the store is disconnected, or the member can't use that store. `hasStores` tells the inbox whether to
   * offer "Connect a store" (the workspace has none) or "Associate a store" with this number. Never includes tokens.
   */
  async getChannelStore(user: AuthUser, channelId: number): Promise<{ store: ShopifyChannelStore | null; hasStores: boolean }> {
    const [mapped, stores] = await Promise.all([
      shopifyRepository.findStoreForChannel(user.organizationId, channelId),
      shopifyRepository.findActiveStores(user.organizationId),
    ]);
    const hasStores = stores.some((s) => canAccessStore(user, s));
    if (!mapped || mapped.status === ShopifyStoreStatus.DISCONNECTED || !canAccessStore(user, mapped)) return { store: null, hasStores };
    return {
      store: {
        id: mapped.id,
        name: mapped.name,
        shopDomain: mapped.shopDomain,
        status: mapped.status as ShopifyChannelStore["status"],
        currencyCode: mapped.currencyCode,
      },
      hasStores: true,
    };
  }

  /* ---------------- Stores ---------------- */

  /** Every active store with the channels mapped to it (managers only; the route checks) */
  async listStores(organizationId: number): Promise<ShopifyStoreWithChannels[]> {
    const [stores, mappings] = await Promise.all([
      shopifyRepository.findActiveStores(organizationId),
      shopifyRepository.listChannelMappings(organizationId),
    ]);
    return stores.map((store) => ({
      ...toStoreInfo(store),
      channels: mappings.filter((m) => m.shopifyStoreId === store.id).map(toChannelMapping),
    }));
  }

  async getStore(organizationId: number, storeId: number): Promise<ShopifyStoreWithChannels> {
    const store = (await this.listStores(organizationId)).find((s) => s.id === storeId);
    if (!store) throw new AppError("SHOPIFY_STORE_NOT_FOUND", { details: { storeId }, expected: true });
    return store;
  }

  /* ---------------- Channel mappings ---------------- */

  /** Mappings (optionally of one store or channel), plus which store every live channel uses right now */
  async getChannelMappings(
    organizationId: number,
    filter: { storeId?: number; channelId?: number } = {}
  ): Promise<{ mappings: ShopifyChannelMapping[]; channels: ShopifyChannelStoreStatus[] }> {
    const [stores, mappings, liveChannels] = await Promise.all([
      shopifyRepository.findActiveStores(organizationId),
      shopifyRepository.listChannelMappings(organizationId),
      channelRepository.listByOrgAndType(organizationId),
    ]);
    const activeStoreIds = new Set(stores.map((s) => s.id));

    const channels: ShopifyChannelStoreStatus[] = liveChannels
      .filter((c) => filter.channelId === undefined || c.id === filter.channelId)
      .map((channel) => {
        const mapping = mappings.find((m) => m.channelId === channel.id);
        const base = { channelId: channel.id, name: channel.name, type: channel.type, status: channel.status, mappingId: mapping?.id ?? null };
        return mapping && activeStoreIds.has(mapping.shopifyStoreId)
          ? { ...base, effectiveStoreId: mapping.shopifyStoreId, via: "mapping" as const }
          : { ...base, effectiveStoreId: null, via: "none" as const };
      })
      .filter((c) => filter.storeId === undefined || c.effectiveStoreId === filter.storeId);

    return {
      mappings: mappings
        .filter((m) => (filter.storeId === undefined || m.shopifyStoreId === filter.storeId) && (filter.channelId === undefined || m.channelId === filter.channelId))
        .map(toChannelMapping),
      channels,
    };
  }

  async getChannelMapping(organizationId: number, mappingId: number): Promise<ShopifyChannelMapping> {
    const row = await shopifyRepository.findChannelMapping(organizationId, mappingId);
    if (!row) throw AppError.notFound("This channel mapping was not found.");
    return toChannelMapping(row);
  }

  /**
   * Connects a channel (number) to a store. A store can have many channels (e.g. one number for sales, another
   * for service), but a channel belongs to exactly one store. A channel already connected to another store is
   * rejected with SHOPIFY_CHANNEL_ALREADY_MAPPED: it has to be disconnected from that store first
   * (deleteChannelMapping). There is deliberately no way to move it in one step. Connecting it to the store
   * it already uses returns that connection.
   */
  async createChannelMapping(
    user: AuthUser,
    params: { storeId: number; channelId: number }
  ): Promise<{ mapping: ShopifyChannelMapping; created: boolean }> {
    const organizationId = user.organizationId;
    await this.requireMappableStore(organizationId, params.storeId);
    const channel = await this.requireMappableChannel(organizationId, params.channelId);

    const [existing] = await shopifyRepository.listChannelMappings(organizationId, { channelId: params.channelId });
    if (existing) {
      if (existing.shopifyStoreId === params.storeId) return { mapping: toChannelMapping(existing), created: false };
      throw this.alreadyMappedError(channel.name, existing);
    }

    let createdId: number;
    try {
      createdId = (await shopifyRepository.createChannelMapping({ organizationId, storeId: params.storeId, channelId: params.channelId, userId: user.id })).id;
    } catch (err) {
      const appError = toAppError(err);
      // Another request connected the channel at the same moment (uq_shopify_store_channels_channel)
      if (appError.code === "DB_CONSTRAINT_VIOLATION") {
        const [winner] = await shopifyRepository.listChannelMappings(organizationId, { channelId: params.channelId });
        if (winner?.shopifyStoreId === params.storeId) return { mapping: toChannelMapping(winner), created: false };
        if (winner) throw this.alreadyMappedError(channel.name, winner);
      }
      throw appError;
    }

    log.info("Channel mapped to Shopify store", { organizationId, mappingId: createdId, channelId: params.channelId, storeId: params.storeId, userId: user.id });
    return { mapping: await this.getChannelMapping(organizationId, createdId), created: true };
  }

  /** What disconnecting the channel from its store would remove; shown before the agent confirms */
  async getChannelUnmapImpact(organizationId: number, mappingId: number): Promise<ShopifyChannelUnmapImpact> {
    const mapping = await shopifyRepository.findChannelMapping(organizationId, mappingId);
    if (!mapping) throw AppError.notFound("This channel mapping was not found.");
    const counts = await shopifyRepository.countChannelLinks(organizationId, mapping.shopifyStoreId, mapping.channelId);
    return {
      mappingId,
      channelId: mapping.channelId,
      channelName: mapping.channelName,
      storeId: mapping.shopifyStoreId,
      storeName: mapping.storeName || mapping.storeShopDomain,
      ...counts,
    };
  }

  /**
   * Disconnects the channel from its store; it then has no store until it's connected to one again. The store's
   * contact and order links of the channel's contacts are removed with it, so reconnecting starts clean: contacts
   * are matched again automatically, links made by agents have to be made again.
   */
  async deleteChannelMapping(user: AuthUser, mappingId: number): Promise<{ contactLinks: number; orderLinks: number }> {
    const deleted = await shopifyRepository.deleteChannelMapping(user.organizationId, mappingId);
    if (!deleted) throw AppError.notFound("This channel mapping was not found.");
    log.info("Channel unmapped from Shopify store", {
      organizationId: user.organizationId,
      mappingId,
      channelId: deleted.mapping.channelId,
      storeId: deleted.mapping.shopifyStoreId,
      removedContactLinks: deleted.removedContactLinks,
      removedOrderLinks: deleted.removedOrderLinks,
      userId: user.id,
    });
    return { contactLinks: deleted.removedContactLinks, orderLinks: deleted.removedOrderLinks };
  }

  private alreadyMappedError(channelName: string, existing: ShopifyStoreChannelRow): AppError {
    const storeName = existing.storeName || existing.storeShopDomain;
    return new AppError("SHOPIFY_CHANNEL_ALREADY_MAPPED", {
      message: `"${channelName}" is already connected to ${storeName}. Disconnect it from ${storeName} first, then connect it to this store.`,
      details: {
        mappingId: existing.id,
        channelId: existing.channelId,
        storeId: existing.shopifyStoreId,
        storeName,
        storeStatus: existing.storeStatus,
      },
      expected: true,
    });
  }

  /** A store of the workspace that's connected or needs re-authorization */
  private async requireMappableStore(organizationId: number, storeId: number) {
    const store = await shopifyRepository.findActiveStore(organizationId, storeId);
    if (!store) throw new AppError("SHOPIFY_STORE_NOT_FOUND", { details: { storeId }, expected: true });
    return store;
  }

  /** A live channel of the workspace */
  private async requireMappableChannel(organizationId: number, channelId: number) {
    const channel = await channelRepository.findById(channelId, organizationId);
    if (!channel || channel.status === ChannelStatus.DISCONNECTED) throw AppError.notFound("Channel not found.");
    return channel;
  }
}

export const shopifyStoreConnectionService = new ShopifyStoreConnectionService();
