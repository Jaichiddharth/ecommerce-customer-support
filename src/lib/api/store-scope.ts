import { parseId } from "./params";
import type { StoreScope } from "@/lib/services/shopify-store-connection.service";

/**
 * Store scope from ?storeId=&channelId=&customerId= (all optional). Without any there is no store (there is no
 * default store). A value that is present but not a positive integer is rejected rather than ignored, so a typo
 * can't silently fall back to another store.
 */
export function storeScopeFromQuery(searchParams: URLSearchParams): StoreScope {
  const read = (name: string) => {
    const value = searchParams.get(name);
    return value === null || value === "" ? undefined : parseId(value, name);
  };
  return { storeId: read("storeId"), channelId: read("channelId"), customerId: read("customerId") };
}

/** Optional positive integer from a JSON body; present but invalid → 400 */
export function optionalBodyId(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return parseId(String(value), field);
}

/** WooCommerce inbox scope from ?storeId=&channelId=&customerId=: storeId is required (the store picked in the inbox) */
export function wooInboxScopeFromQuery(searchParams: URLSearchParams): { storeId: number; channelId?: number; customerId?: number } {
  const read = (name: string) => {
    const value = searchParams.get(name);
    return value === null || value === "" ? undefined : parseId(value, name);
  };
  return { storeId: parseId(searchParams.get("storeId"), "storeId"), channelId: read("channelId"), customerId: read("customerId") };
}
