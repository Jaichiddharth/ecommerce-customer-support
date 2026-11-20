'use client';

import React from 'react';
import type { CampaignStatus } from './types';

const STATUS: Record<CampaignStatus, { label: string; dot: string; pill: string }> = {
  draft: { label: 'Draft', dot: 'bg-slate-400', pill: 'bg-slate-100 text-slate-600' },
  scheduled: { label: 'Scheduled', dot: 'bg-indigo-500', pill: 'bg-indigo-50 text-indigo-700' },
  running: { label: 'Sending', dot: 'bg-emerald-500 animate-pulse', pill: 'bg-emerald-50 text-emerald-700' },
  paused: { label: 'Paused', dot: 'bg-amber-500', pill: 'bg-amber-50 text-amber-700' },
  completed: { label: 'Completed', dot: 'bg-emerald-600', pill: 'bg-emerald-50 text-emerald-700' },
  cancelled: { label: 'Cancelled', dot: 'bg-slate-400', pill: 'bg-slate-100 text-slate-500' },
  failed: { label: 'Failed', dot: 'bg-red-500', pill: 'bg-red-50 text-red-600' },
};

export const statusLabel = (status: CampaignStatus) => STATUS[status].label;

export const CampaignStatusPill: React.FC<{ status: CampaignStatus }> = ({ status }) => {
  const s = STATUS[status];
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${s.pill}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
};

/** White card with a numbered title, used by every wizard section */
export const SectionCard: React.FC<{
  step?: string;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}> = ({ step, title, description, action, children, className = '' }) => (
  <section className={`bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 ${className}`}>
    <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
      <div className="min-w-0">
        <h2 className="text-[15px] font-bold text-slate-900">
          {step && <span className="text-slate-400 mr-1.5 tabular-nums">{step}</span>}
          {title}
        </h2>
        {description && <p className="mt-0.5 text-[12px] text-slate-500">{description}</p>}
      </div>
      {action}
    </div>
    {children}
  </section>
);

export const FieldLabel: React.FC<{ htmlFor?: string; children: React.ReactNode; hint?: React.ReactNode }> = ({
  htmlFor,
  children,
  hint,
}) => (
  <div className="flex items-center justify-between gap-2 mb-1.5">
    <label htmlFor={htmlFor} className="text-[11px] font-bold text-slate-600 uppercase tracking-wider">
      {children}
    </label>
    {hint}
  </div>
);

/** "2h 15m", "45s"; "Instant" for zero */
export function formatDuration(totalSeconds: number): string {
  if (totalSeconds <= 0) return 'Instant';
  const d = Math.floor(totalSeconds / 86400);
  const h = Math.floor((totalSeconds % 86400) / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.round(totalSeconds % 60);
  const parts = d ? [`${d}d`, `${h}h`] : h ? [`${h}h`, `${m}m`] : m ? [`${m}m`, s ? `${s}s` : ''] : [`${s}s`];
  return parts.filter(Boolean).join(' ');
}

/** "Sat, 17 Oct 2026, 6:30 PM" in the given zone */
export function formatDateTime(iso: string | null | undefined, timeZone?: string): string {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat(undefined, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone,
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toLocaleString();
  }
}

export const formatNumber = (n: number) => n.toLocaleString();
