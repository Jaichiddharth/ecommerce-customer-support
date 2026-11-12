'use client';

import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search } from 'lucide-react';

export interface SearchableSelectOption {
  value: string;
  label: string;
  /** Second line, e.g. a store's domain or a phone number; also searched */
  description?: string;
  /** Small pill after the label, e.g. "Reconnect needed" */
  badge?: { text: string; tone?: 'neutral' | 'warning' | 'danger' | 'success' };
  /** Extra text matched by the search but not shown */
  keywords?: string;
  disabled?: boolean;
  /** Draws a divider below this option, e.g. after a "No store" choice at the top */
  dividerAfter?: boolean;
}

export interface SearchableSelectProps {
  options: SearchableSelectOption[];
  value: string | null;
  onChange: (value: string) => void;
  /** Trigger text when nothing is selected */
  placeholder?: string;
  searchPlaceholder?: string;
  /** Shown when the search matches nothing */
  emptyText?: string;
  disabled?: boolean;
  /** sm: compact settings rows (12px); md: forms (13px) */
  size?: 'sm' | 'md';
  id?: string;
  'aria-label'?: string;
  /** Classes for the wrapper, e.g. "flex-1 min-w-0" */
  className?: string;
}

const BADGE_TONES: Record<NonNullable<NonNullable<SearchableSelectOption['badge']>['tone']>, string> = {
  neutral: 'bg-slate-100 text-slate-600',
  warning: 'bg-amber-50 text-amber-700 border border-amber-200',
  danger: 'bg-red-50 text-red-700 border border-red-200',
  success: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
};

const MENU_MAX_HEIGHT = 288;
const MENU_GAP = 4;

const Badge: React.FC<{ badge: NonNullable<SearchableSelectOption['badge']> }> = ({ badge }) => (
  <span className={`shrink-0 px-1.5 py-px rounded text-[10px] font-semibold whitespace-nowrap ${BADGE_TONES[badge.tone ?? 'neutral']}`}>
    {badge.text}
  </span>
);

/**
 * A select with a search box: type to filter, ↑ ↓ to move, Enter to pick, Esc to close. The menu renders in a
 * portal, so cards and modals with overflow hidden don't clip it, and it flips above the field near the bottom
 * of the screen.
 */
