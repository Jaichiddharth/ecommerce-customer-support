'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import apiClient from '@/lib/api/client';
import { ApiError, toApiError } from '@/lib/api/api-error';
import { ErrorState } from '@/components/ui/states';
import { formatShopifyPrice as formatPrice } from '@/lib/shopify/product-message';
import type { WooCommerceChannelStore, WooContactOrders, WooOrderSummary } from '@/lib/woocommerce/types';

/** WooCommerce order statuses → label and colour */
const STATUS: Record<string, { label: string; className: string }> = {
  pending: { label: 'Pending payment', className: 'bg-amber-50 text-amber-700' },
  processing: { label: 'Processing', className: 'bg-[#eef0fb] text-[#3440a8]' },
  'on-hold': { label: 'On hold', className: 'bg-amber-50 text-amber-700' },
  completed: { label: 'Completed', className: 'bg-emerald-50 text-emerald-700' },
  cancelled: { label: 'Cancelled', className: 'bg-red-50 text-red-600' },
  refunded: { label: 'Refunded', className: 'bg-slate-100 text-slate-600' },
  failed: { label: 'Failed', className: 'bg-red-50 text-red-600' },
  'checkout-draft': { label: 'Draft', className: 'bg-slate-100 text-slate-600' },
};

const statusOf = (status: string) =>
  STATUS[status] ?? { label: status.charAt(0).toUpperCase() + status.slice(1).replace(/-/g, ' '), className: 'bg-slate-100 text-slate-600' };

const WooOrderCard: React.FC<{ order: WooOrderSummary }> = ({ order }) => {
  const state = statusOf(order.status);
  return (
    <li className="block rounded-lg border border-slate-200 p-2.5 text-xs space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <a
          href={order.adminUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold text-slate-900 hover:text-[#3440a8] inline-flex items-center gap-1"
          title="Open in WooCommerce admin"
        >
          #{order.number} <ExternalLink className="w-3 h-3" />
        </a>
        <span className="text-slate-800 font-medium">{formatPrice(order.total, order.currencyCode)}</span>
      </div>
      {order.createdAt && (
        <p className="text-[11px] text-slate-500">{new Date(order.createdAt).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}</p>
      )}
      <span className={`inline-block px-1.5 py-0.5 rounded text-[10.5px] font-medium ${state.className}`}>{state.label}</span>
      {order.items.length > 0 && (
        <ul className="pt-1 space-y-1 border-t border-slate-100">
          {order.items.slice(0, 5).map((item, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="min-w-0 flex-1 text-slate-800 truncate">{item.name}</span>
              <span className="text-slate-500 shrink-0">× {item.quantity}</span>
            </li>
          ))}
          {order.items.length > 5 && <li className="text-[11px] text-slate-400">More items in WooCommerce admin</li>}
        </ul>
      )}
    </li>
  );
};

/**
 * The contact's orders in the WooCommerce store picked in the inbox's switcher. WooCommerce has no customer link
 * like Shopify: orders are matched by the billing email or phone number of the contact (and its linked identities).
 */
export const WooOrdersSection: React.FC<{
  contact: { id: number; email: string | null; phone: string | null };
  store: WooCommerceChannelStore;
}> = ({ contact, store }) => {
  const [data, setData] = useState<WooContactOrders | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    setIsLoading(true);
    setError(null);
    try {
      const res = await apiClient.get(`/api/integrations/woocommerce/contacts/${contact.id}/orders`, { params: { storeId: store.id } });
      if (mine === seq.current) setData(res.data as WooContactOrders);
    } catch (err) {
      if (mine === seq.current) setError(toApiError(err));
    } finally {
      if (mine === seq.current) setIsLoading(false);
    }
  }, [contact.id, store.id]);

  useEffect(() => {
    setData(null);
    if (store.status === 'connected') load();
  }, [load, store.status]);

  const box = (children: React.ReactNode) => (
    <div className="mt-2.5 rounded-lg bg-slate-100/80 px-3 py-2.5 text-xs text-slate-600 leading-relaxed">{children}</div>
  );
  const storeName = store.name || store.storeHost;

  if (store.status !== 'connected') return box(`The connection to ${storeName} has expired. Reconnect the store from Integrations to see orders.`);
  if (error) return <ErrorState error={error} title="Couldn't load orders" compact onRetry={load} />;
  if (!data) {
    return (
      <div className="mt-2.5 flex items-center gap-2 text-xs text-slate-400">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Looking up orders in {storeName}…
      </div>
    );
  }
  if (!contact.email && !contact.phone && data.matchedBy === null && data.orders.length === 0) {
    return box('This contact has no email or phone number to match WooCommerce orders with.');
  }

  return (
    <div className="mt-2.5 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-slate-500 truncate">
          {data.orders.length === 0
            ? `No orders in ${storeName} with this contact's email or phone number.`
            : `${data.orders.length} ${data.orders.length === 1 ? 'order' : 'orders'} matched by ${
                data.matchedBy === 'email' ? 'email' : data.matchedBy === 'phone' ? 'phone number' : 'email and phone'
              }`}
        </p>
        <button
          type="button"
          onClick={load}
          disabled={isLoading}
          title="Refresh orders"
          aria-label="Refresh orders"
          className="shrink-0 p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>
      {data.orders.length > 0 && (
        <ul className="space-y-2">
          {data.orders.map((order) => (
            <WooOrderCard key={order.id} order={order} />
          ))}
        </ul>
      )}
    </div>
  );
};
