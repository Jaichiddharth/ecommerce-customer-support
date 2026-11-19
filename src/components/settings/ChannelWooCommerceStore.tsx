'use client';

import React, { useCallback, useEffect, useState } from 'react';

import apiClient from '@/lib/api/client';
import { notifyError } from '@/lib/api/notify';
import { gooeyToast } from '@/components/ui/goey-toaster';
import { ChannelStoreLinks } from './ChannelStoreLinks';
import { WOOCOMMERCE_CHANGED_EVENT, notifyWooCommerceChanged } from '@/components/woocommerce/useWooCommerceStores';
import type { ChannelStoreLink, CommerceChannelStoreStatus, WooCommerceStoreInfo } from '@/lib/woocommerce/types';

/** WooCommerce stores of the workspace and which ones each channel uses; loaded once for all channel cards */
export function useChannelWooStores(enabled: boolean) {
  const [stores, setStores] = useState<WooCommerceStoreInfo[]>([]);
  const [channels, setChannels] = useState<CommerceChannelStoreStatus[]>([]);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      const [conn, mappings] = await Promise.all([
        apiClient.get('/api/integrations/woocommerce'),
        apiClient.get('/api/integrations/woocommerce/channel-mappings'),
      ]);
      setStores(conn.data?.stores ?? []);
      setChannels(mappings.data?.channels ?? []);
    } catch {
      // The card shows the picker without a current store; the channel list itself still works
    } finally {
      setLoaded(true);
    }
  }, [enabled]);

  useEffect(() => {
    refresh();
    window.addEventListener(WOOCOMMERCE_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(WOOCOMMERCE_CHANGED_EVENT, refresh);
  }, [refresh]);

  return { stores, channels, loaded, refresh };
}

/**
 * The WooCommerce stores this channel works with. A channel can be linked to several WooCommerce stores and to
 * Shopify stores at the same time.
 */
export function ChannelWooCommerceStore({
  channelId,
  status,
  stores,
  loaded,
  onChanged,
}: {
  channelId: number;
  status: CommerceChannelStoreStatus | undefined;
  stores: WooCommerceStoreInfo[];
  loaded: boolean;
  onChanged: () => void;
}) {
  const label = (s: WooCommerceStoreInfo) => s.name || s.storeHost;

  const link = async (storeId: number): Promise<boolean> => {
    const target = stores.find((s) => s.id === storeId);
    try {
      await apiClient.post('/api/integrations/woocommerce/channel-mappings', { storeId, channelId });
      gooeyToast.success('Channel linked to WooCommerce store', {
        description: `${target ? label(target) : 'The store'} now serves this channel.`,
      });
      notifyWooCommerceChanged();
      return true;
    } catch (err) {
      notifyError(err, { where: 'ChannelWooCommerceStore.link', title: "Couldn't link the WooCommerce store" });
      return false;
    } finally {
      onChanged();
    }
  };

  const unlink = async (target: ChannelStoreLink) => {
    try {
      await apiClient.delete(`/api/integrations/woocommerce/channel-mappings/${target.mappingId}`);
      gooeyToast.success('WooCommerce store unlinked', { description: `${target.storeName} no longer serves this channel.` });
      notifyWooCommerceChanged();
    } catch (err) {
      notifyError(err, { where: 'ChannelWooCommerceStore.unlink', title: "Couldn't unlink the WooCommerce store" });
    } finally {
      onChanged();
    }
  };

  return (
    <ChannelStoreLinks
      platform="WooCommerce"
      links={status?.links}
      stores={stores.map((s) => ({ id: s.id, name: label(s), address: s.storeHost, status: s.status }))}
      loaded={loaded}
      connectHref="/integrations/woocommerce"
      storeHref={(id) => `/integrations/woocommerce/stores/${id}`}
      emptyText="No WooCommerce store linked to this channel."
      onLink={link}
      onUnlink={unlink}
    />
  );
}
