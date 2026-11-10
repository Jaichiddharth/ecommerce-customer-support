'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import apiClient from '@/lib/api/client';
import { useAuth } from '@/context/AuthContext';
import type { ShopifyChannelStore } from '@/lib/shopify/types';
import { SHOPIFY_CHANGED_EVENT } from './useShopifyStore';

/**
 * The Shopify store a WhatsApp number (channel) is connected to. There is no default store: a conversation on a
 * number that isn't connected to a store shows no Shopify data. Refreshes when a store or a number's store changes
 * (SHOPIFY_CHANGED_EVENT) and when the tab regains focus, e.g. after syncing the number in Settings in another tab.
 *
 * Waits until the member is signed in (a request sent before the auth token is ready is rejected). A failed check
 * is reported as `failed`, never as "no store", so the inbox doesn't tell the member to connect a store they have.
 */
export function useChannelShopifyStore(channelId: number | null | undefined) {
  const { dbUser } = useAuth();
  const signedIn = Boolean(dbUser);
  const [store, setStore] = useState<ShopifyChannelStore | null>(null);
  const [hasStores, setHasStores] = useState(false);
  const [failed, setFailed] = useState(false);
  const [loadedFor, setLoadedFor] = useState<number | null>(null);
  const latest = useRef<number | null>(null);
  const id = channelId ?? null;

  const refresh = useCallback(async () => {
    latest.current = id;
    if (id === null || !signedIn) {
      setStore(null);
      setLoadedFor(null);
      return;
    }
    try {
      const res = await apiClient.get('/api/integrations/shopify/channel-store', { params: { channelId: id } });
      if (latest.current !== id) return; // another conversation was opened meanwhile
      setStore((res.data?.store as ShopifyChannelStore | null) ?? null);
      setHasStores(Boolean(res.data?.hasStores));
      setFailed(false);
    } catch {
      if (latest.current !== id) return;
      // Keep what we knew; the panel shows "couldn't check" with a retry instead of a wrong "connect a store"
      setFailed(true);
    } finally {
      if (latest.current === id) setLoadedFor(id);
    }
  }, [id, signedIn]);

  useEffect(() => {
    // Don't show the previous number's store while this one loads
    setStore(null);
    setFailed(false);
    refresh();
    window.addEventListener(SHOPIFY_CHANGED_EVENT, refresh);
    window.addEventListener('focus', refresh);
    return () => {
      window.removeEventListener(SHOPIFY_CHANGED_EVENT, refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [refresh]);

  return {
    channelId: id,
    store,
    /** The workspace has a store this member can use (but maybe not connected to this number) */
    hasStores,
    /** The check failed (network, session); store/hasStores are unknown */
    failed,
    retry: refresh,
    isLoading: id !== null && (!signedIn || loadedFor !== id),
    isConnected: store?.status === 'connected',
    needsReauth: store?.status === 'reauth_required',
  };
}
