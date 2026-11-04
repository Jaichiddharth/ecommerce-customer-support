import type { RowData } from '@tanstack/react-table';
import type { SortOrder } from '@/lib/listing';

export type { SortOrder, PaginationMeta, ListResult } from '@/lib/listing';
export type { ColumnDef } from '@tanstack/react-table';

/**
 * Presentation options a column can carry in TanStack's `meta`.
 * Sorting uses TanStack's own options: a sortable column has an accessor and `enableSorting: true`
 * (the column `id` is the server's `sortBy` key); `sortDescFirst` makes the first click sort descending.
 */
declare module '@tanstack/react-table' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    align?: 'left' | 'center' | 'right';
    /** Classes for the body cell (`td`). */
    className?: string;
    /** Classes for the header cell (`th`). */
    headerClassName?: string;
  }
}

export interface SortState {
  sortBy: string;
  sortOrder: SortOrder;
}

// ─── Filters ─────────────────────────────────────────────────────────────────

export type DateRangePreset = '' | '24h' | '7d' | '30d' | 'custom';

/** `from` / `to` are local calendar days (YYYY-MM-DD) used by the custom range. */
export interface DateRangeValue {
  preset: DateRangePreset;
  from: string;
  to: string;
}

export type FilterValue = string | DateRangeValue;
export type FilterValues = Record<string, FilterValue>;

export interface FilterOption {
  value: string;
  label: string;
}

export type FilterDef =
  | {
      type: 'search';
      /** Query param name. */
      key: string;
      placeholder?: string;
    }
  | {
      type: 'select';
      /** Query param name. */
      key: string;
      label: string;
      options: FilterOption[];
      /** Label of the empty ("all") option. */
      allLabel?: string;
    }
  | {
      type: 'dateRange';
      /** Filter id (not sent); the range is sent as `fromParam` / `toParam`. */
      key: string;
      label: string;
      fromParam?: string;
      toParam?: string;
    };

export const EMPTY_DATE_RANGE: DateRangeValue = { preset: '', from: '', to: '' };