export const SearchableSelect: React.FC<SearchableSelectProps> = ({
  options,
  value,
  onChange,
  placeholder = 'Select…',
  searchPlaceholder = 'Search…',
  emptyText = 'No matches',
  disabled = false,
  size = 'sm',
  id,
  'aria-label': ariaLabel,
  className = '',
}) => {
  const autoId = useId();
  const listId = `${id ?? autoId}-list`;
  const optionId = (i: number) => `${listId}-opt-${i}`;

  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState<{ top: number; left: number; width: number; placeAbove: boolean } | null>(null);

  const selected = options.find((o) => o.value === value) ?? null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => `${o.label} ${o.description ?? ''} ${o.keywords ?? ''}`.toLowerCase().includes(q));
  }, [options, query]);

  const place = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const spaceBelow = window.innerHeight - rect.bottom;
    const placeAbove = spaceBelow < MENU_MAX_HEIGHT + 16 && rect.top > spaceBelow;
    setPosition({
      top: placeAbove ? rect.top - MENU_GAP : rect.bottom + MENU_GAP,
      left: rect.left,
      width: rect.width,
      placeAbove,
    });
  }, []);

  const close = useCallback((focusTrigger = true) => {
    setOpen(false);
    setQuery('');
    if (focusTrigger) triggerRef.current?.focus();
  }, []);

  const openMenu = () => {
    if (disabled) return;
    place();
    setQuery('');
    // Start on the selected option, else the first one that can be picked
    const selectedIndex = options.findIndex((o) => o.value === value);
    setActive(selectedIndex >= 0 ? selectedIndex : Math.max(0, options.findIndex((o) => !o.disabled)));
    setOpen(true);
  };

  const pick = (option: SearchableSelectOption | undefined) => {
    if (!option || option.disabled) return;
    if (option.value !== value) onChange(option.value);
    close();
  };

  // Follow the field while the page scrolls or resizes; close on a click outside
  useLayoutEffect(() => {
    if (!open) return;
    place();
    const onMove = (e: Event) => {
      // Scrolling inside the menu's own list doesn't move the field
      if (menuRef.current && e.target instanceof Node && menuRef.current.contains(e.target)) return;
      place();
    };
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      close(false);
    };
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    document.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open, place, close]);

  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  // New search: highlight the first match
  useEffect(() => {
    if (!open) return;
    setActive(Math.max(0, filtered.findIndex((o) => !o.disabled)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  // Keep the highlighted option in view
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const move = (step: 1 | -1) => {
    if (filtered.length === 0) return;
    let next = active;
    for (let i = 0; i < filtered.length; i++) {
      next = (next + step + filtered.length) % filtered.length;
      if (!filtered[next].disabled) break;
    }
    setActive(next);
  };

  const onSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      move(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      move(-1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(filtered[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation(); // don't also close a surrounding modal
      close();
    } else if (e.key === 'Tab') {
      close(false);
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      setActive(e.key === 'Home' ? 0 : filtered.length - 1);
    }
  };

  const onTriggerKeyDown = (e: React.KeyboardEvent) => {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
      e.preventDefault();
      openMenu();
    }
  };

  const text = size === 'md' ? 'text-[13px]' : 'text-xs';

  return (
    <div className={`relative ${className}`}>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        disabled={disabled}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={onTriggerKeyDown}
        className={`w-full flex items-center gap-2 px-3 py-2 ${text} text-left bg-white border rounded-lg transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-[#3440a8]/20 ${
          open ? 'border-[#3440a8] ring-2 ring-[#3440a8]/20' : 'border-slate-200 hover:border-slate-300'
        }`}
      >
        <span className="flex-1 min-w-0 flex items-center gap-1.5">
          {selected ? (
            <>
              <span className="truncate text-slate-800 font-medium">{selected.label}</span>
              {selected.description && <span className="truncate text-slate-500">· {selected.description}</span>}
              {selected.badge && <Badge badge={selected.badge} />}
            </>
          ) : (
            <span className="truncate text-slate-400">{placeholder}</span>
          )}
        </span>
        <ChevronDown className={`w-3.5 h-3.5 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open &&
        position &&
        createPortal(
          <div
            ref={menuRef}
            style={{
              position: 'fixed',
              left: position.left,
              width: position.width,
              ...(position.placeAbove ? { bottom: window.innerHeight - position.top } : { top: position.top }),
            }}
            className={`z-[60] min-w-[220px] bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden ${text}`}
          >
            <div className="p-2 border-b border-slate-100">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  ref={searchRef}
                  type="text"
                  role="searchbox"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={onSearchKeyDown}
                  placeholder={searchPlaceholder}
                  aria-controls={listId}
                  aria-activedescendant={filtered[active] ? optionId(active) : undefined}
                  autoComplete="off"
                  spellCheck={false}
                  className="w-full pl-8 pr-2 py-1.5 border border-slate-200 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-none focus:border-[#3440a8] focus:ring-1 focus:ring-[#3440a8]"
                />
              </div>
            </div>

            <ul ref={listRef} id={listId} role="listbox" aria-label={ariaLabel} className="overflow-y-auto p-1" style={{ maxHeight: MENU_MAX_HEIGHT - 52 }}>
              {filtered.length === 0 ? (
                <li className="px-2.5 py-3 text-center text-slate-500">{emptyText}</li>
              ) : (
                filtered.map((option, i) => {
                  const isSelected = option.value === value;
                  const isActive = i === active;
                  return (
                    <React.Fragment key={option.value}>
                      <li
                        id={optionId(i)}
                        data-index={i}
                        role="option"
                        aria-selected={isSelected}
                        aria-disabled={option.disabled || undefined}
                        onMouseEnter={() => !option.disabled && setActive(i)}
                        // mousedown keeps focus in the search box until the pick closes the menu
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => pick(option)}
                        className={`flex items-center gap-2 px-2.5 py-2 rounded-lg ${
                          option.disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
                        } ${isActive && !option.disabled ? 'bg-slate-100' : ''}`}
                      >
                        <span className="flex-1 min-w-0">
                          <span className="flex items-center gap-1.5 min-w-0">
                            <span className={`truncate ${isSelected ? 'font-semibold text-[#3440a8]' : 'font-medium text-slate-800'}`}>{option.label}</span>
                            {option.badge && <Badge badge={option.badge} />}
                          </span>
                          {option.description && <span className="block truncate text-[11px] text-slate-500">{option.description}</span>}
                        </span>
                        {isSelected && <Check className="w-4 h-4 shrink-0 text-[#3440a8]" />}
                      </li>
                      {option.dividerAfter && !query.trim() && <li role="separator" className="my-1 h-px bg-slate-100" />}
                    </React.Fragment>
                  );
                })
              )}
            </ul>
          </div>,
          document.body
        )}
    </div>
  );
};

export default SearchableSelect;
