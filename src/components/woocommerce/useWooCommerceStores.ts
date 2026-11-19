'use client';

import { useCallback, useEffect, useState } from 'react';
import apiClient from '@/lib/api/client';
import { ApiError, toApiError } from '@/lib/api/api-error';
import type { WooCommerceStoreInfo } from '@/lib/woocommerce/types';

/** Fired after connect/disconnect/channel changes so every component showing WooCommerce data refreshes */
export const WOOCOMMERCE_CHANGED_EVENT = 'woocommerce-connection-changed';

export function notifyWooCommerceChanged() {
  window.dispatchEvent(new Event(WOOCOMMERCE_CHANGED_EVENT));
}

/** The workspace's WooCommerce connections, from GET /api/integrations/woocommerce */
export function useWooCommerceStores(enabled = true) {
  const [stores, setStores] = useState<WooCommerceStoreInfo[]>([]);
  const [configured, setConfigured] = useState(true);
  const [scope, setScope] = useState<'read' | 'write' | 'read_write'>('read_write');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) {
      setIsLoading(false);
      return;
    }
    try {
      const res = await apiClient.get('/api/integrations/woocommerce');
      setStores(res.data?.stores ?? []);
      setConfigured(res.data?.configured !== false);
      if (res.data?.scope) setScope(res.data.scope);
      setError(null);
    } catch (err) {
      setError(toApiError(err));
    } finally {
      setIsLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    refresh();
    window.addEventListener(WOOCOMMERCE_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(WOOCOMMERCE_CHANGED_EVENT, refresh);
  }, [refresh]);

  return { stores, configured, scope, isLoading, error, refresh };
}
