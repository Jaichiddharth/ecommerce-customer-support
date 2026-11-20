'use client';

import React, { useState } from 'react';
import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type PaginationState,
  type SortingState,
  type Updater,
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { DEFAULT_PAGE_SIZE, PAGE_SIZE_OPTIONS, type PaginationMeta } from '@/lib/listing';
import { TableFilters } from './TableFilters';
import { TablePagination } from './TablePagination';
import type { FilterDef, FilterValue, FilterValues, SortState } from './types';

/** Server-driven state: the API sorts and paginates; the table only reports what the user asked for. */
export interface ServerTableControl {
  pagination: PaginationMeta | null;
  sort: SortState;
  onSortChange: (sort: SortState) => void;
  onPageChange: (page: number) => void;
  onLimitChange: (limit: number) => void;
}

export interface DataTableProps<T> {
  // TanStack column definitions; `any` value type so accessor columns of different types can be mixed
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  columns: ColumnDef<T, any>[];
  data: T[];
  getRowId: (row: T) => string | number;

  /** Server-side sorting / pagination (listings). Omit for a client-side table over `data`. */
  server?: ServerTableControl;
  /** Client mode only: starting sort and page size. */
  initialSort?: SortState;
  initialPageSize?: number;
  /** 'always' (default for server tables) or 'auto' (default for client tables: only when the rows don't all fit on one page at the smallest page size). */
  showPagination?: 'always' | 'auto';
  /** Where the pagination bar goes: above and below the rows (default), or only below. */
  paginationPosition?: 'both' | 'bottom';
  pageSizeOptions?: readonly number[];

  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  errorTitle?: string;
  loadingLabel?: string;

  filters?: FilterDef[];
  filterValues?: FilterValues;
  onFilterChange?: (key: string, value: FilterValue) => void;
  onClearFilters?: () => void;
  hasActiveFilters?: boolean;
  /** Extra toolbar content next to the filters. */
  toolbar?: React.ReactNode;

  /** Shown when there are no rows; receives whether filters are active. */
  emptyState?: React.ReactNode | ((filtered: boolean) => React.ReactNode);
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T) => string;
  /**
   * Client mode only: rows with a lower rank always come first, whatever column is sorted; the chosen sort
   * applies within each rank (e.g. keep drafts and active items on top).
   */
  pinRank?: (row: T) => number;
  /** Classes for the outer wrapper (e.g. `flex-1`). */
  className?: string;
  /** Render without the card border (when embedded in another card). */
  bare?: boolean;
}

const ALIGN = { left: 'text-left', center: 'text-center', right: 'text-right' } as const;
const JUSTIFY = { left: 'justify-start', center: 'justify-center', right: 'justify-end' } as const;

const resolve = <S,>(updater: Updater<S>, prev: S): S => (typeof updater === 'function' ? (updater as (p: S) => S)(prev) : updater);
const toSorting = (s: SortState): SortingState => [{ id: s.sortBy, desc: s.sortOrder === 'desc' }];
/** Hidden column that carries `pinRank`, always sorted first */
const PIN_COLUMN = '__pin';

function SortIcon({ sorted }: { sorted: false | 'asc' | 'desc' }) {
  if (!sorted) return <ChevronsUpDown className="w-3 h-3 text-slate-300 group-hover:text-slate-400" aria-hidden />;
  return sorted === 'asc'
    ? <ArrowUp className="w-3 h-3 text-[#3440a8]" aria-hidden />
    : <ArrowDown className="w-3 h-3 text-[#3440a8]" aria-hidden />;
}

/**
 * The one table used across the app (Automations, WhatsApp Flows, Flow templates, Submissions, execution
 * history, Flow versions, …), built on TanStack Table.
 *  - Server mode (`server`): manual sorting / pagination — the API returns only the requested page; pair it
 *    with `useServerTable`, which owns page, page size, sort and filters.
 *  - Client mode: TanStack's sorted + paginated row models over `data` (small, fully loaded lists).
 * Pagination controls appear above and below the rows.
 */
