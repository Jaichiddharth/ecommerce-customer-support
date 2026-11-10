'use client';

import React from 'react';
import Link from 'next/link';
import { Link2, Plus, RefreshCw, ShoppingBag } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

/** Settings → Channels with this number's card open on its "Shopify store" picker */
export const channelStoreSettingsHref = (channelId: number) => `/settings?channel=${channelId}&focus=shopify`;

const buttonClass =
  'mt-2.5 w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-[#3440a8] hover:bg-[#2b3590] text-white text-[12.5px] font-semibold';

/**
 * Inbox side panel, when the conversation's WhatsApp number has no Shopify store (there is no default store):
 *  - the workspace has no store at all → "Connect store" opens the Shopify connections page;
 *  - it has stores, but none is associated with this number → "Associate store" opens this number's store picker
 *    in Settings → Channels.
 * Members who can't manage integrations are told to ask an admin instead.
 */
export const ChannelStoreSetup: React.FC<{
  channelId: number | null;
  hasStores: boolean;
  what: string;
  /** The store check failed: we don't know whether there are stores, so offer a retry instead of a wrong prompt */
  failed?: boolean;
  onRetry?: () => void;
}> = ({ channelId, hasStores, what, failed, onRetry }) => {
  const { hasPermission, can } = useAuth();
  const canManage = hasPermission('manage_billing_and_integrations');
  const canConnect = canManage && can('integrations', 'create');
  const canAssociate = canManage && can('integrations', 'read');

  if (failed) {
    return (
      <div className="mt-2.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-600 leading-relaxed">
        <p className="flex items-start gap-2">
          <ShoppingBag className="w-4 h-4 shrink-0 text-slate-400 mt-0.5" />
          <span>
            <span className="font-semibold text-slate-800">Couldn&apos;t check this number&apos;s Shopify store.</span> Check your connection
            and try again.
          </span>
        </p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-2.5 w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 text-[12.5px] font-semibold cursor-pointer"
          >
            <RefreshCw className="w-4 h-4" /> Try again
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="mt-2.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-600 leading-relaxed">
      <p className="flex items-start gap-2">
        <ShoppingBag className="w-4 h-4 shrink-0 text-slate-400 mt-0.5" />
        <span>
          {hasStores ? (
            <>
              <span className="font-semibold text-slate-800">No store associated with this number.</span> Associate one of your Shopify stores
              with this WhatsApp number to {what}.
            </>
          ) : (
            <>
              <span className="font-semibold text-slate-800">No Shopify store connected.</span> Connect your Shopify store, then associate it with
              this WhatsApp number to {what}.
            </>
          )}
        </span>
      </p>

      {hasStores ? (
        canAssociate && channelId !== null ? (
          <Link href={channelStoreSettingsHref(channelId)} className={buttonClass}>
            <Link2 className="w-4 h-4" /> Associate store
          </Link>
        ) : (
          <p className="mt-2 text-[11px] text-slate-500">Ask a workspace admin to associate a store with this number.</p>
        )
      ) : canConnect ? (
        <Link href="/integrations/shopify" className={buttonClass}>
          <Plus className="w-4 h-4" /> Connect store
        </Link>
      ) : (
        <p className="mt-2 text-[11px] text-slate-500">Ask a workspace admin to connect your Shopify store.</p>
      )}
    </div>
  );
};
