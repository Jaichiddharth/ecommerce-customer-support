'use client';

import React, { useEffect, useRef, useState } from 'react';
import { CalendarRange, Search, X } from 'lucide-react';
import { inputCls } from '@/components/ui/controls';
import type { DateRangePreset, DateRangeValue, FilterDef, FilterValue, FilterValues } from './types';
import { EMPTY_DATE_RANGE } from './types';

/** Bordered group holding a filter's label and its control(s), so every filter reads "Label: value". */
const groupCls =
  'inline-flex items-center gap-1.5 h-[34px] pl-2.5 pr-1 rounded-lg border border-slate-200 bg-white text-[12px] ' +
  'focus-within:ring-2 focus-within:ring-[#3440a8]/20 focus-within:border-[#3440a8]/40 transition-all';
const groupLabelCls = 'text-[11px] font-medium text-slate-400 whitespace-nowrap';
const bareSelectCls = 'h-full bg-transparent pr-1 text-[12px] font-semibold text-slate-700 focus:outline-none cursor-pointer max-w-[220px]';
const dateInputCls = 'h-[26px] px-1.5 rounded-md border border-slate-200 bg-white text-[11px] text-slate-700 focus:outline-none focus:border-[#3440a8]/40';

const DATE_PRESETS: { value: DateRangePreset; label: string }[] = [
  { value: '', label: 'Any time' },
  { value: '24h', label: 'Last 24 hours' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: 'custom', label: 'Custom date range' },
];

/** Search box that applies its value 300 ms after typing stops; follows outside resets (Clear filters). */
function SearchFilter({ value, placeholder, onChange }: { value: string; placeholder?: string; onChange: (v: string) => void }) {
  const [text, setText] = useState(value);
  const [seenValue, setSeenValue] = useState(value);
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; });

  // The applied value changed from outside (e.g. Clear filters): show it
  if (value !== seenValue) {
    setSeenValue(value);
    setText(value);
  }

  useEffect(() => {
    if (text === value) return;
    const t = setTimeout(() => onChangeRef.current(text), 300);
    return () => clearTimeout(t);
  }, [text, value]);

  return (
    <div className="relative w-full sm:w-56">
      <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
      <input
        type="search"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder ?? 'Search…'}
        aria-label={placeholder ?? 'Search'}
        className={`${inputCls} pl-8`}
      />
    </div>
  );
}

function DateRangeFilter({ label, value, onChange }: { label: string; value: DateRangeValue; onChange: (v: DateRangeValue) => void }) {
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  return (
    <div className={`${groupCls} ${value.preset === 'custom' ? 'flex-wrap h-auto py-1' : ''}`} role="group" aria-label={label}>
      <CalendarRange className="w-3.5 h-3.5 text-slate-400" aria-hidden />
      <span className={groupLabelCls}>{label}</span>
      <select
        value={value.preset}
        onChange={(e) => onChange({ ...value, preset: e.target.value as DateRangePreset })}
        className={bareSelectCls}
        aria-label={`${label} range`}
      >
        {DATE_PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
      </select>
      {value.preset === 'custom' && (
        <span className="inline-flex items-center gap-1 pr-1">
          <label className="inline-flex items-center gap-1 text-[10px] text-slate-400">
            From
            <input
              type="date"
              value={value.from}
              max={value.to || todayStr}
              onChange={(e) => onChange({ ...value, from: e.target.value })}
              className={dateInputCls}
            />
          </label>
          <label className="inline-flex items-center gap-1 text-[10px] text-slate-400">
            To
            <input
              type="date"
              value={value.to}
              min={value.from || undefined}
              max={todayStr}
              onChange={(e) => onChange({ ...value, to: e.target.value })}
              className={dateInputCls}
            />
          </label>
        </span>
      )}
    </div>
  );
}

/** Filter toolbar built from filter definitions; every change is applied server-side by the table's owner. */
export function TableFilters({
  filters,
  values,
  hasActiveFilters,
  onChange,
  onClear,
  children,
}: {
  filters: FilterDef[];
  values: FilterValues;
  hasActiveFilters: boolean;
  onChange: (key: string, value: FilterValue) => void;
  onClear: () => void;
  /** Extra toolbar content (rendered after the filters). */
  children?: React.ReactNode;
}) {
  if (!filters.length && !children) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {filters.map((def) => {
        const value = values[def.key];
        if (def.type === 'search') {
          return <SearchFilter key={def.key} value={(value as string) ?? ''} placeholder={def.placeholder} onChange={(v) => onChange(def.key, v)} />;
        }
        if (def.type === 'select') {
          return (
            <label key={def.key} className={groupCls}>
              <span className={groupLabelCls}>{def.label}</span>
              <select value={(value as string) ?? ''} onChange={(e) => onChange(def.key, e.target.value)} className={bareSelectCls}>
                <option value="">{def.allLabel ?? 'All'}</option>
                {def.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
          );
        }
        return (
          <DateRangeFilter
            key={def.key}
            label={def.label}
            value={(value as DateRangeValue) ?? EMPTY_DATE_RANGE}
            onChange={(v) => onChange(def.key, v)}
          />
        );
      })}
      {hasActiveFilters && (
        <button
          type="button"
          onClick={onClear}
          className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#3440a8] hover:underline px-1 shrink-0"
        >
          <X className="w-3 h-3" /> Clear filters
        </button>
      )}
      {children}
    </div>
  );
}
