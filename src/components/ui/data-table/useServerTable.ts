'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_PAGE_SIZE, type ListResult, type PaginationMeta } from '@/lib/listing';
import { defaultFilterValue, filtersToParams, isFilterActive } from './filter-params';
import type { ServerTableControl } from './DataTable';
import type { FilterDef, FilterValue, FilterValues, SortState } from './types';

/** Query sent to a listing endpoint: page, limit, sortBy, sortOrder and the active filters. */
export type ServerTableQuery = Record<string, string | number>;

export interface UseServerTableOptions<T> {
  /** Calls the listing endpoint with the query; must return `{ items, pagination }`. */
  fetcher: (query: ServerTableQuery) => Promise<ListResult<T>>;
  filters?: FilterDef[];
  /** Starting filter values (e.g. a Flow pre-selected from another page). */
  initialFilters?: FilterValues;
  defaultSort: SortState;
  defaultLimit?: number;
  /** Fixed params sent with every request (not user filters). */
  baseParams?: Record<string, string | number | undefined>;
}

export interface ServerTableState<T> {
  rows: T[];
  pagination: PaginationMeta | null;
  /** True while a request is in flight (also during refreshes, when the previous rows stay visible). */
  loading: boolean;
  error: unknown;
  sort: SortState;
  filterValues: FilterValues;
  hasActiveFilters: boolean;
  reload: () => Promise<void>;
  setPage: (page: number) => void;
  setLimit: (limit: number) => void;
  setSort: (sort: SortState) => void;
  setFilter: (key: string, value: FilterValue) => void;
  clearFilters: () => void;
  /** Ready to spread onto <DataTable /> (server mode). */
  tableProps: {
    data: T[];
    loading: boolean;
    error: unknown;
    onRetry: () => void;
    server: ServerTableControl;
    filters: FilterDef[];
    filterValues: FilterValues;
    onFilterChange: (key: string, value: FilterValue) => void;
    onClearFilters: () => void;
    hasActiveFilters: boolean;
  };
}

const emptyValues = (defs: FilterDef[]): FilterValues => Object.fromEntries(defs.map((d) => [d.key, defaultFilterValue(d)]));

/**
 * State and data loading for a server-side TanStack table: page, page size, sort and filters live here and
 * every change triggers one request; the server does all filtering, sorting and pagination. Changing
 * filters, sort or page size returns to page 1. Out-of-order responses are ignored.
 */
export function useServerTable<T>({
  fetcher,
  filters = [],
  initialFilters,
  defaultSort,
  defaultLimit = DEFAULT_PAGE_SIZE,
  baseParams,
}: UseServerTableOptions<T>): ServerTableState<T> {
  const [page, setPageState] = useState(1);
  const [limit, setLimitState] = useState(defaultLimit);
  const [sort, setSortState] = useState<SortState>(defaultSort);
  const [filterValues, setFilterValues] = useState<FilterValues>(() => ({ ...emptyValues(filters), ...initialFilters }));
  const [rows, setRows] = useState<T[]>([]);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  // Callers pass inline fetchers and filter arrays: read the latest through refs so they don't retrigger loads
  const fetcherRef = useRef(fetcher);
  const filtersRef = useRef(filters);
  const requestSeq = useRef(0);
  // Declared before the load effect, so it runs first on every commit
  useEffect(() => {
    fetcherRef.current = fetcher;
    filtersRef.current = filters;
  });

  const baseKey = JSON.stringify(baseParams ?? {});
  const filterKey = JSON.stringify(filterValues);

  const load = useCallback(async () => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    const base = Object.entries(JSON.parse(baseKey) as Record<string, string | number | undefined>)
      .filter((e): e is [string, string | number] => e[1] !== undefined && e[1] !== '');
    const query: ServerTableQuery = {
      ...Object.fromEntries(base),
      ...filtersToParams(filtersRef.current, JSON.parse(filterKey) as FilterValues),
      page,
      limit,
      sortBy: sort.sortBy,
      sortOrder: sort.sortOrder,
    };
    try {
      const res = await fetcherRef.current(query);
      if (seq !== requestSeq.current) return;
      // The page no longer exists (e.g. its last row was deleted): go to the last page instead
      if (res.items.length === 0 && res.pagination.totalRecords > 0 && page > res.pagination.totalPages) {
        setPageState(res.pagination.totalPages);
        return;
      }
      setRows(res.items);
      setPagination(res.pagination);
    } catch (err) {
      if (seq !== requestSeq.current) return;
      setError(err);
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [baseKey, filterKey, page, limit, sort.sortBy, sort.sortOrder]);

  useEffect(() => { load(); }, [load]);

  const setPage = useCallback((p: number) => setPageState(Math.max(1, Math.floor(p))), []);
  const setLimit = useCallback((l: number) => { setLimitState(l); setPageState(1); }, []);
  const setSort = useCallback((s: SortState) => { setSortState(s); setPageState(1); }, []);
  const setFilter = useCallback((key: string, value: FilterValue) => {
    setFilterValues((v) => ({ ...v, [key]: value }));
    setPageState(1);
  }, []);
  const clearFilters = useCallback(() => {
    setFilterValues(emptyValues(filtersRef.current));
    setPageState(1);
  }, []);

  const hasActiveFilters = filters.some((d) => isFilterActive(d, filterValues[d.key]));

  return {
    rows,
    pagination,
    loading,
    error,
    sort,
    filterValues,
    hasActiveFilters,
    reload: load,
    setPage,
    setLimit,
    setSort,
    setFilter,
    clearFilters,
    tableProps: {
      data: rows,
      loading,
      error,
      onRetry: load,
      server: { pagination, sort, onSortChange: setSort, onPageChange: setPage, onLimitChange: setLimit },
      filters,
      filterValues,
      onFilterChange: setFilter,
      onClearFilters: clearFilters,
      hasActiveFilters,
    },
  };
}
