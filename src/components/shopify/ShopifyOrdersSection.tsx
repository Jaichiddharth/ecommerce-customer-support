'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Link2Off, Loader2, Sparkles, UserSearch } from 'lucide-react';
import apiClient from '@/lib/api/client';
import { ApiError, toApiError } from '@/lib/api/api-error';
import { notifyError } from '@/lib/api/notify';
import { gooeyToast } from '@/components/ui/goey-toaster';
import { Modal } from '@/components/ui/Modal';
import { ErrorState } from '@/components/ui/states';
import { formatShopifyPrice } from '@/lib/shopify/product-message';
import type { ShopifyAutoMatchStatus, ShopifyChannelStore, ShopifyContactOrdersResponse, ShopifyCustomerSummary } from '@/lib/shopify/types';
import { LinkCustomerModal } from './LinkCustomerModal';
import { ShopifyOrderCard } from './ShopifyOrderCard';
import { ShopifyCustomerTags } from './ShopifyCustomerTags';
import { OlderOrdersNotice } from './store/CustomerOrdersModal';
import { ChannelStoreSetup } from './ChannelStoreSetup';
import { useRealtime } from '@/lib/hooks/useRealtime';

interface ShopifyOrdersSectionProps {
  contact: { id: number; name: string; email: string | null; phone: string | null };
  /** The store the conversation's WhatsApp number is connected to (the Shopify store picked in the inbox, useConversationStores); null: none */
  store: ShopifyChannelStore | null;
  storeLoading: boolean;
  /** For the "Connect store" / "Associate store" prompt when the number has no store */
  channelId: number | null;
  hasStores: boolean;
  /** The store check failed; offer a retry instead of the connect/associate prompt */
  storeCheckFailed?: boolean;
  onRetryStoreCheck?: () => void;
}

/** What the panel says when automatic matching found no single customer */
const UNLINKED_MESSAGES: Record<ShopifyAutoMatchStatus, string> = {
  none: 'No Shopify customer has this contact’s phone number or email. Search by name, email or order number to link one.',
  review: 'Several Shopify customers match this contact. Choose the right one.',
  dismissed: 'Not linked to a Shopify customer. Search by name, email or order number to link one.',
  no_details: 'This contact has no phone number or email to match. Search by name, email or order number to link one.',
};

