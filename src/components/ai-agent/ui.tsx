'use client';

import React from 'react';
import { ChevronDown } from 'lucide-react';

/** Small building blocks for the AI agent screens (Unocx theme: slate neutrals, #3440a8 accent). */

export const ACCENT = '#3440a8';

export function Card({ title, subtitle, action, children, className = '', bodyClassName = '' }: {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={`bg-white rounded-2xl border border-slate-200 ${className}`}>
      {(title || action) && (
        <header className="flex items-start justify-between gap-3 px-5 pt-5">
          <div className="min-w-0">
            {title && <h2 className="text-[15px] font-semibold text-slate-900">{title}</h2>}
            {subtitle && <p className="text-[12px] text-slate-500 mt-0.5">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      <div className={`p-5 ${bodyClassName}`}>{children}</div>
    </section>
  );
}

export function Toggle({ checked, onChange, disabled, label }: {
  checked: boolean;
  onChange?: (v: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange?.(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#3440a8]/40
        ${checked ? 'bg-[#3440a8]' : 'bg-slate-200'} ${disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
    </button>
  );
}

export function Select<T extends string | number>({ value, onChange, options, disabled, label, className = '' }: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  disabled?: boolean;
  label: string;
  className?: string;
}) {
  return (
    <div className={`relative ${className}`}>
      <select
        aria-label={label}
        disabled={disabled}
        value={String(value)}
        onChange={(e) => {
          const picked = options.find((o) => String(o.value) === e.target.value);
          if (picked) onChange(picked.value);
        }}
        className="w-full appearance-none rounded-lg border border-slate-200 bg-white pl-3 pr-8 py-2 text-[13px] text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#3440a8]/20 focus:border-[#3440a8]/40 disabled:bg-slate-50 disabled:text-slate-400"
      >
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>{o.label}</option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
    </div>
  );
}

type Tone = 'green' | 'amber' | 'red' | 'blue' | 'slate';
const TONES: Record<Tone, string> = {
  green: 'bg-emerald-50 text-emerald-700',
  amber: 'bg-amber-50 text-amber-700',
  red: 'bg-red-50 text-red-600',
  blue: 'bg-indigo-50 text-[#3440a8]',
  slate: 'bg-slate-100 text-slate-600',
};

export function Pill({ tone = 'slate', dot, children, className = '' }: { tone?: Tone; dot?: boolean; children: React.ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] font-medium whitespace-nowrap ${TONES[tone]} ${className}`}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export function Stat({ label, value, sub, subTone = 'slate' }: { label: string; value: React.ReactNode; sub?: React.ReactNode; subTone?: Tone }) {
  const subCls = { green: 'text-emerald-700', amber: 'text-amber-700', red: 'text-red-600', blue: 'text-[#3440a8]', slate: 'text-slate-500' }[subTone];
  return (
    <div className="bg-white rounded-2xl border border-slate-200 px-5 py-4">
      <div className="text-[12px] text-slate-500">{label}</div>
      <div className="text-[28px] font-bold text-slate-900 leading-tight mt-1 tabular-nums">{value}</div>
      {sub && <div className={`text-[12px] mt-1 ${subCls}`}>{sub}</div>}
    </div>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-slate-100 ${className}`} />;
}

export const pct = (v: number | null | undefined, digits = 0) => (v == null ? '—' : `${(v * 100).toFixed(digits)}%`);

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '—';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

export const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '—';
