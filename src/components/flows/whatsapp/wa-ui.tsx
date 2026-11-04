'use client';

import React from 'react';

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

export { inputCls, primaryBtn, secondaryBtn, iconBtn } from '@/components/ui/controls';

export function FieldLabel({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-[11px] font-semibold text-slate-600">{label}</span>
      {children}
      {hint && <span className="block text-[10px] text-slate-400">{hint}</span>}
    </label>
  );
}

export const formatDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';

export const formatValue = (v: unknown): string =>
  Array.isArray(v) ? v.join(', ') : v === null || v === undefined || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v);
