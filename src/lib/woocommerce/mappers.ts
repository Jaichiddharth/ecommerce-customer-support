import type { CommerceStoreChannelRow, CommerceStoreWithUser } from "../db/repositories/commerce.repository";
import type { CommerceChannelMapping, WooCommerceStoreInfo } from "./types";

/** Database rows → API shapes. Credentials never leave the server: none of these copy them. */

export function toWooStoreInfo(store: CommerceStoreWithUser): WooCommerceStoreInfo {
  const settings = store.settings ?? {};
  return {
    id: store.id,
    platform: "woocommerce",
    storeUrl: store.storeUrl,
    storeHost: store.storeHost,
    name: store.name,
    currencyCode: store.currencyCode,
    status: store.status,
    keyPermissions: typeof settings.keyPermissions === "string" ? settings.keyPermissions : store.scopes,
    keyId: typeof settings.keyId === "number" ? settings.keyId : null,
    isHttps: store.storeUrl.startsWith("https://"),
    lastError: store.lastError,
    lastVerifiedAt: store.lastVerifiedAt ? store.lastVerifiedAt.toISOString() : null,
    connectedAt: store.connectedAt.toISOString(),
    connectedByName: store.connectedByName,
  };
}

export function toCommerceChannelMapping(row: CommerceStoreChannelRow): CommerceChannelMapping {
  return {
    id: row.id,
    storeId: row.storeId,
    channelId: row.channelId,
    channel: {
      id: row.channelId,
      name: row.channelName,
      type: row.channelType,
      status: row.channelStatus,
      handle: row.channelHandle,
      phoneNumber: row.channelPhoneNumber,
    },
    store: { id: row.storeId, platform: row.storePlatform, storeHost: row.storeHost, name: row.storeName, status: row.storeStatus },
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
