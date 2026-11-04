'use client';

import React from 'react';
import type { Table } from '@tanstack/react-table';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { PAGE_SIZE_OPTIONS } from '@/lib/listing';

const navBtn =
  'inline-flex items-center gap-1 h-7 px-2 rounded-lg border border-slate-200 bg-white text-[11px] font-semibold text-slate-600 ' +
  'hover:bg-slate-50 hover:text-slate-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white';

/**
 * Pagination bar driven by a TanStack table instance (server- or client-paginated alike): record range and
 * total, rows per page, current page / total pages, and Previous / Next. Rendered above and below the rows.
 */
export function TablePagination<T>({
  table,
  pageSizeOptions = PAGE_SIZE_OPTIONS,
  loading = false,
  position,
}: {
  table: Table<T>;
  pageSizeOptions?: readonly number[];
  loading?: boolean;
  position: 'top' | 'bottom';
}) {
  const { pageIndex, pageSize } = table.getState().pagination;
  const totalRecords = table.getRowCount();
  const totalPages = Math.max(1, table.getPageCount());
  const first = totalRecords === 0 ? 0 : pageIndex * pageSize + 1;
  const last = Math.min((pageIndex + 1) * pageSize, totalRecords);
  const id = `${React.useId()}-rows-per-page`;

  return (
    <nav
      aria-label={`Pagination (${position})`}
      className={`flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 text-[11px] text-slate-500 bg-white ${
        position === 'top' ? 'border-b' : 'border-t'
      } border-slate-100`}
    >
      <span className="tabular-nums inline-flex items-center gap-1.5">
        {loading && <Loader2 className="w-3 h-3 animate-spin text-[#3440a8]" aria-hidden />}
        Showing <span className="font-semibold text-slate-700">{first}–{last}</span> of{' '}
        <span className="font-semibold text-slate-700">{totalRecords}</span> record{totalRecords === 1 ? '' : 's'}
      </span>
      <div className="flex-1" />
      <label htmlFor={id} className="inline-flex items-center gap-1.5">
        Rows per page
        <select
          id={id}
          value={pageSize}
          onChange={(e) => table.setPageSize(Number(e.target.value))}
          className="h-7 px-1.5 rounded-lg border border-slate-200 bg-white text-[11px] font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#3440a8]/20"
        >
          {pageSizeOptions.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
      <span className="tabular-nums">
        Page <span className="font-semibold text-slate-700">{pageIndex + 1}</span> of <span className="font-semibold text-slate-700">{totalPages}</span>
      </span>
      <div className="flex items-center gap-1">
        <button type="button" className={navBtn} disabled={!table.getCanPreviousPage()} onClick={() => table.previousPage()}>
          <ChevronLeft className="w-3.5 h-3.5" /> Previous
        </button>
        <button type="button" className={navBtn} disabled={!table.getCanNextPage()} onClick={() => table.nextPage()}>
          Next <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </nav>
  );
}
