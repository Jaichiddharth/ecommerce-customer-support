'use client';

import React from 'react';

const MAX_VISIBLE = 4;

/** A Shopify customer's tags as small chips; the rest are summarized as "+N" (all of them are in the tooltip) */
export const ShopifyCustomerTags: React.FC<{ tags: string[] | undefined; className?: string }> = ({ tags, className = '' }) => {
  if (!tags || tags.length === 0) return null;
  const visible = tags.slice(0, MAX_VISIBLE);
  const hidden = tags.length - visible.length;
  return (
    <span className={`flex flex-wrap gap-1 ${className}`} title={tags.join(', ')}>
      {visible.map((tag) => (
        <span key={tag} className="max-w-[120px] truncate px-1.5 py-0.5 rounded bg-slate-100 text-[10.5px] font-medium text-slate-600">
          {tag}
        </span>
      ))}
      {hidden > 0 && <span className="px-1 py-0.5 text-[10.5px] text-slate-400">+{hidden}</span>}
    </span>
  );
};
