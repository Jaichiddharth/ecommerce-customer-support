import { gte, lte, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import type { SortOrder } from "@/lib/listing";

/**
 * ORDER BY from an allowlist: each sort key maps to a fixed SQL expression, so user input only ever
 * selects among them. Nulls sort last in both directions; `tiebreaker` (usually the primary key) keeps pages stable.
 */
export function orderBySql<S extends string>(
  columns: Record<S, SQLWrapper>,
  sortBy: S,
  sortOrder: SortOrder,
  tiebreaker: SQLWrapper
): SQL[] {
  const expr = columns[sortBy];
  const dir = sortOrder === "asc" ? sql`asc` : sql`desc`;
  return [sql`${expr} ${dir} nulls last`, sql`${tiebreaker} ${dir}`];
}

/** `column >= from AND column <= to`, for whichever bounds are given. */
export function dateRangeConditions(column: SQLWrapper & Parameters<typeof gte>[0], from?: Date, to?: Date): SQL[] {
  const out: SQL[] = [];
  if (from) out.push(gte(column, from));
  if (to) out.push(lte(column, to));
  return out;
}

/** ILIKE pattern for a "contains" search with % and _ escaped. */
export const containsPattern = (q: string) => `%${q.replace(/[\\%_]/g, "\\$&")}%`;
