'use client';

import React, { useEffect, useState } from 'react';
import { AlertTriangle, Gauge, ShieldCheck, Users } from 'lucide-react';
import { apiClient } from '@/lib/api/client';
import { formatNumber } from '../ui';

/** Live limits of the sending number, from Meta (GET /api/channels/:id/whatsapp-profile) */
interface PhoneStatus {
  /** Business portfolio limit (current); shared by every number of the portfolio */
  whatsapp_business_manager_messaging_limit?: string;
  /** Deprecated per-number tier, used only when the portfolio limit is missing */
  messaging_limit_tier?: string;
  throughput?: { level?: string };
  quality_rating?: string;
}

/** Unique customers the number may start conversations with in a rolling 24 hours */
const TIER_LIMIT: Record<string, number> = {
  TIER_50: 50,
  TIER_250: 250,
  TIER_1K: 1_000,
  TIER_2K: 2_000,
  TIER_10K: 10_000,
  TIER_100K: 100_000,
};

const THROUGHPUT: Record<string, string> = {
  STANDARD: '≈ 80 msg / second',
  HIGH: 'Up to 1,000 msg / second',
};

const QUALITY: Record<string, { label: string; className: string }> = {
  GREEN: { label: 'High', className: 'text-emerald-700' },
  YELLOW: { label: 'Medium', className: 'text-amber-700' },
  RED: { label: 'Low', className: 'text-red-600' },
};

const Tile: React.FC<{ icon: React.ReactNode; label: string; value: React.ReactNode; hint?: string }> = ({ icon, label, value, hint }) => (
  <div className="p-3 rounded-xl border border-slate-200 bg-slate-50/50 min-w-0">
    <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
      {icon}
      {label}
    </p>
    <p className="mt-1 text-sm font-bold text-slate-900 truncate">{value}</p>
    {hint && <p className="text-[10px] text-slate-500">{hint}</p>}
  </div>
);

export const NumberHealth: React.FC<{ channelId: number | null; recipients: number }> = ({ channelId, recipients }) => {
  const [status, setStatus] = useState<PhoneStatus | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');

  useEffect(() => {
    if (!channelId) return;
    let active = true;
    setState('loading');
    setStatus(null);
    apiClient
      .get<{ phone: PhoneStatus }>(`/api/channels/${channelId}/whatsapp-profile`)
      .then((res) => {
        if (!active) return;
        setStatus(res.data?.phone ?? {});
        setState('idle');
      })
      .catch(() => active && setState('error'));
    return () => {
      active = false;
    };
  }, [channelId]);

  if (!channelId) return null;
  if (state === 'loading') return <p className="mt-4 text-[11px] text-slate-400">Checking this number&apos;s limits with Meta…</p>;
  if (state === 'error') return <p className="mt-4 text-[11px] text-slate-400">Couldn&apos;t load this number&apos;s limits from Meta.</p>;
  if (!status) return null;

  const tier = status.whatsapp_business_manager_messaging_limit ?? status.messaging_limit_tier;
  const limit = tier ? TIER_LIMIT[tier] : undefined;
  const unlimited = tier === 'TIER_UNLIMITED';
  const quality = status.quality_rating ? QUALITY[status.quality_rating] : undefined;
  const overLimit = limit !== undefined && recipients > limit;
  const days = limit ? Math.ceil(recipients / limit) : 1;

  return (
    <div className="mt-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Tile
          icon={<Users className="w-3 h-3" />}
          label="24 h limit"
          value={unlimited ? 'Unlimited' : limit ? `${formatNumber(limit)} customers` : 'Not reported by Meta'}
          hint="Unique customers per rolling 24 h, shared by all numbers in your business portfolio"
        />
        <Tile
          icon={<Gauge className="w-3 h-3" />}
          label="Throughput"
          value={THROUGHPUT[status.throughput?.level ?? ''] ?? 'Standard'}
        />
        <Tile
          icon={<ShieldCheck className="w-3 h-3" />}
          label="Quality"
          value={quality ? <span className={quality.className}>{quality.label}</span> : 'Not rated yet'}
          hint="Based on recent blocks and reports"
        />
      </div>

      {overLimit && (
        <p className="mt-3 px-3 py-2 rounded-lg bg-amber-50 border border-amber-100 text-[11px] text-amber-800 flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
          <span>
            This campaign has <b>{formatNumber(recipients)}</b> contacts, but your business portfolio can reach <b>{formatNumber(limit!)}</b> customers
            per 24 hours (shared by all its numbers, including other messages they send). Meta will reject the rest, and after 20 failures in a row the campaign stops. Split the list into
            about {days} campaigns on different days, or use a number with a higher limit.
          </span>
        </p>
      )}
      {status.quality_rating === 'RED' && (
        <p className="mt-3 px-3 py-2 rounded-lg bg-red-50 border border-red-100 text-[11px] text-red-700 flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
          This number&apos;s quality is low. More blocks or reports can make Meta lower its limit or restrict it; consider a smaller, more targeted list.
        </p>
      )}
    </div>
  );
};
