'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { ExternalLink, Link2, Receipt, UserRound } from 'lucide-react';
import apiClient from '@/lib/api/client';
import { ApiError, toApiError } from '@/lib/api/api-error';
import { notifyError } from '@/lib/api/notify';
import { Modal } from '@/components/ui/Modal';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { formatShopifyPrice } from '@/lib/shopify/product-message';
import type { ShopifyCustomerOrdersPage } from '@/lib/shopify/types';
import { ShopifyCustomerTags } from '../ShopifyCustomerTags';
import { ShopifyOrderCard } from '../ShopifyOrderCard';
import { LoadMoreButton, formatDate } from '../ShopifyPageChrome';

/**
 * The customer has orders, but none Shopify lets the app read: without the read_all_orders permission only
 * orders from the last 60 days are returned (the order count and last order still include older ones).
 */
export const OlderOrdersNotice: React.FC<{ count: number }> = ({ count }) => (
  <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5 text-xs text-amber-800 space-y-1">
    <p className="font-semibold">
      {count} order{count === 1 ? '' : 's'}, all older than 60 days
    </p>
    <p className="leading-relaxed">
      Shopify only shares orders from the last 60 days with this app. Older orders appear here once the Shopify app is published with
      Public distribution and Shopify approves the <span className="font-mono">read_all_orders</span> permission. Until then, open the
      customer in Shopify admin to see them.
    </p>
  </div>
);

/** The customer whose orders are shown; what the list already knows, so the header shows while loading */
export interface CustomerRef {
  legacyId: string;
  displayName: string;
  linkedContact?: { id: number; name: string } | null;
}

/** A store customer with their orders (newest first, 10 at a time) */
export const CustomerOrdersModal: React.FC<{ storeId: number; shopDomain: string; customer: CustomerRef | null; onClose: () => void }> = ({
  storeId,
  shopDomain,
  customer,
  onClose,
}) => {
  const [data, setData] = useState<ShopifyCustomerOrdersPage | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const legacyId = customer?.legacyId ?? null;

  const load = useCallback(
    async (after?: string | null) => {
      if (!legacyId) return;
      if (after) setIsLoadingMore(true);
      try {
        const res = await apiClient.get(`/api/integrations/shopify/stores/${storeId}/customers/${legacyId}/orders`, {
          params: { after: after || undefined },
        });
        const next = res.data as ShopifyCustomerOrdersPage;
        setData((prev) =>
          after && prev ? { ...next, orders: { ...next.orders, items: [...prev.orders.items, ...next.orders.items] } } : next
        );
        setError(null);
      } catch (err) {
        if (after) notifyError(err, { where: 'CustomerOrdersModal.loadMore', title: "Couldn't load more orders" });
        else setError(toApiError(err));
      } finally {
        setIsLoadingMore(false);
      }
    },
    [storeId, legacyId]
  );

  useEffect(() => {
    setData(null);
    setError(null);
    load();
  }, [load]);

  const c = data?.customer;

  return (
    <Modal
      isOpen={customer !== null}
      onClose={onClose}
      title={customer?.displayName ?? 'Customer'}
      icon={<UserRound className="w-4 h-4 text-slate-700" />}
      maxWidth="2xl"
    >
      {customer && (
        <div className="space-y-4">
          {c && (
            <div className="rounded-lg border border-slate-200 p-3 text-xs grid sm:grid-cols-2 gap-x-6 gap-y-2">
              <div className="min-w-0">
                <p className="text-slate-500">Contact</p>
                <p className="text-slate-800 truncate">{c.email || '—'}</p>
                {c.phone && <p className="text-slate-800">{c.phone}</p>}
              </div>
              <div>
                <p className="text-slate-500">Orders · Amount spent</p>
                <p className="text-slate-800">
                  {c.numberOfOrders} · {c.amountSpent ? formatShopifyPrice(c.amountSpent.amount, c.amountSpent.currencyCode) : '—'}
                </p>
              </div>
              <div>
                <p className="text-slate-500">Customer since</p>
                <p className="text-slate-800">{formatDate(c.createdAt)}</p>
              </div>
              <div className="min-w-0">
                <p className="text-slate-500">UnoCX contact</p>
                {customer.linkedContact ? (
                  <p className="text-emerald-700 font-medium inline-flex items-center gap-1">
                    <Link2 className="w-3 h-3" /> {customer.linkedContact.name}
                  </p>
                ) : (
                  <p className="text-slate-400">Not linked</p>
                )}
              </div>
              {c.tags.length > 0 && (
                <div className="sm:col-span-2">
                  <p className="text-slate-500 mb-1">Tags</p>
                  <ShopifyCustomerTags tags={c.tags} />
                </div>
              )}
              <a
                href={`https://${shopDomain}/admin/customers/${customer.legacyId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="sm:col-span-2 inline-flex items-center gap-1 font-semibold text-slate-700 hover:underline"
              >
                Open customer in Shopify admin <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          )}

          {error ? (
            <ErrorState error={error} title="Couldn't load this customer's orders" compact onRetry={() => load()} />
          ) : !data ? (
            <LoadingState label="Loading orders…" compact />
          ) : !c ? (
            <EmptyState title="Customer not found" description="This customer no longer exists in the store." compact />
          ) : data.orders.items.length === 0 && c.numberOfOrders > 0 ? (
            // Shopify counts every order, but only returns the last 60 days without the read_all_orders permission
            <OlderOrdersNotice count={c.numberOfOrders} />
          ) : data.orders.items.length === 0 ? (
            <EmptyState icon={<Receipt className="w-5 h-5" />} title="No orders yet" description="This customer hasn't ordered from the store." compact />
          ) : (
            <>
              <p className="text-xs font-semibold text-slate-700">Orders</p>
              <ul className="space-y-2">
                {data.orders.items.map((order) => (
                  <ShopifyOrderCard key={order.id} order={order} />
                ))}
              </ul>
              {data.orders.hasNextPage && (
                <LoadMoreButton onClick={() => load(data.orders.endCursor)} loading={isLoadingMore} label="Load more orders" />
              )}
            </>
          )}
        </div>
      )}
    </Modal>
  );
};
