import { EMPTY_DATE_RANGE, type DateRangeValue, type FilterDef, type FilterValue, type FilterValues } from './types';

const PRESET_MS: Record<string, number> = { '24h': 864e5, '7d': 7 * 864e5, '30d': 30 * 864e5 };

/** Local calendar day (YYYY-MM-DD) → its first / last instant in the viewer's timezone. */
function localDayBoundary(day: string, end: boolean): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return null;
  const d = end
    ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59, 999)
    : new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * A date-range filter as ISO instants. Presets are relative to `now`; a custom range covers whole local
 * days (From 00:00 → To 23:59:59.999 in the viewer's timezone), so the server compares absolute instants.
 */
export function dateRangeToInstants(v: DateRangeValue, now = new Date()): { from?: string; to?: string } {
  if (PRESET_MS[v.preset]) return { from: new Date(now.getTime() - PRESET_MS[v.preset]).toISOString() };
  if (v.preset !== 'custom') return {};
  let from = v.from ? localDayBoundary(v.from, false) : null;
  let to = v.to ? localDayBoundary(v.to, true) : null;
  if (from && to && from > to) {
    // Dates entered the wrong way round: use the range they describe
    [from, to] = [localDayBoundary(v.to, false), localDayBoundary(v.from, true)];
  }
  return { from: from?.toISOString(), to: to?.toISOString() };
}

export function defaultFilterValue(def: FilterDef): FilterValue {
  return def.type === 'dateRange' ? EMPTY_DATE_RANGE : '';
}

export function isFilterActive(def: FilterDef, value: FilterValue | undefined): boolean {
  if (value === undefined) return false;
  if (def.type === 'dateRange') {
    const v = value as DateRangeValue;
    return v.preset !== '' && (v.preset !== 'custom' || !!v.from || !!v.to);
  }
  return typeof value === 'string' && value.trim() !== '';
}

/** Filter values → query params (empty values are omitted). */
export function filtersToParams(defs: FilterDef[], values: FilterValues, now = new Date()): Record<string, string> {
  const params: Record<string, string> = {};
  for (const def of defs) {
    const value = values[def.key];
    if (!isFilterActive(def, value)) continue;
    if (def.type === 'dateRange') {
      const { from, to } = dateRangeToInstants(value as DateRangeValue, now);
      if (from) params[def.fromParam ?? 'fromDate'] = from;
      if (to) params[def.toParam ?? 'toDate'] = to;
    } else {
      params[def.key] = (value as string).trim();
    }
  }
  return params;
}
