/**
 * Shared contract for server-side listings (pagination, sorting, filtering).
 * Pure types and helpers — safe to import from both API routes and client components.
 *
 * Request:  ?page=1&limit=10&sortBy=updatedAt&sortOrder=desc&fromDate=<ISO>&toDate=<ISO>&status=…&<module filters>
 * Response: { success, <items key>: [...], pagination: PaginationMeta, total, page, pageSize }
 *           (`total` / `page` / `pageSize` are kept for older callers.)
 */

export type SortOrder = 'asc' | 'desc';

export interface PaginationMeta {
  page: number;
  limit: number;
  totalRecords: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface ListResult<T> {
  items: T[];
  pagination: PaginationMeta;
}

/** Page sizes offered by every listing UI. */
export const PAGE_SIZE_OPTIONS = [10, 15, 20, 25, 30] as const;
export const DEFAULT_PAGE_SIZE = 10;

export function paginationMeta(page: number, limit: number, totalRecords: number): PaginationMeta {
  const totalPages = Math.max(1, Math.ceil(totalRecords / limit));
  return {
    page,
    limit,
    totalRecords,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1,
  };
}

/** Reads a listing response body (`{ [key]: T[], pagination }`) into a ListResult. */
export function readListResult<T>(body: Record<string, unknown>, key: string): ListResult<T> {
  const items = (body[key] as T[] | undefined) ?? [];
  const p = body.pagination as PaginationMeta | undefined;
  return { items, pagination: p ?? paginationMeta(1, Math.max(items.length, 1), items.length) };
}
