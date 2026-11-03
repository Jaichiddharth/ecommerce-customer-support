'use client';

import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

// ─── Status badges ───────────────────────────────────────────────────────────

const TONES = {
  slate: 'bg-slate-100 text-slate-600 border-slate-200',
  blue: 'bg-blue-50 text-blue-700 border-blue-200',
  green: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  amber: 'bg-amber-50 text-amber-700 border-amber-200',
  red: 'bg-red-50 text-red-600 border-red-200',
  violet: 'bg-violet-50 text-violet-700 border-violet-200',
} as const;
type Tone = keyof typeof TONES;

const STATUS_TONES: Record<string, Tone> = {
  // Flow / version
  draft: 'slate',
  publishing: 'blue',
  published: 'green',
  throttled: 'amber',
  blocked: 'red',
  failed: 'red',
  deprecated: 'violet',
  archived: 'slate',
  // Template (Meta)
  APPROVED: 'green',
  PENDING: 'blue',
  SUBMITTING: 'blue',
  IN_APPEAL: 'blue',
  REJECTED: 'red',
  SUBMISSION_FAILED: 'red',
  DISABLED: 'red',
  PAUSED: 'amber',
  PENDING_DELETION: 'amber',
  ARCHIVED: 'slate',
  DELETED: 'slate',
  // Submission / execution / run
  processed: 'green',
  received: 'blue',
  unmatched: 'amber',
  completed: 'green',
  sent: 'blue',
  expired: 'amber',
  waiting: 'blue',
  running: 'blue',
  timed_out: 'amber',
  cancelled: 'slate',
  // Automation
  active: 'green',
  paused: 'amber',
};

export function StatusBadge({ status, className = '' }: { status: string; className?: string }) {
  const tone = TONES[STATUS_TONES[status] ?? 'slate'];
  return (
    <span className={`inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded-md border whitespace-nowrap ${tone} ${className}`}>
      {status.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}
    </span>
  );
}

// ─── Small primitives ────────────────────────────────────────────────────────

export const inputCls =
  'w-full px-3 py-2 text-[12px] rounded-lg border border-slate-200 bg-white text-slate-800 placeholder:text-slate-400 ' +
  'focus:outline-none focus:ring-2 focus:ring-[#3440a8]/20 focus:border-[#3440a8]/40 transition-all';

export const primaryBtn =
  'inline-flex items-center justify-center gap-1.5 text-[11px] font-semibold text-white bg-[#3440a8] hover:bg-[#2a3490] px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

export const secondaryBtn =
  'inline-flex items-center justify-center gap-1.5 text-[11px] font-semibold text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

export const iconBtn =
  'w-7 h-7 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed';

export function FieldLabel({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-[11px] font-semibold text-slate-600">{label}</span>
      {children}
      {hint && <span className="block text-[10px] text-slate-400">{hint}</span>}
    </label>
  );
}

export function Pagination({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (p: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  return (
    <div className="flex items-center justify-between px-4 py-2.5 border-t border-slate-100 text-[11px] text-slate-500">
      <span>
        {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
      </span>
      <div className="flex items-center gap-1">
        <button className={iconBtn} disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="px-1 tabular-nums">
          {page} / {pages}
        </span>
        <button className={iconBtn} disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page">
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

export const formatDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';

export const formatValue = (v: unknown): string =>
  Array.isArray(v) ? v.join(', ') : v === null || v === undefined || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v);
