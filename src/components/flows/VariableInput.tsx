'use client';

import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Braces } from 'lucide-react';
import type { VariableDef } from '@/lib/automation/variables';

export interface VariableGroup {
  title: string;
  items: VariableDef[];
  /** Shown instead of items when the group is empty */
  emptyHint?: string;
}

/** Variables the selected step can use; provided by the config panel. */
export const VariablesContext = createContext<VariableGroup[]>([]);

interface VariableInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
  rows?: number;
  maxLength?: number;
  className: string;
}

/**
 * Text input / textarea with an "Insert variable" menu listing exactly the variables that work at
 * this step, so nobody has to guess names. The variable is inserted at the cursor.
 */
export function VariableInput({ value, onChange, placeholder, multiline, rows = 4, maxLength, className }: VariableInputProps) {
  const groups = useContext(VariablesContext);
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Any press outside the menu and its button closes it, the input included. Capture phase, because
  // the canvas stops pointer events from bubbling to the document.
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !buttonRef.current?.contains(t)) setOpen(false);
    };
    document.addEventListener('pointerdown', close, true);
    return () => document.removeEventListener('pointerdown', close, true);
  }, [open]);

  /** Escape closes only the menu, not the whole properties panel. */
  const onMenuKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && open) {
      e.stopPropagation();
      setOpen(false);
    }
  };

  const insert = (path: string) => {
    const el = ref.current;
    const token = `{{${path}}}`;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const next = value.slice(0, start) + token + value.slice(end);
    onChange(maxLength ? next.slice(0, maxLength) : next);
    setOpen(false);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const common = {
    ref,
    value,
    placeholder,
    maxLength,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(e.target.value),
    onFocus: () => setOpen(false),
  };

  return (
    <div ref={wrapRef} className="relative" onKeyDown={onMenuKey}>
      {multiline ? <textarea {...common} rows={rows} className={`${className} resize-y`} /> : <input {...common} className={className} />}
      {/* Below the field (not inside it), so it never covers the text or the field's hint */}
      <div className="flex justify-end mt-1">
        <button
          ref={buttonRef}
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="h-6 px-1.5 rounded-md flex items-center gap-1 text-[11px] font-semibold text-[#3440a8] hover:bg-[#eef0fb] transition-colors"
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          <Braces className="w-3.5 h-3.5" />
          Insert variable
        </button>
      </div>

      {open && (
        <div
          ref={menuRef}
          role="listbox"
          className="absolute right-0 top-full z-40 -mt-0.5 w-full min-w-[240px] max-h-[280px] overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg py-1"
        >
          {groups.map((g) => (
            <div key={g.title} className="py-1">
              <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">{g.title}</p>
              {g.items.length === 0 && g.emptyHint && (
                <p className="px-3 py-1 text-[11px] text-slate-400 leading-snug">{g.emptyHint}</p>
              )}
              {g.items.map((v) => (
                <button
                  key={v.path}
                  type="button"
                  role="option"
                  aria-selected={false}
                  onClick={() => insert(v.path)}
                  className="w-full px-3 py-1.5 flex items-center justify-between gap-3 text-left hover:bg-slate-50"
                >
                  <span className="text-[12px] text-slate-700 truncate">{v.label}</span>
                  <span className="text-[10.5px] text-slate-400 font-mono shrink-0">{v.example ?? `{{${v.path}}}`}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
