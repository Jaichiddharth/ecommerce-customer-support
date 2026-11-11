'use client';

import React from 'react';
import { Info } from 'lucide-react';

export type ShopifyAppDistribution = 'private' | 'public';

/** Without read_all_orders, Shopify only returns orders created in the last 60 days */
export const hasFullOrderHistory = (scopes: string[] | undefined) => Boolean(scopes?.includes('read_all_orders'));

/**
 * The store connection areas (Connections tab, Connect a store): which stores can connect while the app is private,
 * and what publishing changes. Public apps only get a note when order history is still limited.
 */
export const ShopifyAppAccessNote: React.FC<{
  distribution: ShopifyAppDistribution;
  limitedStores?: number;
  className?: string;
}> = ({ distribution, limitedStores = 0, className = '' }) => {
  if (distribution === 'public' && limitedStores === 0) return null;
  return (
    <div className={`flex items-start gap-2.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 ${className}`}>
      <Info className="w-4 h-4 text-slate-500 shrink-0 mt-px" />
      <p className="text-xs text-slate-600 leading-relaxed">
        {distribution === 'private' ? (
          <>
            <span className="font-semibold text-slate-900">Private app (non-embedded):</span> only stores in your own Shopify organization can
            connect, and orders are limited to the last 60 days. Once the app is published with Public distribution, external stores can connect
            too and full order history can be enabled.
          </>
        ) : (
          <>
            <span className="font-semibold text-slate-900">Orders are limited to the last 60 days</span> on {limitedStores} store
            {limitedStores === 1 ? '' : 's'} until Shopify approves the read_all_orders permission and the store is re-authorized.
          </>
        )}
      </p>
    </div>
  );
};

/** One-line note for order lists of a store without read_all_orders */
export const OrderHistoryNotice: React.FC<{ className?: string }> = ({ className = '' }) => (
  <p className={`text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2 leading-relaxed ${className}`}>
    <span className="font-semibold">Showing orders from the last 60 days only.</span> Older orders appear once the Shopify app is published with
    Public distribution and Shopify approves the <span className="font-mono">read_all_orders</span> permission.
  </p>
);
