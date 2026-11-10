'use client';

import React, { Fragment, useState } from 'react';
import { ChevronDown, ChevronRight, ExternalLink, Receipt } from 'lucide-react';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { formatShopifyPrice } from '@/lib/shopify/product-message';
import type { ShopifyOrderStatusFilter, ShopifyStoreOrder } from '@/lib/shopify/types';
import { LoadMoreButton, SearchInput, formatDate, humanize, selectClass, usePagedList } from '../ShopifyPageChrome';
import { CustomerOrdersModal, type CustomerRef } from './CustomerOrdersModal';
import { OrderHistoryNotice } from '../OrderHistoryNotice';

const STATUS_LABELS: Record<ShopifyOrderStatusFilter, string> = {
  any: 'All orders',
  open: 'Open',
  closed: 'Archived',
  cancelled: 'Cancelled',
};

function orderState(order: ShopifyStoreOrder) {
  if (order.cancelledAt) return { label: 'Cancelled', className: 'bg-red-50 text-red-600' };
  if (order.closed) return { label: 'Archived', className: 'bg-slate-100 text-slate-600' };
  return { label: 'Open', className: 'bg-[#eef0fb] text-[#3440a8]' };
}

const pill = (text: string | null, className = 'bg-slate-100 text-slate-700') =>
  text ? <span className={`inline-block px-1.5 py-0.5 rounded text-[10.5px] font-medium ${className}`}>{text}</span> : <span className="text-slate-400">—</span>;

/** The store's orders, newest first; a row expands to its items, the customer opens their order history */
export const StoreOrdersTab: React.FC<{ storeId: number; shopDomain: string; hasAllOrders: boolean }> = ({ storeId, shopDomain, hasAllOrders }) => {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<ShopifyOrderStatusFilter>('any');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [openCustomer, setOpenCustomer] = useState<CustomerRef | null>(null);

  const { page, isLoading, isLoadingMore, error, reload, loadMore } = usePagedList<ShopifyStoreOrder>(
    `/api/integrations/shopify/stores/${storeId}/orders`,
    { q: search.trim() || undefined, status },
    'StoreOrdersTab'
  );
  const filtered = Boolean(search.trim()) || status !== 'any';

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-2">
        <SearchInput value={search} onChange={setSearch} placeholder="Search by order number (#1001) or email" className="flex-1" />
        <select value={status} onChange={(e) => setStatus(e.target.value as ShopifyOrderStatusFilter)} className={`sm:w-44 ${selectClass}`}>
          {(Object.keys(STATUS_LABELS) as ShopifyOrderStatusFilter[]).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </div>
      {!hasAllOrders && <OrderHistoryNotice />}

      <div className="rounded-lg border border-slate-200 overflow-hidden">
        {error ? (
          <ErrorState error={error} title="Couldn't load orders" onRetry={reload} />
        ) : isLoading && !page ? (
          <LoadingState label="Loading orders…" />
        ) : page && page.items.length === 0 ? (
          <EmptyState
            icon={<Receipt className="w-5 h-5" />}
            title={filtered ? 'No order matches' : 'No orders yet'}
            description={filtered ? 'Try another order number, email or status.' : 'Orders placed in this store appear here.'}
          />
        ) : (
          <div className={`overflow-x-auto ${isLoading ? 'opacity-60' : ''}`}>
            <table className="w-full min-w-[820px] text-xs">
              <thead className="bg-slate-50 text-left text-[11px] font-semibold text-slate-500">
                <tr>
                  <th className="w-8" />
                  <th className="px-3 py-2.5">Order</th>
                  <th className="px-3 py-2.5">Date</th>
                  <th className="px-3 py-2.5">Customer</th>
                  <th className="px-3 py-2.5">Payment</th>
                  <th className="px-3 py-2.5">Fulfillment</th>
                  <th className="px-3 py-2.5 text-right">Items</th>
                  <th className="px-3 py-2.5 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {page?.items.map((o) => {
                  const isOpen = expanded === o.id;
                  const state = orderState(o);
                  const itemCount = o.lineItems.reduce((n, li) => n + li.quantity, 0);
                  return (
                    <Fragment key={o.id}>
                      <tr
                        onClick={() => setExpanded(isOpen ? null : o.id)}
                        className={`cursor-pointer hover:bg-slate-50 ${isOpen ? 'bg-slate-50' : ''}`}
                        aria-expanded={isOpen}
                      >
                        <td className="pl-3 py-3 text-slate-400">{isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}</td>
                        <td className="px-3 py-3">
                          <span className="font-semibold text-slate-900">{o.name}</span>{' '}
                          <span className={`ml-1 inline-block px-1.5 py-0.5 rounded text-[10.5px] font-medium ${state.className}`}>{state.label}</span>
                        </td>
                        <td className="px-3 py-3 text-slate-600 whitespace-nowrap">{formatDate(o.createdAt)}</td>
                        <td className="px-3 py-3 max-w-[200px]">
                          {o.customer ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setOpenCustomer({ legacyId: o.customer!.legacyId, displayName: o.customer!.displayName });
                              }}
                              className="text-left font-medium text-slate-800 hover:underline cursor-pointer truncate max-w-full block"
                              title="See this customer's orders"
                            >
                              {o.customer.displayName}
                            </button>
                          ) : (
                            <span className="text-slate-400">Guest</span>
                          )}
                        </td>
                        <td className="px-3 py-3">{pill(humanize(o.financialStatus))}</td>
                        <td className="px-3 py-3">{pill(humanize(o.fulfillmentStatus))}</td>
                        <td className="px-3 py-3 text-right tabular-nums text-slate-800">
                          {itemCount}
                          {o.moreLineItems ? '+' : ''}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums font-medium text-slate-900">
                          {o.total ? formatShopifyPrice(o.total.amount, o.total.currencyCode) : '—'}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="bg-slate-50/60">
                          <td />
                          <td colSpan={7} className="px-3 pb-3">
                            <ul className="space-y-1.5">
                              {o.lineItems.map((li) => (
                                <li key={li.id} className="flex items-center gap-2.5">
                                  {li.imageUrl ? (
                                    <img src={li.imageUrl} alt="" className="w-8 h-8 rounded object-cover shrink-0 border border-slate-200" />
                                  ) : (
                                    <span className="w-8 h-8 rounded bg-slate-100 shrink-0" />
                                  )}
                                  <span className="min-w-0 flex-1">
                                    <span className="block text-slate-800 truncate">{li.title}</span>
                                    <span className="block text-[11px] text-slate-500 truncate">
                                      {[li.variantTitle, li.sku && `SKU ${li.sku}`].filter(Boolean).join(' · ') || ' '}
                                    </span>
                                  </span>
                                  <span className="text-slate-600 shrink-0">× {li.quantity}</span>
                                </li>
                              ))}
                              {o.moreLineItems && <li className="text-[11px] text-slate-400">More items in Shopify admin</li>}
                            </ul>
                            <a
                              href={o.adminUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="mt-2 inline-flex items-center gap-1 font-semibold text-slate-700 hover:underline"
                            >
                              Open order in Shopify admin <ExternalLink className="w-3 h-3" />
                            </a>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {page?.hasNextPage && !error && <LoadMoreButton onClick={loadMore} loading={isLoadingMore} label="Load more orders" />}

      <CustomerOrdersModal storeId={storeId} shopDomain={shopDomain} customer={openCustomer} onClose={() => setOpenCustomer(null)} />
    </div>
  );
};