export const ShopifyOrdersSection: React.FC<ShopifyOrdersSectionProps> = ({
  contact,
  store,
  storeLoading,
  channelId,
  hasStores,
  storeCheckFailed,
  onRetryStoreCheck,
}) => {
  const storeId = store?.id;
  const storeConnected = store?.status === 'connected';
  const storeNeedsReauth = store?.status === 'reauth_required';
  const [data, setData] = useState<Omit<ShopifyContactOrdersResponse, 'success'> | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [showUnlinkConfirm, setShowUnlinkConfirm] = useState(false);
  const [isUnlinking, setIsUnlinking] = useState(false);
  const [linkingId, setLinkingId] = useState<string | null>(null);

  const load = useCallback(
    async (after?: string | null) => {
      if (after) setIsLoadingMore(true);
      else setIsLoading(true);
      try {
        const res = await apiClient.get(`/api/integrations/shopify/contacts/${contact.id}/orders`, {
          params: { after: after || undefined, storeId },
        });
        const next = res.data as ShopifyContactOrdersResponse;
        setData((prev) =>
          after && prev ? { ...next, orders: { ...next.orders, items: [...prev.orders.items, ...next.orders.items] } } : next
        );
        setError(null);
      } catch (err) {
        if (after) notifyError(err, { where: 'ShopifyOrdersSection.loadMore', title: "Couldn't load more orders" });
        else setError(toApiError(err));
      } finally {
        setIsLoading(false);
        setIsLoadingMore(false);
      }
    },
    [contact.id, storeId]
  );

  useEffect(() => {
    setData(null);
    setError(null);
    if (storeConnected) load();
  }, [storeConnected, load]);

  // Real-time updates: listen for Shopify order webhooks and update orders without refresh
  const handleLiveRefresh = useCallback(() => {
    if (storeConnected) {
      load();
    }
  }, [storeConnected, load]);

  useRealtime({
    onShopifyOrderCreated: (event) => {
      const match = !event.storeId || !storeId || String(event.storeId) === String(storeId) || event.shopDomain === store?.shopDomain;
      if (match) {
        handleLiveRefresh();
        if (event.order?.orderNumber) {
          gooeyToast.success(`Shopify: New order ${event.order.orderNumber} received`);
        }
      }
    },
    onShopifyOrderUpdated: (event) => {
      const match = !event.storeId || !storeId || String(event.storeId) === String(storeId) || event.shopDomain === store?.shopDomain;
      if (match) {
        handleLiveRefresh();
      }
    },
  });

  // Global window event listener so updates apply even if individual hook connection is delayed
  useEffect(() => {
    const onShopifyEvent = () => {
      handleLiveRefresh();
    };
    window.addEventListener('shopify:realtime', onShopifyEvent);
    window.addEventListener('shopify:order:created', onShopifyEvent);
    window.addEventListener('shopify:order:updated', onShopifyEvent);
    return () => {
      window.removeEventListener('shopify:realtime', onShopifyEvent);
      window.removeEventListener('shopify:order:created', onShopifyEvent);
      window.removeEventListener('shopify:order:updated', onShopifyEvent);
    };
  }, [handleLiveRefresh]);

  const handleUnlink = async () => {
    setIsUnlinking(true);
    try {
      await apiClient.delete(`/api/integrations/shopify/contacts/${contact.id}/link`, { params: { storeId } });
      gooeyToast.success('Shopify customer unlinked');
      setShowUnlinkConfirm(false);
      load();
    } catch (err) {
      notifyError(err, { where: 'ShopifyOrdersSection.handleUnlink', title: 'Customer not unlinked' });
    } finally {
      setIsUnlinking(false);
    }
  };

  /** Links one of the customers automatic matching found */
  const handleLinkCandidate = async (candidate: ShopifyCustomerSummary) => {
    setLinkingId(candidate.id);
    try {
      await apiClient.put(`/api/integrations/shopify/contacts/${contact.id}/link`, { shopifyCustomerId: candidate.id, storeId });
      gooeyToast.success(`${contact.name} is now linked to ${candidate.displayName}`);
      load();
    } catch (err) {
      notifyError(err, { where: 'ShopifyOrdersSection.handleLinkCandidate', title: 'Customer not linked' });
    } finally {
      setLinkingId(null);
    }
  };

  const box = (children: React.ReactNode) => (
    <div className="mt-2.5 rounded-lg bg-slate-100/80 px-3 py-2.5 text-xs text-slate-600 leading-relaxed">{children}</div>
  );

  const searchButton = (
    <button
      type="button"
      onClick={() => setShowLinkModal(true)}
      className="mt-2 w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 text-[12.5px] font-semibold text-slate-800 hover:bg-slate-50 cursor-pointer"
    >
      <UserSearch className="w-4 h-4" /> Search customers or orders
    </button>
  );

  let body: React.ReactNode;
  if (storeLoading) {
    body = (
      <div className="mt-2.5 flex items-center gap-2 text-xs text-slate-400">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Checking this number&apos;s Shopify store…
      </div>
    );
  } else if (!store) {
    body = (
      <ChannelStoreSetup
        channelId={channelId}
        hasStores={hasStores}
        what="see this customer's orders"
        failed={storeCheckFailed}
        onRetry={onRetryStoreCheck}
      />
    );
  } else if (storeNeedsReauth) {
    body = box(`The connection to ${store.name || store.shopDomain} has expired. Reconnect the store from Integrations to see orders.`);
  } else if (error) {
    body = <ErrorState error={error} title="Couldn't load orders" compact onRetry={() => load()} />;
  } else if (isLoading || !data) {
    body = (
      <div className="mt-2.5 flex items-center gap-2 text-xs text-slate-400">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Looking up Shopify customer…
      </div>
    );
  } else if (!data.link) {
    const match = data.autoMatch ?? { status: 'none' as const, candidates: [] };
    body = (
      <>
        {box(
          match.status === 'review' && match.candidates.length === 1
            ? 'A Shopify customer has this contact’s phone number or email, but is linked to another contact. Link it here only if it’s the same person.'
            : UNLINKED_MESSAGES[match.status]
        )}
        {match.candidates.length > 0 && (
          <ul className="mt-2 space-y-1.5">
            {match.candidates.map((c) => (
              <li key={c.id} className="rounded-lg border border-slate-200 px-2.5 py-2 text-xs flex items-start gap-2">
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-slate-900 truncate">{c.displayName}</span>
                  <span className="block text-slate-600 truncate">{c.email || c.phone}</span>
                  <span className="block text-[11px] text-slate-400">
                    {c.numberOfOrders} order{c.numberOfOrders === 1 ? '' : 's'}
                  </span>
                  <ShopifyCustomerTags tags={c.tags} className="mt-1" />
                </span>
                <button
                  type="button"
                  onClick={() => handleLinkCandidate(c)}
                  disabled={linkingId !== null}
                  className="shrink-0 px-2 py-1 rounded-md bg-[#3440a8] hover:bg-[#2b3590] text-white text-[11px] font-semibold cursor-pointer disabled:opacity-50 inline-flex items-center gap-1"
                >
                  {linkingId === c.id && <Loader2 className="w-3 h-3 animate-spin" />} Link
                </button>
              </li>
            ))}
          </ul>
        )}
        {searchButton}
      </>
    );
  } else {
    const customer = data.shopifyCustomer;
    body = (
      <div className="mt-2.5 space-y-2.5">
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2 text-xs">
          {customer ? (
            <>
              <p className="font-semibold text-slate-900 truncate">{customer.displayName}</p>
              <p className="text-slate-600 truncate">{customer.email || customer.phone || `ID ${customer.legacyId}`}</p>
              <p className="text-[11px] text-slate-500">
                {customer.numberOfOrders} order{customer.numberOfOrders === 1 ? '' : 's'}
                {customer.amountSpent ? ` · ${formatShopifyPrice(customer.amountSpent.amount, customer.amountSpent.currencyCode)} spent` : ''}
              </p>
              <ShopifyCustomerTags tags={customer.tags} className="mt-1" />
            </>
          ) : (
            <p className="text-amber-700">The linked Shopify customer no longer exists. Link another customer.</p>
          )}
          <p className="mt-1 text-[11px] text-slate-500 flex items-center gap-1">
            {data.link.source === 'auto' ? (
              <>
                <Sparkles className="w-3 h-3 text-emerald-600" /> Matched by phone number or email
              </>
            ) : (
              `Linked${data.link.linkedByName ? ` by ${data.link.linkedByName}` : ''}`
            )}
          </p>
          <div className="mt-1.5 flex gap-3 text-[11.5px] font-semibold">
            <button type="button" onClick={() => setShowLinkModal(true)} className="text-[#3440a8] hover:underline cursor-pointer">
              Change
            </button>
            <button
              type="button"
              onClick={() => setShowUnlinkConfirm(true)}
              className="text-slate-500 hover:text-red-600 cursor-pointer inline-flex items-center gap-1"
            >
              <Link2Off className="w-3 h-3" /> Unlink
            </button>
          </div>
        </div>

        {customer && data.orders.items.length === 0 && customer.numberOfOrders > 0 && <OlderOrdersNotice count={customer.numberOfOrders} />}
        {customer && data.orders.items.length === 0 && customer.numberOfOrders === 0 && box('No orders for this customer yet.')}
        {data.orders.items.length > 0 && (
          <ul className="space-y-2">
            {data.orders.items.map((order) => (
              <ShopifyOrderCard key={order.id} order={order} />
            ))}
          </ul>
        )}
        {data.orders.hasNextPage && (
          <button
            type="button"
            onClick={() => load(data.orders.endCursor)}
            disabled={isLoadingMore}
            className="w-full py-1.5 text-xs font-semibold text-[#3440a8] rounded-lg hover:bg-[#eef0fb] cursor-pointer disabled:opacity-60"
          >
            {isLoadingMore ? 'Loading…' : 'Load more orders'}
          </button>
        )}
      </div>
    );
  }

  return (
    <>
      {store && !storeLoading && (
        <p className="mt-1 text-[11px] text-slate-400 truncate" title={store.shopDomain}>
          From {store.name || store.shopDomain}
        </p>
      )}
      {body}
      <LinkCustomerModal
        isOpen={showLinkModal}
        onClose={() => setShowLinkModal(false)}
        contact={contact}
        currentShopifyCustomerId={data?.link?.shopifyCustomerId ?? null}
        store={store}
        onLinked={() => load()}
      />
      <Modal isOpen={showUnlinkConfirm} onClose={() => setShowUnlinkConfirm(false)} title="Unlink Shopify customer?" maxWidth="sm">
        <p className="text-xs text-slate-600">
          {contact.name} and their other channels will no longer show orders from{' '}
          {data?.shopifyCustomer?.displayName ?? 'this Shopify customer'}, and won&apos;t be matched automatically again. Nothing changes in
          Shopify, and you can link again at any time.
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setShowUnlinkConfirm(false)}
            className="px-3 py-2 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleUnlink}
            disabled={isUnlinking}
            className="px-3 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold cursor-pointer disabled:opacity-60 inline-flex items-center gap-1.5"
          >
            {isUnlinking && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Unlink
          </button>
        </div>
      </Modal>
    </>
  );
};