export function DataTable<T>({
  columns,
  data,
  getRowId,
  server,
  initialSort,
  initialPageSize = DEFAULT_PAGE_SIZE,
  showPagination = server ? 'always' : 'auto',
  paginationPosition = 'both',
  pageSizeOptions = PAGE_SIZE_OPTIONS,
  loading = false,
  error = null,
  onRetry,
  errorTitle = "Couldn't load this list",
  loadingLabel = 'Loading…',
  filters = [],
  filterValues = {},
  onFilterChange,
  onClearFilters,
  hasActiveFilters = false,
  toolbar,
  emptyState,
  onRowClick,
  rowClassName,
  pinRank,
  className = '',
  bare = false,
}: DataTableProps<T>) {
  // Client-mode state (ignored in server mode, where state comes from `server`)
  const [clientSorting, setClientSorting] = useState<SortingState>(initialSort ? toSorting(initialSort) : []);
  const [clientPagination, setClientPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: initialPageSize });

  const sorting: SortingState = server ? toSorting(server.sort) : clientSorting;
  // Client mode: when the data shrinks (e.g. the owner filtered it), stay on the last page that still exists
  const clientLastPage = Math.max(0, Math.ceil(data.length / clientPagination.pageSize) - 1);
  const pagination: PaginationState = server
    ? { pageIndex: (server.pagination?.page ?? 1) - 1, pageSize: server.pagination?.limit ?? initialPageSize }
    : clientPagination.pageIndex > clientLastPage
      ? { ...clientPagination, pageIndex: clientLastPage }
      : clientPagination;

  const pinned = Boolean(pinRank) && !server;
  const tableColumns: ColumnDef<T, any>[] = pinned // eslint-disable-line @typescript-eslint/no-explicit-any
    ? [{ id: PIN_COLUMN, header: '', accessorFn: (row: T) => pinRank!(row), enableSorting: true, sortingFn: 'basic' }, ...columns]
    : columns;
  const tableSorting: SortingState = pinned ? [{ id: PIN_COLUMN, desc: false }, ...sorting] : sorting;

  const table = useReactTable<T>({
    data,
    columns: tableColumns,
    getRowId: (row) => String(getRowId(row)),
    defaultColumn: { enableSorting: false },
    enableMultiSort: false,
    enableSortingRemoval: false,
    state: { sorting: tableSorting, pagination, ...(pinned ? { columnVisibility: { [PIN_COLUMN]: false } } : {}) },
    getCoreRowModel: getCoreRowModel(),
    ...(server
      ? {
          manualSorting: true,
          manualPagination: true,
          manualFiltering: true,
          rowCount: server.pagination?.totalRecords ?? 0,
          pageCount: server.pagination?.totalPages ?? 1,
        }
      : {
          getSortedRowModel: getSortedRowModel(),
          getPaginationRowModel: getPaginationRowModel(),
          autoResetPageIndex: false,
        }),
    onSortingChange: (updater) => {
      const next = resolve(updater, tableSorting).find((s) => s.id !== PIN_COLUMN);
      if (!next) return;
      if (server) server.onSortChange({ sortBy: next.id, sortOrder: next.desc ? 'desc' : 'asc' });
      else {
        setClientSorting([next]);
        setClientPagination((p) => ({ ...p, pageIndex: 0 }));
      }
    },
    onPaginationChange: (updater) => {
      const next = resolve(updater, pagination);
      // A new page size always starts again from the first page
      const sizeChanged = next.pageSize !== pagination.pageSize;
      if (server) {
        if (sizeChanged) server.onLimitChange(next.pageSize);
        else server.onPageChange(next.pageIndex + 1);
      } else {
        setClientPagination(sizeChanged ? { pageIndex: 0, pageSize: next.pageSize } : next);
      }
    },
  });

  const rows = table.getRowModel().rows;
  const firstLoad = loading && (server ? !server.pagination : data.length === 0);
  const refreshing = loading && !firstLoad;
  const hasRows = !error && rows.length > 0;
  // 'auto' hides the bar only when every row fits on one page even at the smallest page size. Basing it on the
  // current page size would hide the "Rows per page" picker as soon as a large size is chosen (one page left),
  // leaving no way to switch back to a smaller size.
  const smallestPageSize = Math.min(...pageSizeOptions, pagination.pageSize);
  const totalRows = server ? server.pagination?.totalRecords ?? 0 : data.length;
  const pagerVisible = hasRows && (showPagination === 'always' || table.getPageCount() > 1 || totalRows > smallestPageSize);

  const pager = (position: 'top' | 'bottom') =>
    pagerVisible && (position === 'bottom' || paginationPosition === 'both') ?<TablePagination table={table} position={position} pageSizeOptions={pageSizeOptions} loading={refreshing} /> : null;

  let body: React.ReactNode;
  if (error) {
    body = <ErrorState error={error} title={errorTitle} onRetry={onRetry} retrying={loading} />;
  } else if (firstLoad || (refreshing && rows.length === 0)) {
    body = <LoadingState label={loadingLabel} />;
  } else if (rows.length === 0) {
    body = typeof emptyState === 'function'
      ? emptyState(hasActiveFilters)
      : emptyState ?? (
        <EmptyState
          title={hasActiveFilters ? 'No results match these filters' : 'Nothing here yet'}
          description={hasActiveFilters ? 'Try different filters, or clear them.' : undefined}
        />
      );
  } else {
    body = (
      <div className={`overflow-x-auto transition-opacity ${refreshing ? 'opacity-60' : ''}`} aria-busy={refreshing}>
        <table className="w-full text-[12px]">
          <thead>
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id} className="text-[10px] uppercase tracking-wider text-slate-400 border-b border-slate-100">
                {group.headers.map((header, i) => {
                  const meta = header.column.columnDef.meta;
                  const align = meta?.align ?? 'left';
                  const sorted = header.column.getIsSorted();
                  const label = header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext());
                  return (
                    <th
                      key={header.id}
                      scope="col"
                      colSpan={header.colSpan}
                      aria-sort={sorted ? (sorted === 'asc' ? 'ascending' : 'descending') : undefined}
                      className={`${i === 0 ? 'px-4' : 'px-3'} py-2.5 font-semibold ${ALIGN[align]} ${meta?.headerClassName ?? ''}`}
                    >
                      {header.column.getCanSort() ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className={`group inline-flex items-center gap-1 uppercase tracking-wider font-semibold hover:text-slate-700 transition-colors ${JUSTIFY[align]} ${sorted ? 'text-slate-700' : ''}`}
                          title={typeof header.column.columnDef.header === 'string' ? `Sort by ${header.column.columnDef.header.toLowerCase()}` : 'Sort'}
                        >
                          {label}
                          <SortIcon sorted={sorted} />
                        </button>
                      ) : (
                        label
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                className={`border-b border-slate-50 last:border-b-0 ${onRowClick ? 'cursor-pointer' : ''} ${rowClassName?.(row.original) ?? 'hover:bg-slate-50/60'}`}
              >
                {row.getVisibleCells().map((cell, i) => {
                  const meta = cell.column.columnDef.meta;
                  return (
                    <td key={cell.id} className={`${i === 0 ? 'px-4' : 'px-3'} py-2.5 ${ALIGN[meta?.align ?? 'left']} ${meta?.className ?? ''}`}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className={`space-y-3 min-w-0 ${className}`}>
      {(filters.length > 0 || toolbar) && (
        <TableFilters
          filters={filters}
          values={filterValues}
          hasActiveFilters={hasActiveFilters}
          onChange={(k, v) => onFilterChange?.(k, v)}
          onClear={() => onClearFilters?.()}
        >
          {toolbar}
        </TableFilters>
      )}
      <div className={bare ? '' : 'bg-white border border-slate-200 rounded-xl overflow-hidden'}>
        {pager('top')}
        {body}
        {pager('bottom')}
      </div>
    </div>
  );
}
