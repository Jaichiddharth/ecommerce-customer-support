'use client';

import React, { useState } from 'react';
import { ChevronRight, Link2, Tag, Users } from 'lucide-react';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { formatShopifyPrice } from '@/lib/shopify/product-message';
import type { ShopifyCustomerListSort, ShopifyStoreCustomer } from '@/lib/shopify/types';
import { ShopifyCustomerTags } from '../ShopifyCustomerTags';
import { LoadMoreButton, SearchInput, formatDate, selectClass, usePagedList } from '../ShopifyPageChrome';
import { CustomerOrdersModal, type CustomerRef } from './CustomerOrdersModal';

const SORT_LABELS: Record<ShopifyCustomerListSort, string> = {
  updated: 'Recently updated',
  created: 'Newest first',
  name: 'Name (A–Z)',
};

/** The store's customers; click one to see their orders */
export const StoreCustomersTab: React.FC<{ storeId: number; shopDomain: string }> = ({ storeId, shopDomain }) => {
  const [search, setSearch] = useState('');
  const [tag, setTag] = useState('');
  const [sort, setSort] = useState<ShopifyCustomerListSort>('updated');
  const [openCustomer, setOpenCustomer] = useState<CustomerRef | null>(null);

  const { page, isLoading, isLoadingMore, error, reload, loadMore } = usePagedList<ShopifyStoreCustomer>(
    `/api/integrations/shopify/stores/${storeId}/customers`,
    { q: search.trim() || undefined, tag: tag.trim() || undefined, sort },
    'StoreCustomersTab'
  );
  const filtered = Boolean(search.trim() || tag.trim());

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-2">
        <SearchInput value={search} onChange={setSearch} placeholder="Search by name, email or phone" className="flex-1" />
        <SearchInput value={tag} onChange={setTag} placeholder="Filter by tag" icon={<Tag className="w-4 h-4" />} className="sm:w-52" />
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as ShopifyCustomerListSort)}
          disabled={Boolean(search.trim())}
          title={search.trim() ? 'Search results are sorted by relevance' : undefined}
          className={`sm:w-44 ${selectClass}`}
        >
          {(Object.keys(SORT_LABELS) as ShopifyCustomerListSort[]).map((s) => (
            <option key={s} value={s}>
              {SORT_LABELS[s]}
            </option>
          ))}
        </select>
      </div>

      <div className="rounded-lg border border-slate-200 overflow-hidden">
        {error ? (
          <ErrorState error={error} title="Couldn't load customers" onRetry={reload} />
        ) : isLoading && !page ? (
          <LoadingState label="Loading customers…" />
        ) : page && page.items.length === 0 ? (
          <EmptyState
            icon={<Users className="w-5 h-5" />}
            title={filtered ? 'No customer matches' : 'No customers yet'}
            description={filtered ? 'Try another name, email, phone number or tag.' : 'Customers appear here once they sign up or order in this store.'}
          />
        ) : (
          <div className={`overflow-x-auto ${isLoading ? 'opacity-60' : ''}`}>
            <table className="w-full min-w-[820px] text-xs">
              <thead className="bg-slate-50 text-left text-[11px] font-semibold text-slate-500">
                <tr>
                  <th className="px-4 py-2.5">Customer</th>
                  <th className="px-3 py-2.5">Location</th>
                  <th className="px-3 py-2.5 text-right">Orders</th>
                  <th className="px-3 py-2.5 text-right">Amount spent</th>
                  <th className="px-3 py-2.5">Last order</th>
                  <th className="px-3 py-2.5">Tags</th>
                  <th className="px-3 py-2.5">UnoCX contact</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {page?.items.map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => setOpenCustomer(c)}
                    onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setOpenCustomer(c))}
                    tabIndex={0}
                    title="See this customer's orders"
                    className="align-top cursor-pointer hover:bg-slate-50 focus:bg-slate-50 outline-none"
                  >
                    <td className="px-4 py-3 max-w-[240px]">
                      <p className="font-semibold text-slate-900 truncate">{c.displayName}</p>
                      {c.email && <p className="text-slate-500 truncate">{c.email}</p>}
                      {c.phone && <p className="text-slate-500">{c.phone}</p>}
                    </td>
                    <td className="px-3 py-3 text-slate-600">{c.location || '—'}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-slate-800">{c.numberOfOrders}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-slate-800">
                      {c.amountSpent ? formatShopifyPrice(c.amountSpent.amount, c.amountSpent.currencyCode) : '—'}
                    </td>
                    <td className="px-3 py-3 text-slate-600">
                      {c.lastOrder ? (
                        <>
                          <p className="font-medium text-slate-800">{c.lastOrder.name}</p>
                          <p className="text-[10.5px] text-slate-400">{formatDate(c.lastOrder.createdAt)}</p>
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-3 py-3 max-w-[200px]">
                      {c.tags.length > 0 ? <ShopifyCustomerTags tags={c.tags} /> : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-3 py-3">
                      {c.linkedContact ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                          <Link2 className="w-3 h-3" /> {c.linkedContact.name}
                        </span>
                      ) : (
                        <span className="text-slate-400">Not linked</span>
                      )}
                    </td>
                    <td className="pr-3 py-3 text-slate-400">
                      <ChevronRight className="w-4 h-4" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {page?.hasNextPage && !error && <LoadMoreButton onClick={loadMore} loading={isLoadingMore} label="Load more customers" />}

      <CustomerOrdersModal storeId={storeId} shopDomain={shopDomain} customer={openCustomer} onClose={() => setOpenCustomer(null)} />
    </div>
  );
};
