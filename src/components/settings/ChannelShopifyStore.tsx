'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowRight, CheckCircle2, Loader2, RefreshCw, ShoppingBag } from 'lucide-react';

import apiClient from '@/lib/api/client';
import { notifyError } from '@/lib/api/notify';
import { gooeyToast } from '@/components/ui/goey-toaster';
import { notifyShopifyChanged } from '@/components/shopify/useShopifyStore';
import { Modal } from '@/components/ui/Modal';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import type {
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

const NO_STORE = 'none';

/**
 * Which Shopify store this number works with: products shared, customers matched and orders shown in its
 * conversations all come from that store. There is no default store: until the number is connected (synced) to
 * a store, its conversations show no Shopify data. "No store linked" removes the connection.
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
  const current = status?.via === 'mapping' && status.effectiveStoreId ? String(status.effectiveStoreId) : NO_STORE;
  const [choice, setChoice] = useState(current);
  const [syncing, setSyncing] = useState(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => setChoice(current), [current]);

  const effective = status?.via === 'mapping' ? (stores.find((s) => s.id === status.effectiveStoreId) ?? null) : null;
  const storeLabel = (s: ShopifyStoreInfo) => s.name || s.shopDomain;
  const target = choice === NO_STORE ? null : (stores.find((s) => String(s.id) === choice) ?? null);

  // Leaving its current store removes that store's contact and order links of this number: confirm first
  const onSyncClick = () => {
    if (choice === current) return;
    if (status?.mappingId) setConfirming(true);
    else sync();
  };

  const sync = async () => {
    if (choice === current) return;
    setConfirming(false);
    setSyncing(true);
    let removed: ShopifyChannelUnmapResult['removed'] | null = null;
    try {
      // A number belongs to one store: disconnect it from its store before connecting it to another
      if (status?.mappingId) {
        const res = await apiClient.delete<ShopifyChannelUnmapResult>(`/api/integrations/shopify/channel-mappings/${status.mappingId}`);
        removed = res.data?.removed ?? null;
      }
      if (target) {
        try {
          await apiClient.post('/api/integrations/shopify/channel-mappings', { storeId: target.id, channelId });
        } catch (err) {
          // Don't leave the number without its previous store because the new connection failed
          if (effective) {
            await apiClient.post('/api/integrations/shopify/channel-mappings', { storeId: effective.id, channelId }).catch(() => undefined);
          }
          throw err;
        }
      }
      const removedText = removed ? removedSummary(removed.contactLinks, removed.orderLinks) : null;
      gooeyToast.success(target ? 'Number synced with Shopify store' : 'Number disconnected from Shopify', {
        description:
          (target
            ? `${storeLabel(target)}: products and orders now show in this number's conversations.`
            : "This number's conversations no longer show Shopify products or orders.") + (removedText ? ` Removed ${removedText}.` : ''),
      });
      // The inbox (and anything else showing Shopify data) picks up the new store
      notifyShopifyChanged();
    } catch (err) {
      notifyError(err, { where: 'ChannelShopifyStore.sync', title: "Couldn't sync the Shopify store" });
    } finally {
      setSyncing(false);
      onChanged();
    }
  };

  if (!loaded) {
    return <div className="h-9 rounded-lg bg-slate-100 animate-pulse" />;
  }

  if (stores.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-dashed border-slate-300 px-3 py-2.5">
        <ShoppingBag className="w-4 h-4 text-slate-400 shrink-0" />
        <p className="flex-1 text-xs text-slate-500">No Shopify store connected. Connect one to share products and see orders in this number&apos;s chats.</p>
        <Link href="/integrations/shopify" className="shrink-0 text-xs font-semibold text-[#3440a8] hover:underline">
          Connect Shopify
        </Link>
      </div>
    );
  }

  const description = !status
    ? { text: "Couldn't read which store this number uses. Choose one to sync it.", className: 'text-slate-500', icon: null }
    : effective && effective.status !== 'connected'
      ? {
        text: `Synced with ${storeLabel(effective)}, but the store needs to be reconnected before its data shows in the inbox.`,
        className: 'text-amber-700',
        icon: <AlertTriangle className="w-3.5 h-3.5 shrink-0" />,
      }
      : effective
        ? { text: `Synced with ${storeLabel(effective)}`, className: 'text-emerald-700', icon: <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> }
        : status.mappingId
          ? { text: 'Its store was disconnected. Choose another store and sync.', className: 'text-amber-700', icon: null }
          : { text: 'No store linked: this number’s conversations show no Shopify data. Choose a store and sync.', className: 'text-slate-500', icon: null };

  return (
    <div className="space-y-2">
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <SearchableSelect
          className="flex-1 min-w-0"
          value={choice}
          onChange={setChoice}
          disabled={syncing}
          aria-label="Shopify store for this number"
          placeholder="Choose a Shopify store"
          searchPlaceholder="Search stores by name or domain"
          emptyText="No store matches your search"
          options={[
            { value: NO_STORE, label: 'No store linked', description: 'Conversations on this number show no Shopify data', dividerAfter: true },
            ...stores.map((s) => ({
              value: String(s.id),
              label: storeLabel(s),
              description: s.shopDomain,
              badge: s.status !== 'connected' ? { text: 'Reconnect needed', tone: 'warning' as const } : undefined,
            })),
          ]}
        />
        <button
          type="button"
          onClick={onSyncClick}
          disabled={syncing || choice === current}
          className="shrink-0 inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold text-white bg-[#3440a8] hover:bg-[#2b358c] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {syncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          {syncing ? 'Syncing…' : 'Sync store'}
        </button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={`text-[11px] inline-flex items-center gap-1 ${description.className}`}>
          {description.icon}
          {description.text}
        </p>
        {effective && (
          <Link
            href={`/integrations/shopify/stores/${effective.id}`}
            className="text-[11px] font-semibold text-[#3440a8] hover:underline inline-flex items-center gap-1"
          >
            View store <ArrowRight className="w-3 h-3" />
          </Link>
        )}
      </div>

      {confirming && status?.mappingId && (
        <LeaveStoreConfirm
          mappingId={status.mappingId}
          target={target ? { name: storeLabel(target) } : null}
          onCancel={() => setConfirming(false)}
          onConfirm={sync}
        />
      )}
    </div>
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
 * Confirms disconnecting a number from its store, or moving it to another store. Either way the current store's
 * links of this number's contacts are deleted by the server (DELETE /channel-mappings/:id); the counts come from
 * GET /channel-mappings/:id/impact, so the warning says exactly what will go.
 */
function LeaveStoreConfirm({
  mappingId,
  target,
  onCancel,
  onConfirm,
}: {
  mappingId: number;
  /** The store the number moves to; null: it's only disconnected */
  target: { name: string } | null;
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
              {target ? `Move ${numberName} to ${target.name}?` : `Disconnect ${numberName} from ${storeName}?`}
            </h3>
            <p className="mt-1 text-[12.5px] text-slate-600 leading-relaxed">
              {target
                ? `Conversations on this number will show products, customers and orders from ${target.name} instead of ${storeName}.`
                : `Conversations on this number will stop showing products, customers and orders from ${storeName}.`}
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
          {target ? ` On ${target.name}, contacts are matched automatically by phone and email.` : ''}
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
          {target ? 'Move number' : 'Disconnect number'}
        </button>
      </div>
    </Modal>
  );
}
