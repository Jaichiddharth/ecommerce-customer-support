'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Link2, Loader2, ShoppingBag, X } from 'lucide-react';

import { SearchableSelect } from '@/components/ui/SearchableSelect';
import type { ChannelStoreLink } from '@/lib/shopify/types';

/** A connected store of the workspace, as the picker shows it */
export interface LinkableStore {
  id: number;
  name: string;
  /** Domain / host, shown under the name */
  address: string;
  status: string;
}

/**
 * The stores of one platform a channel is connected to, with "Link a store" to add another and ✕ to unlink one.
 * A channel can use several stores of every platform; the inbox lets the agent switch between them.
 * Platform specifics (API calls, toasts, confirmations) stay with the caller through onLink / onUnlink.
 */
export function ChannelStoreLinks({
  platform,
  links,
  stores,
  loaded,
  connectHref,
  storeHref,
  emptyText,
  onLink,
  onUnlink,
}: {
  /** "Shopify", "WooCommerce" */
  platform: string;
  /** undefined: couldn't read the channel's stores */
  links: ChannelStoreLink[] | undefined;
  stores: LinkableStore[];
  loaded: boolean;
  connectHref: string;
  storeHref: (storeId: number) => string;
  /** Shown when the channel has no store of this platform */
  emptyText: string;
  /** Resolves true when linked (the caller reports errors) */
  onLink: (storeId: number) => Promise<boolean>;
  onUnlink: (link: ChannelStoreLink) => void | Promise<void>;
}) {
  const [choice, setChoice] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState<number | null>(null);

  if (!loaded) return <div className="h-9 rounded-lg bg-slate-100 animate-pulse" />;

  const current = links ?? [];
  if (stores.length === 0 && current.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-dashed border-slate-300 px-3 py-2.5">
        <ShoppingBag className="w-4 h-4 text-slate-400 shrink-0" />
        <p className="flex-1 text-xs text-slate-500">No {platform} store connected to your workspace yet.</p>
        <Link href={connectHref} className="shrink-0 text-xs font-semibold text-[#3440a8] hover:underline">
          Connect {platform}
        </Link>
      </div>
    );
  }

  const linkedIds = new Set(current.map((l) => l.storeId));
  const available = stores.filter((s) => !linkedIds.has(s.id));

  const add = async () => {
    if (!choice) return;
    setAdding(true);
    try {
      if (await onLink(Number(choice))) setChoice(null);
    } finally {
      setAdding(false);
    }
  };

  const remove = async (link: ChannelStoreLink) => {
    setRemovingId(link.mappingId);
    try {
      await onUnlink(link);
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <div className="space-y-2">
      {current.length > 0 ? (
        <ul className="space-y-1.5">
          {current.map((link) => {
            const live = stores.find((s) => s.id === link.storeId);
            const disconnected = !live || link.storeStatus === 'disconnected';
            const needsReauth = !disconnected && link.storeStatus === 'reauth_required';
            return (
              <li key={link.mappingId} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
                <ShoppingBag className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-slate-800 truncate">{link.storeName}</p>
                  {live && live.address !== link.storeName && <p className="text-[11px] text-slate-500 truncate">{live.address}</p>}
                </div>
                {needsReauth && (
                  <span className="shrink-0 px-1.5 py-px rounded text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                    Reconnect needed
                  </span>
                )}
                {disconnected && (
                  <span className="shrink-0 px-1.5 py-px rounded text-[10px] font-semibold bg-slate-100 text-slate-600">Store disconnected</span>
                )}
                {!disconnected && (
                  <Link
                    href={storeHref(link.storeId)}
                    className="shrink-0 text-[11px] font-semibold text-[#3440a8] hover:underline inline-flex items-center gap-0.5"
                  >
                    View <ArrowRight className="w-3 h-3" />
                  </Link>
                )}
                <button
                  type="button"
                  onClick={() => remove(link)}
                  disabled={removingId !== null}
                  aria-label={`Unlink ${link.storeName}`}
                  title={`Unlink ${link.storeName} from this channel`}
                  className="shrink-0 p-1 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {removingId === link.mappingId ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-[11px] text-slate-500">{links === undefined ? `Couldn't read which ${platform} stores this channel uses.` : emptyText}</p>
      )}

      {available.length > 0 && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          <SearchableSelect
            className="flex-1 min-w-0"
            value={choice}
            onChange={setChoice}
            disabled={adding}
            aria-label={`Link a ${platform} store to this channel`}
            placeholder={current.length > 0 ? `Link another ${platform} store` : `Link a ${platform} store`}
            searchPlaceholder="Search stores by name or address"
            emptyText="No store matches your search"
            options={available.map((s) => ({
              value: String(s.id),
              label: s.name,
              description: s.address,
              badge: s.status !== 'connected' ? { text: 'Reconnect needed', tone: 'warning' as const } : undefined,
            }))}
          />
          <button
            type="button"
            onClick={add}
            disabled={adding || !choice}
            className="shrink-0 inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold text-white bg-[#3440a8] hover:bg-[#2b358c] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {adding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5" />}
            {adding ? 'Linking…' : 'Link store'}
          </button>
        </div>
      )}
    </div>
  );
}
