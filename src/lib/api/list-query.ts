import { AppError } from "@/lib/errors";
import { DEFAULT_PAGE_SIZE, paginationMeta, type ListResult, type SortOrder } from "@/lib/listing";

/**
 * Parses and validates the shared listing query (page, limit, sortBy, sortOrder, fromDate, toDate).
 * Anything invalid is a 400 naming the field — nothing unvalidated reaches a query.
 * `sortBy` must be one of the endpoint's allowlisted keys; repositories map each key to a fixed SQL expression.
 */

export interface ListQueryConfig<S extends string> {
  /** Allowlist of sort keys this endpoint accepts. */
  sortable: readonly S[];
  defaultSortBy: S;
  defaultSortOrder?: SortOrder;
  defaultLimit?: number;
  maxLimit?: number;
}

export interface ListQuery<S extends string = string> {
  page: number;
  limit: number;
  offset: number;
  sortBy: S;
  sortOrder: SortOrder;
  fromDate?: Date;
  toDate?: Date;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function positiveInt(value: string | null, field: string, max?: number): number | undefined {
  if (value === null || value === "") return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw AppError.validation(`${field} must be a positive whole number.`, field);
  if (max !== undefined && n > max) throw AppError.validation(`${field} can be at most ${max}.`, field);
  return n;
}

/**
 * ISO 8601 instant (the UI sends local day boundaries already converted to UTC, so the user's timezone is respected).
 * A bare YYYY-MM-DD is taken as a UTC day: the start of it for `fromDate`, the end of it for `toDate`.
 */
function parseDate(value: string | null, field: string, endOfDay: boolean): Date | undefined {
  if (!value) return undefined;
  const v = value.trim();
  const d = DATE_ONLY.test(v) ? new Date(`${v}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`) : new Date(v);
  if (Number.isNaN(d.getTime())) throw AppError.validation(`${field} is not a valid date.`, field);
  return d;
}

export function parseListQuery<S extends string>(sp: URLSearchParams, config: ListQueryConfig<S>): ListQuery<S> {
  const maxLimit = config.maxLimit ?? 100;
  const page = positiveInt(sp.get("page"), "page") ?? 1;
  // `pageSize` is the older name of `limit`
  const limit = positiveInt(sp.get("limit") ?? sp.get("pageSize"), "limit", maxLimit) ?? config.defaultLimit ?? DEFAULT_PAGE_SIZE;

  const rawSortBy = sp.get("sortBy");
  if (rawSortBy && !config.sortable.includes(rawSortBy as S)) {
    throw AppError.validation(`sortBy must be one of: ${config.sortable.join(", ")}.`, "sortBy");
  }
  const rawOrder = sp.get("sortOrder")?.toLowerCase();
  if (rawOrder && rawOrder !== "asc" && rawOrder !== "desc") throw AppError.validation("sortOrder must be asc or desc.", "sortOrder");

  const fromDate = parseDate(sp.get("fromDate"), "fromDate", false);
  const toDate = parseDate(sp.get("toDate"), "toDate", true);
  if (fromDate && toDate && fromDate > toDate) throw AppError.validation("fromDate must be on or before toDate.", "fromDate");

  return {
    page,
    limit,
    offset: (page - 1) * limit,
    sortBy: (rawSortBy as S | null) ?? config.defaultSortBy,
    sortOrder: (rawOrder as SortOrder | undefined) ?? config.defaultSortOrder ?? "desc",
    fromDate,
    toDate,
  };
}

/** Optional filter value that must be one of an allowlist (e.g. a status); empty means "all". */
export function optionalEnum<T extends string>(value: string | null | undefined, allowed: readonly T[], field: string): T | undefined {
  if (!value) return undefined;
  if (!allowed.includes(value as T)) throw AppError.validation(`${field} must be one of: ${allowed.join(", ")}.`, field);
  return value as T;
}

/** True when the request asks for the paginated listing (any listing param present). */
export function wantsListing(sp: URLSearchParams): boolean {
  return ["page", "limit", "pageSize", "sortBy", "sortOrder", "fromDate", "toDate"].some((k) => sp.has(k));
}

export function toListResult<T>(items: T[], total: number, query: Pick<ListQuery, "page" | "limit">): ListResult<T> {
  return { items, pagination: paginationMeta(query.page, query.limit, total) };
}

/** Listing response body: the module's items key + `pagination`, plus the older `total/page/pageSize` fields. */
export function listBody<T>(key: string, result: ListResult<T>) {
  const { pagination } = result;
  return {
    success: true,
    [key]: result.items,
    pagination,
    total: pagination.totalRecords,
    page: pagination.page,
    pageSize: pagination.limit,
  };
}
