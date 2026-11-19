'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';

import apiClient from '@/lib/api/client';
import { notifyError } from '@/lib/api/notify';
import { gooeyToast } from '@/components/ui/goey-toaster';
import { notifyShopifyChanged } from '@/components/shopify/useShopifyStore';
import { Modal } from '@/components/ui/Modal';
import { ChannelStoreLinks } from './ChannelStoreLinks';
import type {
  ChannelStoreLink,
  ShopifyChannelStoreStatus,
  ShopifyChannelUnmapImpact,
  ShopifyChannelUnmapResult,
  ShopifyStoreInfo,
} from '@/lib/shopify/types';

/** Stores of the workspace and which store each channel uses; loaded once for all channel cards */
export function useChannelStores(enabled: boolean) {
  const [stores, setStores] = useState<ShopifyStoreInfo[]>([]);
  const [channels, setChannels] = useState<ShopifyChannelStoreStatus[]>([]);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      const [conn, mappings] = await Promise.all([
        apiClient.get('/api/integrations/shopify'),
        apiClient.get('/api/integrations/shopify/channel-mappings'),
      ]);
      setStores(conn.data?.stores ?? []);
      setChannels(mappings.data?.channels ?? []);
    } catch {
      // Each card shows "couldn't load" below; the channel list itself still works
    } finally {
      setLoaded(true);
    }
  }, [enabled]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { stores, channels, loaded, refresh };
}

/**
 * The Shopify stores this number works with. A number can be linked to several stores (and to WooCommerce stores
 * too); in the inbox the agent picks which of them products, customers and orders come from. There is no default
 * store: a number without a linked store shows no Shopify data. Unlinking a store first shows what goes with it.
 */
