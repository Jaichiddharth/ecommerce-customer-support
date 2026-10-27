'use client';

import React from 'react';
import { ExternalLink } from 'lucide-react';
import { formatShopifyPrice } from '@/lib/shopify/product-message';
import type { ShopifyOrder } from '@/lib/shopify/types';

/** "PARTIALLY_FULFILLED" → "Partially fulfilled" */
const humanize = (value: string | null) =>
  value ? value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, ' ') : null;

function orderState(order: ShopifyOrder) {
  if (order.cancelledAt) return { label: 'Cancelled', className: 'bg-red-50 text-red-600' };
  if (order.closed) return { label: 'Archived', className: 'bg-slate-100 text-slate-600' };
  return { label: 'Open', className: 'bg-[#eef0fb] text-[#3440a8]' };
}

export const ShopifyOrderCard: React.FC<{ order: ShopifyOrder; as?: 'li' | 'div' }> = ({ order, as: Tag = 'li' }) => {
  const state = orderState(order);
  return (
    <Tag className="block rounded-lg border border-slate-200 p-2.5 text-xs space-y-1.5">
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
    </Tag>
  );
};
