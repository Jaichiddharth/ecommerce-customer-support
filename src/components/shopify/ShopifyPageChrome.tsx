'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2, Search } from 'lucide-react';
import apiClient from '@/lib/api/client';
import { ApiError, toApiError } from '@/lib/api/api-error';
import { notifyError } from '@/lib/api/notify';
import type { ShopifyPage } from '@/lib/shopify/types';

/** White panel that fills the page, with a fixed header and a scrolling body */
export const ShopifyPageShell: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="h-full bg-slate-50/60 p-2 sm:p-3">
    <div className="h-full flex flex-col bg-white rounded-xl border border-slate-200 overflow-hidden">{children}</div>
  </div>
);

/** [←] Title · badges ··· actions */
export const ShopifyPageHeader: React.FC<{
  back: { href: string; label: string } | { onClick: () => void; label: string };
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  badges?: React.ReactNode;
  actions?: React.ReactNode;
}> = ({ back, title, subtitle, badges, actions }) => {
  const backClass =
    'w-7 h-7 shrink-0 rounded-md border border-slate-300 flex items-center justify-center text-slate-700 hover:bg-slate-50 cursor-pointer';
  return (
    <header className="flex items-center gap-3 px-4 sm:px-5 py-3 border-b border-slate-200">
      {'href' in back ? (
        <Link href={back.href} aria-label={back.label} title={back.label} className={backClass}>
          <ArrowLeft className="w-4 h-4" />
        </Link>
      ) : (
        <button type="button" onClick={back.onClick} aria-label={back.label} title={back.label} className={backClass}>
          <ArrowLeft className="w-4 h-4" />
        </button>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-base font-bold text-slate-900 truncate">{title}</h1>
          {badges}
        </div>
        {subtitle && <p className="text-xs text-slate-500 truncate">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </header>
  );
};

export const primaryButtonClass =
  'inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold cursor-pointer disabled:opacity-50';
export const secondaryButtonClass =
  'inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer disabled:opacity-50';

/** Underlined tabs under the header */
export function ShopifyTabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: { key: T; label: React.ReactNode }[];
  active: T;
  onChange: (key: T) => void;
}) {
  return (
    <div className="flex gap-6 px-4 sm:px-5 border-b border-slate-200 overflow-x-auto" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          aria-selected={active === t.key}
          onClick={() => onChange(t.key)}
          className={`py-3 text-[13px] whitespace-nowrap cursor-pointer border-b-2 -mb-px ${
            active === t.key ? 'border-slate-900 text-slate-900 font-semibold' : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** Search box with an icon */
export const SearchInput: React.FC<{ value: string; onChange: (v: string) => void; placeholder: string; icon?: React.ReactNode; className?: string }> = ({
  value,
  onChange,
  placeholder,
  icon,
  className = '',
}) => (
  <div className={`relative min-w-0 ${className}`}>
    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400">{icon ?? <Search className="w-4 h-4" />}</span>
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full pl-8 pr-3 py-2 bg-white border border-slate-200 rounded-lg text-[13px] outline-none focus:border-slate-400"
    />
  </div>
);

export const selectClass =
  'px-3 py-2 bg-white border border-slate-200 rounded-lg text-[13px] outline-none focus:border-slate-400 disabled:opacity-50 cursor-pointer';

export const LoadMoreButton: React.FC<{ onClick: () => void; loading: boolean; label: string }> = ({ onClick, loading, label }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={loading}
    className="w-full py-2 text-xs font-semibold text-slate-700 rounded-lg border border-slate-200 hover:bg-slate-50 cursor-pointer disabled:opacity-60 inline-flex items-center justify-center gap-1.5"
  >
    {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
    {loading ? 'Loading…' : label}
  </button>
);

/** "PARTIALLY_FULFILLED" → "Partially fulfilled" */
export const humanize = (value: string | null | undefined) =>
  value ? value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, ' ') : null;

export const formatDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

/**
 * A paginated list from an endpoint returning { items, hasNextPage, endCursor }. Reloads (debounced) whenever
 * the params change; stale responses are dropped.
 */
export function usePagedList<T>(url: string, params: Record<string, string | undefined>, where: string) {
  const [page, setPage] = useState<ShopifyPage<T> | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const seq = useRef(0);
  const paramsKey = JSON.stringify(params);

  const load = useCallback(
    async (after?: string | null) => {
      const current = ++seq.current;
      if (after) setIsLoadingMore(true);
      else setIsLoading(true);
      try {
        const res = await apiClient.get(url, { params: { ...JSON.parse(paramsKey), after: after || undefined } });
        if (current !== seq.current) return;
        const next: ShopifyPage<T> = { items: res.data.items ?? [], hasNextPage: Boolean(res.data.hasNextPage), endCursor: res.data.endCursor ?? null };
        setPage((prev) => (after && prev ? { ...next, items: [...prev.items, ...next.items] } : next));
        setError(null);
      } catch (err) {
        if (current !== seq.current) return;
        if (after) notifyError(err, { where: `${where}.loadMore`, title: "Couldn't load more" });
        else setError(toApiError(err));
      } finally {
        if (current === seq.current) {
          setIsLoading(false);
          setIsLoadingMore(false);
        }
      }
    },
    [url, paramsKey, where]
  );

  // Immediately on the first load, debounced while the user types
  const firstLoad = useRef(true);
  useEffect(() => {
    const delay = firstLoad.current ? 0 : 350;
    firstLoad.current = false;
    const t = setTimeout(() => load(), delay);
    return () => clearTimeout(t);
  }, [load]);

  return {
    page,
    isLoading,
    isLoadingMore,
    error,
    reload: () => load(),
    loadMore: () => {
      if (page?.endCursor) load(page.endCursor);
    },
  };
}
