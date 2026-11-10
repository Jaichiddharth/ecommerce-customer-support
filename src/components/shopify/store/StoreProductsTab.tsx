'use client';

import React, { useState } from 'react';
import { ExternalLink, ImageOff, Package } from 'lucide-react';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { formatShopifyPrice } from '@/lib/shopify/product-message';
import type { ShopifyProductSummary } from '@/lib/shopify/types';
import { LoadMoreButton, SearchInput, usePagedList } from '../ShopifyPageChrome';

function priceLabel(p: ShopifyProductSummary) {
  if (!p.priceMin) return '—';
  const min = formatShopifyPrice(p.priceMin.amount, p.priceMin.currencyCode);
  if (p.priceMax && p.priceMax.amount !== p.priceMin.amount) return `${min} – ${formatShopifyPrice(p.priceMax.amount, p.priceMax.currencyCode)}`;
  return min;
}

/** The store's active products (the ones agents can share), most recently updated first */
export const StoreProductsTab: React.FC<{ storeId: number; shopDomain: string }> = ({ storeId, shopDomain }) => {
  const [search, setSearch] = useState('');
  const { page, isLoading, isLoadingMore, error, reload, loadMore } = usePagedList<ShopifyProductSummary>(
    '/api/integrations/shopify/products',
    { storeId: String(storeId), q: search.trim() || undefined },
    'StoreProductsTab'
  );

  return (
    <div className="space-y-4">
      <SearchInput value={search} onChange={setSearch} placeholder="Search by product name, SKU or barcode" />
      <p className="text-[11px] text-slate-500">Active products only: drafts and archived products can&apos;t be shared with customers.</p>

      <div className="rounded-lg border border-slate-200 overflow-hidden">
        {error ? (
          <ErrorState error={error} title="Couldn't load products" onRetry={reload} />
        ) : isLoading && !page ? (
          <LoadingState label="Loading products…" />
        ) : page && page.items.length === 0 ? (
          <EmptyState
            icon={<Package className="w-5 h-5" />}
            title={search.trim() ? 'No product matches' : 'No active products'}
            description={search.trim() ? 'Try another name, SKU or barcode.' : 'Active products in this store appear here.'}
          />
        ) : (
          <div className={`overflow-x-auto ${isLoading ? 'opacity-60' : ''}`}>
            <table className="w-full min-w-[760px] text-xs">
              <thead className="bg-slate-50 text-left text-[11px] font-semibold text-slate-500">
                <tr>
                  <th className="px-4 py-2.5">Product</th>
                  <th className="px-3 py-2.5">Vendor</th>
                  <th className="px-3 py-2.5">SKU</th>
                  <th className="px-3 py-2.5 text-right">Variants</th>
                  <th className="px-3 py-2.5">Stock</th>
                  <th className="px-3 py-2.5 text-right">Price</th>
                  <th className="px-3 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {page?.items.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50/60">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2.5 min-w-0">
                        {p.imageUrl ? (
                          <img src={p.imageUrl} alt="" className="w-10 h-10 rounded-md object-cover border border-slate-200 shrink-0" />
                        ) : (
                          <span className="w-10 h-10 rounded-md bg-slate-100 text-slate-300 flex items-center justify-center shrink-0">
                            <ImageOff className="w-4 h-4" />
                          </span>
                        )}
                        <span className="min-w-0">
                          <span className="block font-semibold text-slate-900 truncate max-w-[280px]">{p.title}</span>
                          <span className="block text-[11px] text-slate-400 truncate">{p.handle}</span>
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-slate-600">{p.vendor || '—'}</td>
                    <td className="px-3 py-2.5 text-slate-600">{p.sku || (p.variantsCount > 1 ? 'Per variant' : '—')}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-800">{p.variantsCount}</td>
                    <td className="px-3 py-2.5">
                      <span
                        className={`inline-block px-1.5 py-0.5 rounded text-[10.5px] font-semibold ${
                          p.available ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'
                        }`}
                      >
                        {p.available ? 'In stock' : 'Out of stock'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-medium text-slate-900 whitespace-nowrap">{priceLabel(p)}</td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap space-x-3">
                      {p.productUrl && (
                        <a href={p.productUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-slate-700 hover:underline">
                          Store <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                      <a
                        href={`https://${shopDomain}/admin/products/${p.legacyId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 font-semibold text-slate-700 hover:underline"
                      >
                        Admin <ExternalLink className="w-3 h-3" />
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {page?.hasNextPage && !error && <LoadMoreButton onClick={loadMore} loading={isLoadingMore} label="Load more products" />}
    </div>
  );
};
