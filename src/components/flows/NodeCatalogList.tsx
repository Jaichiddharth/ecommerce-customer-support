'use client';

import React, { useMemo, useRef, useState } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';
import type { NodeCategory, PaletteItem } from './flow-types';
import { CATEGORY_META, CATEGORY_ORDER, matchesSearch } from './palette-config';
import { NodeTypeIcon } from './node-icons';

export const DRAG_TYPE = 'application/reactflow-type';
export const DRAG_LABEL = 'application/reactflow-label';

interface Props {
  items: PaletteItem[];
  onPick: (item: PaletteItem) => void;
  /** Toolbox: rows can be dragged onto the canvas. */
  draggable?: boolean;
  /** Toolbox: categories can be collapsed. */
  collapsible?: boolean;
  autoFocus?: boolean;
  /** Escape in the search box. */
  onEscape?: () => void;
  className?: string;
}

/** Searchable list of step types grouped by category, with keyboard navigation (↑ ↓ Enter). */
export function NodeCatalogList({ items, onPick, draggable, collapsible, autoFocus, onEscape, className = '' }: Props) {
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Set<NodeCategory>>(new Set());
  const [cursor, setCursor] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const searching = query.trim().length > 0;
  const groups = useMemo(
    () =>
      CATEGORY_ORDER.map((cat) => ({
        cat,
        items: items.filter((i) => i.category === cat && matchesSearch(i, query)),
      })).filter((g) => g.items.length > 0),
    [items, query],
  );
  const visible = groups.flatMap((g) => (searching || !collapsed.has(g.cat) ? g.items : []));
  const active = Math.min(cursor, Math.max(visible.length - 1, 0));

  const toggle = (cat: NodeCategory) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = (active + (e.key === 'ArrowDown' ? 1 : -1) + visible.length) % Math.max(visible.length, 1);
      setCursor(next);
      listRef.current?.querySelector(`[data-idx="${next}"]`)?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && visible[active]) {
      e.preventDefault();
      onPick(visible[active]);
    } else if (e.key === 'Escape') {
      if (query) setQuery('');
      else onEscape?.();
    }
  };

  let idx = -1;

  return (
    <div className={`flex flex-col min-h-0 ${className}`}>
      <div className="relative shrink-0">
        <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          type="text"
          value={query}
          autoFocus={autoFocus}
          onChange={(e) => { setQuery(e.target.value); setCursor(0); }}
          onKeyDown={onKeyDown}
          placeholder="Search steps…"
          aria-label="Search steps"
          className="w-full pl-8 pr-7 py-2 text-[12px] rounded-lg border border-slate-200 bg-white text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#3440a8]/20 focus:border-[#3440a8]/40 transition-all"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded text-slate-400 hover:text-slate-700"
            aria-label="Clear search"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>

      <div ref={listRef} className="flex-1 overflow-y-auto mt-2 -mx-1 px-1" role="listbox" aria-label="Steps">
        {groups.length === 0 && (
          <div className="text-center py-8">
            <p className="text-[12px] font-medium text-slate-600">No matching steps</p>
            <p className="text-[11px] text-slate-400 mt-0.5">Try another word, like “send” or “branch”.</p>
          </div>
        )}
        {groups.map(({ cat, items: groupItems }) => {
          const meta = CATEGORY_META[cat];
          const open = searching || !collapsed.has(cat);
          return (
            <div key={cat} className="mb-2">
              <button
                type="button"
                onClick={() => collapsible && !searching && toggle(cat)}
                className={`w-full flex items-center gap-2 px-1.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500 select-none ${
                  collapsible && !searching ? 'hover:text-slate-700 cursor-pointer' : 'cursor-default'
                }`}
                aria-expanded={open}
              >
                <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: meta.accent }} />
                <span className="flex-1 text-left">{meta.label}</span>
                <span className="text-slate-400 font-medium normal-case tracking-normal">{groupItems.length}</span>
                {collapsible && !searching && (
                  <ChevronDown className={`w-3 h-3 transition-transform ${open ? '' : '-rotate-90'}`} />
                )}
              </button>
              {open && (
                <div className="space-y-0.5">
                  {groupItems.map((item) => {
                    idx += 1;
                    const i = idx;
                    return (
                      <div
                        key={item.type}
                        data-idx={i}
                        role="option"
                        aria-selected={i === active}
                        tabIndex={-1}
                        draggable={draggable}
                        onDragStart={(e) => {
                          e.dataTransfer.setData(DRAG_TYPE, item.type);
                          e.dataTransfer.setData(DRAG_LABEL, item.label);
                          e.dataTransfer.effectAllowed = 'move';
                        }}
                        onClick={() => onPick(item)}
                        onMouseEnter={() => setCursor(i)}
                        title={draggable ? 'Click to add, or drag onto the canvas' : undefined}
                        className={`flex items-start gap-2.5 px-2 py-2 rounded-lg select-none transition-colors ${
                          draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'
                        } ${i === active ? 'bg-[#3440a8]/[0.06]' : 'hover:bg-slate-50'}`}
                      >
                        <span
                          className="w-7 h-7 rounded-md flex items-center justify-center shrink-0 text-white"
                          style={{ backgroundColor: meta.accent }}
                        >
                          <NodeTypeIcon type={item.type} className="w-3.5 h-3.5" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[12px] font-semibold text-slate-700 leading-tight">{item.label}</span>
                          <span className="block text-[11px] text-slate-500 leading-snug mt-0.5">{item.description}</span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