export function ChannelShopifyStore({
  channelId,
  status,
  stores,
  loaded,
  onChanged,
}: {
  channelId: number;
  status: ShopifyChannelStoreStatus | undefined;
  stores: ShopifyStoreInfo[];
  loaded: boolean;
  onChanged: () => void;
}) {
  const [confirming, setConfirming] = useState<ChannelStoreLink | null>(null);
  const storeLabel = (s: ShopifyStoreInfo) => s.name || s.shopDomain;

  const link = async (storeId: number): Promise<boolean> => {
    const target = stores.find((s) => s.id === storeId);
    try {
      await apiClient.post('/api/integrations/shopify/channel-mappings', { storeId, channelId });
      gooeyToast.success('Number linked to Shopify store', {
        description: `${target ? storeLabel(target) : 'The store'}: its products and orders are now available in this number's conversations.`,
      });
      // The inbox (and anything else showing Shopify data) picks up the new store
      notifyShopifyChanged();
      return true;
    } catch (err) {
      notifyError(err, { where: 'ChannelShopifyStore.link', title: "Couldn't link the Shopify store" });
      return false;
    } finally {
      onChanged();
    }
  };

  const unlink = async (target: ChannelStoreLink) => {
    setConfirming(null);
    try {
      const res = await apiClient.delete<ShopifyChannelUnmapResult>(`/api/integrations/shopify/channel-mappings/${target.mappingId}`);
      const removed = res.data?.removed;
      const removedText = removed ? removedSummary(removed.contactLinks, removed.orderLinks) : null;
      gooeyToast.success('Shopify store unlinked', {
        description: `This number's conversations no longer show ${target.storeName}.` + (removedText ? ` Removed ${removedText}.` : ''),
      });
      notifyShopifyChanged();
    } catch (err) {
      notifyError(err, { where: 'ChannelShopifyStore.unlink', title: "Couldn't unlink the Shopify store" });
    } finally {
      onChanged();
    }
  };

  return (
    <>
      <ChannelStoreLinks
        platform="Shopify"
        links={status?.links}
        stores={stores.map((s) => ({ id: s.id, name: storeLabel(s), address: s.shopDomain, status: s.status }))}
        loaded={loaded}
        connectHref="/integrations/shopify"
        storeHref={(id) => `/integrations/shopify/stores/${id}`}
        emptyText="No Shopify store linked: this number's conversations show no Shopify data."
        onLink={link}
        onUnlink={(l) => setConfirming(l)}
      />
      {confirming && <LeaveStoreConfirm mappingId={confirming.mappingId} onCancel={() => setConfirming(null)} onConfirm={() => unlink(confirming)} />}
    </>
  );
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** "3 contact links and 1 order link", or null when nothing was removed */
function removedSummary(contactLinks: number, orderLinks: number): string | null {
  const parts = [
    contactLinks > 0 ? plural(contactLinks, 'contact link', 'contact links') : null,
    orderLinks > 0 ? plural(orderLinks, 'order link', 'order links') : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' and ') : null;
}

/**
 * Confirms unlinking a number from one of its stores. That store's links of this number's contacts are deleted
 * by the server (DELETE /channel-mappings/:id); the counts come from
 * GET /channel-mappings/:id/impact, so the warning says exactly what will go.
 */
function LeaveStoreConfirm({
  mappingId,
  onCancel,
  onConfirm,
}: {
  mappingId: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [impact, setImpact] = useState<ShopifyChannelUnmapImpact | null>(null);
  const [failed, setFailed] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiClient
      .get<{ impact: ShopifyChannelUnmapImpact }>(`/api/integrations/shopify/channel-mappings/${mappingId}/impact`)
      .then((res) => !cancelled && setImpact(res.data?.impact ?? null))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [mappingId]);

  const loading = !impact && !failed;
  const storeName = impact?.storeName ?? 'its current store';
  const numberName = impact?.channelName ?? 'this number';
  const hasLinks = !!impact && (impact.linkedContacts > 0 || impact.linkedOrders > 0);
  // Ask for an explicit acknowledgement when something will be lost (or we couldn't tell)
  const needsAck = hasLinks || failed;
  const autoContacts = impact ? impact.linkedContacts - impact.manuallyLinkedContacts : 0;

  return (
    <Modal
      isOpen
      onClose={onCancel}
      maxWidth="md"
      header={
        <div className="flex items-start gap-3">
          <span className="w-9 h-9 rounded-full bg-red-50 text-red-600 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-4.5 h-4.5" />
          </span>
          <div className="min-w-0">
            <h3 className="text-[15px] font-bold text-slate-900">
              {`Unlink ${numberName} from ${storeName}?`}
            </h3>
            <p className="mt-1 text-[12.5px] text-slate-600 leading-relaxed">
              {`Conversations on this number will stop showing products, customers and orders from ${storeName}. Its other stores stay linked.`}
            </p>
          </div>
        </div>
      }
    >
      {loading ? (
        <div className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-3 text-xs text-slate-500">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Checking linked contacts and orders…
        </div>
      ) : failed ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-800 leading-relaxed">
          We couldn&apos;t count the linked contacts and orders. Any links between this number&apos;s contacts and Shopify customers
          or orders of its current store will be permanently removed.
        </div>
      ) : hasLinks && impact ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-800">
          <p className="font-semibold">The following will be permanently removed from {storeName}:</p>
          <ul className="mt-1.5 space-y-1 list-disc pl-4 leading-relaxed">
            {impact.linkedContacts > 0 && (
              <li>
                {plural(impact.linkedContacts, 'contact linked', 'contacts linked')} to Shopify customers
                {impact.manuallyLinkedContacts > 0 && autoContacts > 0
                  ? ` (${impact.manuallyLinkedContacts.toLocaleString()} linked manually by your team)`
                  : impact.manuallyLinkedContacts > 0
                    ? ' (linked manually by your team)'
                    : ''}
              </li>
            )}
            {impact.linkedOrders > 0 && <li>{plural(impact.linkedOrders, 'order linked', 'orders linked')} to contacts</li>}
          </ul>
        </div>
      ) : (
        <div className="rounded-lg bg-slate-50 px-3 py-2.5 text-xs text-slate-600 leading-relaxed">
          No contacts or orders of this number are linked to {storeName}, so nothing else is removed.
        </div>
      )}

      {!loading && (
        <p className="text-[11.5px] text-slate-500 leading-relaxed mt-2">
          Your Shopify data isn&apos;t changed. Contacts who also message you on another number connected to {storeName} keep their links.
          {hasLinks || failed
            ? ` If this number is connected to ${storeName} again, contacts are re-matched automatically by phone and email where there is exactly one match; links and orders your team added manually have to be added again.`
            : ''}
        </p>
      )}

      {needsAck && !loading && (
        <label className="flex items-start gap-2 text-xs text-slate-700 cursor-pointer select-none mt-2">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
            className="mt-0.5 accent-red-600 cursor-pointer"
          />
          I understand these links will be permanently removed.
        </label>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="px-3.5 py-2 rounded-lg text-xs font-semibold text-slate-700 border border-slate-200 hover:bg-slate-50 cursor-pointer"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={loading || (needsAck && !acknowledged)}
          className="px-3.5 py-2 rounded-lg text-xs font-semibold text-white bg-red-600 hover:bg-red-700 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Unlink store
        </button>
      </div>
    </Modal>
  );
}
