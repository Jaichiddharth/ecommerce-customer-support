'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import apiClient from '@/lib/api/client';
import { useAuth } from '@/context/AuthContext';
import type { ShopifyChannelStore } from '@/lib/shopify/types';
import type { WooCommerceChannelStore } from '@/lib/woocommerce/types';
import { SHOPIFY_CHANGED_EVENT } from '@/components/shopify/useShopifyStore';
import { WOOCOMMERCE_CHANGED_EVENT } from '@/components/woocommerce/useWooCommerceStores';

/** One store linked to the conversation's number, on any platform */
export type ConversationStore =
  | { key: string; platform: 'shopify'; id: number; name: string; address: string; status: string; shopify: ShopifyChannelStore }
  | { key: string; platform: 'woocommerce'; id: number; name: string; address: string; status: string; woo: WooCommerceChannelStore };

export const PLATFORM_LABEL: Record<ConversationStore['platform'], string> = { shopify: 'Shopify', woocommerce: 'WooCommerce' };

/** The store the agent last picked for each number, so switching conversations keeps it (this tab only) */
const pickedByChannel = new Map<number, string>();

/**
 * Every store (Shopify and WooCommerce) the conversation's number is linked to, and the one the agent picked in the
 * inbox's store switcher. One store is active at a time: products, sharing and the contact's orders all come from
 * `selected`. It starts on the number's first store (Shopify stores first, oldest link first) until the agent picks
 * another. There is no default store: a number without a linked store shows no store data.
 *
 * Refreshes when a store or a number's stores change (in this tab) and when the tab regains focus. A failed check
 * is reported as `failed`, never as "no store", so the inbox doesn't tell the member to connect a store they have.
 */
export function useConversationStores(channelId: number | null | undefined) {
  const { dbUser } = useAuth();
  const signedIn = Boolean(dbUser);
  const id = channelId ?? null;

  const [stores, setStores] = useState<ConversationStore[]>([]);
  const [hasStores, setHasStores] = useState(false);
  const [failed, setFailed] = useState(false);
  const [loadedFor, setLoadedFor] = useState<number | null>(null);
  const [pickedKey, setPickedKey] = useState<string | null>(null);
  const latest = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    latest.current = id;
    if (id === null || !signedIn) {
      setStores([]);
      setLoadedFor(null);
      return;
    }
    const [shopify, woo] = await Promise.allSettled([
      apiClient.get('/api/integrations/shopify/channel-store', { params: { channelId: id } }),
      apiClient.get('/api/integrations/woocommerce/channel-store', { params: { channelId: id } }),
    ]);
    if (latest.current !== id) return; // another conversation was opened meanwhile

    const next: ConversationStore[] = [];
    let anyStores = false;
    if (shopify.status === 'fulfilled') {
      anyStores ||= Boolean(shopify.value.data?.hasStores);
      for (const s of (shopify.value.data?.stores ?? []) as ShopifyChannelStore[]) {
        next.push({ key: `shopify:${s.id}`, platform: 'shopify', id: s.id, name: s.name || s.shopDomain, address: s.shopDomain, status: s.status, shopify: s });
      }
    }
    if (woo.status === 'fulfilled') {
      anyStores ||= Boolean(woo.value.data?.hasStores);
      for (const s of (woo.value.data?.stores ?? []) as WooCommerceChannelStore[]) {
        next.push({ key: `woocommerce:${s.id}`, platform: 'woocommerce', id: s.id, name: s.name || s.storeHost, address: s.storeHost, status: s.status, woo: s });
      }
    }
    // Keep what we knew when a platform couldn't be checked; only "both failed" is reported as a failed check
    const bothFailed = shopify.status === 'rejected' && woo.status === 'rejected';
    if (!bothFailed) {
      setStores(next);
      setHasStores(anyStores || next.length > 0);
    }
    setFailed(bothFailed);
    setLoadedFor(id);
  }, [id, signedIn]);

  useEffect(() => {
    // Don't show the previous number's stores while this one loads
    setStores([]);
    setFailed(false);
    setPickedKey(id !== null ? (pickedByChannel.get(id) ?? null) : null);
    refresh();
    window.addEventListener(SHOPIFY_CHANGED_EVENT, refresh);
    window.addEventListener(WOOCOMMERCE_CHANGED_EVENT, refresh);
    window.addEventListener('focus', refresh);
    return () => {
      window.removeEventListener(SHOPIFY_CHANGED_EVENT, refresh);
      window.removeEventListener(WOOCOMMERCE_CHANGED_EVENT, refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [id, refresh]);

  // The picked store, unless it was unlinked meanwhile: then the number's first store
  const selected = useMemo(() => stores.find((s) => s.key === pickedKey) ?? stores[0] ?? null, [stores, pickedKey]);

  const select = useCallback(
    (key: string) => {
      setPickedKey(key);
      if (id !== null) pickedByChannel.set(id, key);
    },
    [id]
  );

  return {
    channelId: id,
    stores,
    selected,
    select,
    /** The selected store when it's a Shopify store (what the Shopify components take) */
    shopifyStore: selected?.platform === 'shopify' ? selected.shopify : null,
    wooStore: selected?.platform === 'woocommerce' ? selected.woo : null,
    /** The workspace has a store this member can use (but maybe not linked to this number) */
    hasStores,
    /** The check failed (network, session); stores/hasStores are unknown */
    failed,
    retry: refresh,
    isLoading: id !== null && (!signedIn || loadedFor !== id),
    isConnected: selected?.status === 'connected',
    needsReauth: selected?.status === 'reauth_required',
  };
}

export type ConversationStores = ReturnType<typeof useConversationStores>;
