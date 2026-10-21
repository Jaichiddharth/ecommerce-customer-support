'use client';

import { useCallback, useEffect, useState } from 'react';
import apiClient from '@/lib/api/client';
import { ApiError, toApiError } from '@/lib/api/api-error';
import type { ShopifyStoreInfo } from '@/lib/shopify/types';

/** Fired after connect/disconnect so every component showing Shopify data refreshes */
export const SHOPIFY_CHANGED_EVENT = 'shopify-connection-changed';

export function notifyShopifyChanged() {
  window.dispatchEvent(new Event(SHOPIFY_CHANGED_EVENT));
}

/** The organization's Shopify connection, from GET /api/integrations/shopify */
export function useShopifyStore() {
  const [store, setStore] = useState<ShopifyStoreInfo | null>(null);
  const [configured, setConfigured] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await apiClient.get('/api/integrations/shopify');
      setStore(res.data?.store ?? null);
      setConfigured(res.data?.configured !== false);
      setError(null);
    } catch (err) {
      setError(toApiError(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    window.addEventListener(SHOPIFY_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(SHOPIFY_CHANGED_EVENT, refresh);
  }, [refresh]);

  return {
    store,
    configured,
    isLoading,
    error,
    refresh,
    isConnected: store?.status === 'connected',
    needsReauth: store?.status === 'reauth_required',
  };
}
