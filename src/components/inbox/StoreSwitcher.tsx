'use client';

import React from 'react';
import { SearchableSelect } from '../ui/SearchableSelect';
import { PLATFORM_LABEL, type ConversationStore } from './useConversationStores';

/**
 * Picks which of the number's stores (Shopify or WooCommerce) the panel's products, customer and orders come from.
 * With a single store it just names it.
 */
export const StoreSwitcher: React.FC<{
  stores: ConversationStore[];
  selected: ConversationStore;
  onSelect: (key: string) => void;
  /** "Products from", "Orders from" */
  prefix: string;
}> = ({ stores, selected, onSelect, prefix }) =>
  stores.length > 1 ? (
    <SearchableSelect
      size="sm"
      value={selected.key}
      onChange={onSelect}
      aria-label="Store for this conversation"
      searchPlaceholder="Search this number's stores"
      emptyText="No store matches your search"
      options={stores.map((s) => ({
        value: s.key,
        label: s.name,
        description: `${PLATFORM_LABEL[s.platform]} · ${s.address}`,
        keywords: PLATFORM_LABEL[s.platform],
        badge:
          s.status !== 'connected'
            ? { text: 'Reconnect needed', tone: 'warning' as const }
            : { text: PLATFORM_LABEL[s.platform], tone: 'neutral' as const },
      }))}
    />
  ) : (
    <p className="text-[11px] text-slate-400 truncate" title={selected.address}>
      {prefix} {selected.name} · {PLATFORM_LABEL[selected.platform]}
    </p>
  );
