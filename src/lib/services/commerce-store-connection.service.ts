import { commerceRepository } from "../db/repositories/commerce.repository";
import { channelRepository } from "../db/repositories/channel.repository";
import { ChannelStatus, CommerceStoreStatus, type CommercePlatformValue } from "../db/schema";
import { AppError, toAppError } from "../errors";
import { createLogger } from "../logger";
import type { AuthUser } from "../security/auth";
import { canAccessStore } from "../security/store-access";
import { toCommerceChannelMapping } from "../woocommerce/mappers";
import type { CommerceChannelMapping, CommerceChannelStoreStatus, WooCommerceChannelStore } from "../woocommerce/types";

const log = createLogger("CommerceStoreConnections");

/**
 * Which stores each channel (WhatsApp number, Instagram account, Messenger page, ...) works with, for every platform
 * stored in commerce_stores. Many to many: a channel can use several stores here and on Shopify at the same time.
 */
export class CommerceStoreConnectionService {
  /** Mappings of one platform, plus every store of that platform each live channel is connected to */
  async getChannelMappings(
    organizationId: number,
    platform: CommercePlatformValue,
    filter: { storeId?: number; channelId?: number } = {}
  ): Promise<{ mappings: CommerceChannelMapping[]; channels: CommerceChannelStoreStatus[] }> {
    const [mappings, liveChannels] = await Promise.all([
      commerceRepository.listChannelMappings(organizationId, { platform }),
      channelRepository.listByOrgAndType(organizationId),
    ]);

    const channels: CommerceChannelStoreStatus[] = liveChannels
      .filter((c) => filter.channelId === undefined || c.id === filter.channelId)
      .map((channel) => ({
        channelId: channel.id,
        name: channel.name,
        type: channel.type,
        status: channel.status,
        links: mappings
          .filter((m) => m.channelId === channel.id)
          .sort((a, b) => a.id - b.id)
          .map((m) => ({ mappingId: m.id, storeId: m.storeId, storeName: m.storeName || m.storeHost, storeStatus: m.storeStatus })),
      }))
      .filter((c) => filter.storeId === undefined || c.links.some((l) => l.storeId === filter.storeId));

    return {
      mappings: mappings
        .filter((m) => (filter.storeId === undefined || m.storeId === filter.storeId) && (filter.channelId === undefined || m.channelId === filter.channelId))
        .map(toCommerceChannelMapping),
      channels,
    };
  }

  /**
   * The WooCommerce stores a channel is connected to, for the inbox's store switcher: disconnected stores and stores
   * the member is limited away from (users.stores lists store hosts) are left out.
   */
  async getWooChannelStores(user: AuthUser, channelId: number): Promise<{ stores: WooCommerceChannelStore[]; hasStores: boolean }> {
    const [mapped, stores] = await Promise.all([
      commerceRepository.findStoresForChannel(user.organizationId, channelId, "woocommerce"),
      commerceRepository.findActiveStores(user.organizationId, "woocommerce"),
    ]);
    const usable = mapped.filter((s) => s.status !== CommerceStoreStatus.DISCONNECTED && canAccessStore(user, { shopDomain: s.storeHost }));
    return {
      stores: usable.map((s) => ({
        id: s.id,
        name: s.name,
        storeUrl: s.storeUrl,
        storeHost: s.storeHost,
        status: s.status as WooCommerceChannelStore["status"],
        currencyCode: s.currencyCode,
      })),
      hasStores: usable.length > 0 || stores.some((s) => canAccessStore(user, { shopDomain: s.storeHost })),
    };
  }

  async getChannelMapping(organizationId: number, mappingId: number, platform?: CommercePlatformValue): Promise<CommerceChannelMapping> {
    const row = await commerceRepository.findChannelMapping(organizationId, mappingId);
    if (!row || (platform && row.storePlatform !== platform)) throw AppError.notFound("This channel connection was not found.");
    return toCommerceChannelMapping(row);
  }

  /**
   * Connects a channel to a store. Many to many: a channel can use several stores of this platform and Shopify
   * stores at the same time. Connecting it to a store it already uses returns that connection.
   */
  async createChannelMapping(
    user: AuthUser,
    platform: CommercePlatformValue,
    params: { storeId: number; channelId: number }
  ): Promise<{ mapping: CommerceChannelMapping; created: boolean }> {
    const organizationId = user.organizationId;
    const store = await commerceRepository.findActiveStore(organizationId, params.storeId, platform);
    if (!store) throw new AppError("WOOCOMMERCE_STORE_NOT_FOUND", { details: { storeId: params.storeId }, expected: true });
    const channel = await channelRepository.findById(params.channelId, organizationId);
    if (!channel || channel.status === ChannelStatus.DISCONNECTED) throw AppError.notFound("Channel not found.");

    const pair = { channelId: params.channelId, storeId: params.storeId };
    const [existing] = await commerceRepository.listChannelMappings(organizationId, pair);
    if (existing) return { mapping: toCommerceChannelMapping(existing), created: false };

    let createdId: number;
    try {
      createdId = (await commerceRepository.createChannelMapping({ organizationId, storeId: params.storeId, channelId: params.channelId, userId: user.id })).id;
    } catch (err) {
      const appError = toAppError(err);
      // Another request connected the same pair at the same moment (uq_commerce_store_channels_store_channel)
      if (appError.code === "DB_CONSTRAINT_VIOLATION") {
        const [winner] = await commerceRepository.listChannelMappings(organizationId, pair);
        if (winner) return { mapping: toCommerceChannelMapping(winner), created: false };
      }
      throw appError;
    }

    log.info("Channel mapped to commerce store", { organizationId, platform, mappingId: createdId, channelId: params.channelId, storeId: params.storeId, userId: user.id });
    return { mapping: await this.getChannelMapping(organizationId, createdId), created: true };
  }

  /** Disconnects the channel from one of its stores; its other stores are untouched */
  async deleteChannelMapping(user: AuthUser, mappingId: number, platform?: CommercePlatformValue): Promise<void> {
    const row = await commerceRepository.findChannelMapping(user.organizationId, mappingId);
    if (!row || (platform && row.storePlatform !== platform)) throw AppError.notFound("This channel connection was not found.");
    await commerceRepository.deleteChannelMapping(user.organizationId, mappingId);
    log.info("Channel unmapped from commerce store", {
      organizationId: user.organizationId,
      platform: row.storePlatform,
      mappingId,
      channelId: row.channelId,
      storeId: row.storeId,
      userId: user.id,
    });
  }
}

export const commerceStoreConnectionService = new CommerceStoreConnectionService();
