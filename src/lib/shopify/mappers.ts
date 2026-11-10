import type { ShopifyStore } from "../db/schema";
import type { ShopifyOrderLinkRow, ShopifyStoreChannelRow, ShopifyStoreWithUser } from "../db/repositories/shopify.repository";
import { SHOPIFY_REQUIRED_SCOPES, shopifyLegacyId } from "./config";
import type { ShopifyChannelMapping, ShopifyOrderLinkInfo, ShopifyStoreInfo, ShopifyStoreRef } from "./types";

/** Database rows → API shapes. Tokens never leave the server: none of these copy them. */

/** write_x implies read_x */
export function hasScope(granted: string[], required: string): boolean {
  return granted.includes(required) || granted.includes(required.replace(/^read_/, "write_"));
}

export function toStoreInfo(store: ShopifyStoreWithUser): ShopifyStoreInfo {
  const scopes = (store.scopes || "").split(",").map((s) => s.trim()).filter(Boolean);
  return {
    id: store.id,
    shopDomain: store.shopDomain,
    name: store.name,
    email: store.email,
    currencyCode: store.currencyCode,
    primaryDomainUrl: store.primaryDomainUrl,
    status: store.status,
    scopes,
    missingScopes: SHOPIFY_REQUIRED_SCOPES.filter((s) => !hasScope(scopes, s)),
    lastError: store.lastError,
    connectedAt: store.connectedAt.toISOString(),
    connectedByName: store.connectedByName,
  };
}

export function toStoreRef(store: Pick<ShopifyStore, "id" | "shopDomain" | "name" | "status">): ShopifyStoreRef {
  return { id: store.id, shopDomain: store.shopDomain, name: store.name, status: store.status };
}

export function toChannelMapping(row: ShopifyStoreChannelRow): ShopifyChannelMapping {
  return {
    id: row.id,
    storeId: row.shopifyStoreId,
    channelId: row.channelId,
    channel: {
      id: row.channelId,
      name: row.channelName,
      type: row.channelType,
      status: row.channelStatus,
      handle: row.channelHandle,
      phoneNumber: row.channelPhoneNumber,
    },
    store: { id: row.shopifyStoreId, shopDomain: row.storeShopDomain, name: row.storeName, status: row.storeStatus },
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toOrderLinkInfo(row: ShopifyOrderLinkRow): ShopifyOrderLinkInfo {
  return {
    id: row.id,
    storeId: row.shopifyStoreId,
    store: { id: row.shopifyStoreId, shopDomain: row.storeShopDomain, name: row.storeName },
    shopifyOrderId: row.shopifyOrderId,
    orderLegacyId: shopifyLegacyId(row.shopifyOrderId),
    orderName: row.orderName,
    channelId: row.channelId,
    channelName: row.channelName,
    source: row.source,
    linkedAt: row.createdAt.toISOString(),
    linkedByName: row.linkedByName,
  };
}
