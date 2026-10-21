'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { ExternalLink, Link2Off, Loader2, ShoppingBag, UserSearch } from 'lucide-react';
import apiClient from '@/lib/api/client';
import { ApiError, toApiError } from '@/lib/api/api-error';
import { notifyError } from '@/lib/api/notify';
import { gooeyToast } from '@/components/ui/goey-toaster';
import { Modal } from '@/components/ui/Modal';
import { ErrorState } from '@/components/ui/states';
import { formatShopifyPrice } from '@/lib/shopify/product-message';
import type { ShopifyContactOrdersResponse, ShopifyOrder } from '@/lib/shopify/types';
import { LinkCustomerModal } from './LinkCustomerModal';

interface ShopifyOrdersSectionProps {
  contact: { id: number; name: string; email: string | null; phone: string | null };
  /** From useShopifyStore: whether a store is connected and usable */
  storeConnected: boolean;
  storeNeedsReauth: boolean;
}

/** "PARTIALLY_FULFILLED" → "Partially fulfilled" */
const humanize = (value: string | null) =>
  value ? value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, ' ') : null;

function orderState(order: ShopifyOrder) {
  if (order.cancelledAt) return { label: 'Cancelled', className: 'bg-red-50 text-red-600' };
  if (order.closed) return { label: 'Archived', className: 'bg-slate-100 text-slate-600' };
  return { label: 'Open', className: 'bg-[#eef0fb] text-[#3440a8]' };
}

const OrderCard: React.FC<{ order: ShopifyOrder }> = ({ order }) => {
  const state = orderState(order);
  return (
    <li className="rounded-lg border border-slate-200 p-2.5 text-xs space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <a
          href={order.adminUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold text-slate-900 hover:text-[#3440a8] inline-flex items-center gap-1"
          title="Open in Shopify admin"
        >
          {order.name} <ExternalLink className="w-3 h-3" />
        </a>
        <span className="text-slate-800 font-medium">
          {order.total ? formatShopifyPrice(order.total.amount, order.total.currencyCode) : '—'}
        </span>
      </div>
      <p className="text-[11px] text-slate-500">
        {new Date(order.createdAt).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}
      </p>
      <div className="flex flex-wrap gap-1">
        <span className={`px-1.5 py-0.5 rounded text-[10.5px] font-medium ${state.className}`}>{state.label}</span>
        {order.financialStatus && (
          <span className="px-1.5 py-0.5 rounded text-[10.5px] bg-slate-100 text-slate-700">{humanize(order.financialStatus)}</span>
        )}
        {order.fulfillmentStatus && (
          <span className="px-1.5 py-0.5 rounded text-[10.5px] bg-slate-100 text-slate-700">{humanize(order.fulfillmentStatus)}</span>
        )}
      </div>
      <ul className="pt-1 space-y-1 border-t border-slate-100">
        {order.lineItems.map((li) => (
          <li key={li.id} className="flex items-start gap-2">
            {li.imageUrl ? (
              <img src={li.imageUrl} alt="" className="w-7 h-7 rounded object-cover shrink-0" />
            ) : (
              <span className="w-7 h-7 rounded bg-slate-100 shrink-0" />
            )}
            <span className="min-w-0 flex-1">
              <span className="block text-slate-800 truncate">{li.title}</span>
              {li.variantTitle && <span className="block text-[11px] text-slate-500 truncate">{li.variantTitle}</span>}
            </span>
            <span className="text-slate-500 shrink-0">× {li.quantity}</span>
          </li>
        ))}
        {order.moreLineItems && <li className="text-[11px] text-slate-400">More items in Shopify admin</li>}
      </ul>
    </li>
  );
};

export const ShopifyOrdersSection: React.FC<ShopifyOrdersSectionProps> = ({ contact, storeConnected, storeNeedsReauth }) => {
  const [data, setData] = useState<Omit<ShopifyContactOrdersResponse, 'success'> | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [showUnlinkConfirm, setShowUnlinkConfirm] = useState(false);
  const [isUnlinking, setIsUnlinking] = useState(false);

  const load = useCallback(
    async (after?: string | null) => {
      if (after) setIsLoadingMore(true);
      else setIsLoading(true);
      try {
        const res = await apiClient.get(`/api/integrations/shopify/contacts/${contact.id}/orders`, { params: { after: after || undefined } });
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
    [contact.id]
  );

  useEffect(() => {
    setData(null);
    setError(null);
    if (storeConnected) load();
  }, [storeConnected, load]);

  const handleUnlink = async () => {
    setIsUnlinking(true);
    try {
      await apiClient.delete(`/api/integrations/shopify/contacts/${contact.id}/link`);
      gooeyToast.success('Shopify customer unlinked');
      setShowUnlinkConfirm(false);
      load();
    } catch (err) {
      notifyError(err, { where: 'ShopifyOrdersSection.handleUnlink', title: 'Customer not unlinked' });
    } finally {
      setIsUnlinking(false);
    }
  };

  const box = (children: React.ReactNode) => (
    <div className="mt-2.5 rounded-lg bg-slate-100/80 px-3 py-2.5 text-xs text-slate-600 leading-relaxed">{children}</div>
  );

  let body: React.ReactNode;
  if (storeNeedsReauth) {
    body = box('The Shopify connection has expired. Reconnect the store from the Store page to see orders.');
  } else if (!storeConnected) {
    body = box(
      <span className="flex items-start gap-2">
        <ShoppingBag className="w-4 h-4 shrink-0 text-slate-400 mt-0.5" />
        Connect your Shopify store from the Store page to see this customer&apos;s orders and share products.
      </span>
    );
  } else if (error) {
    body = <ErrorState error={error} title="Couldn't load orders" compact onRetry={() => load()} />;
  } else if (isLoading || !data) {
    body = (
      <div className="mt-2.5 flex items-center gap-2 text-xs text-slate-400">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading orders…
      </div>
    );
  } else if (!data.link) {
    body = (
      <>
        {box('This contact isn’t linked to a Shopify customer yet. Link them to see their order history.')}
        <button
          type="button"
          onClick={() => setShowLinkModal(true)}
          className="mt-2 w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 text-[12.5px] font-semibold text-slate-800 hover:bg-slate-50 cursor-pointer"
        >
          <UserSearch className="w-4 h-4" /> Find Shopify customer
        </button>
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
            </>
          ) : (
            <p className="text-amber-700">The linked Shopify customer no longer exists. Link another customer.</p>
          )}
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

        {customer && data.orders.items.length === 0 && box('No orders for this customer yet.')}
        {data.orders.items.length > 0 && (
          <ul className="space-y-2">
            {data.orders.items.map((order) => (
              <OrderCard key={order.id} order={order} />
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
      {body}
      <LinkCustomerModal
        isOpen={showLinkModal}
        onClose={() => setShowLinkModal(false)}
        contact={contact}
        currentShopifyCustomerId={data?.link?.shopifyCustomerId ?? null}
        onLinked={() => load()}
      />
      <Modal isOpen={showUnlinkConfirm} onClose={() => setShowUnlinkConfirm(false)} title="Unlink Shopify customer?" maxWidth="sm">
        <p className="text-xs text-slate-600">
          {contact.name} will no longer show orders from {data?.shopifyCustomer?.displayName ?? 'this Shopify customer'}. Nothing changes in
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
