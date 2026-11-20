'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink, Info, RefreshCw } from 'lucide-react';

import apiClient from '@/lib/api/client';
import { gooeyToast } from '@/components/ui/goey-toaster';
import { ErrorState } from '@/components/ui/states';
import type { Channel } from './channel-settings';

/** Live phone number fields from GET /api/channels/:id/whatsapp-profile */
interface PhoneStatus {
  display_phone_number?: string;
  verified_name?: string;
  name_status?: string;
  quality_rating?: string;
  /** Business portfolio limit (current); shared by every number of the portfolio */
  whatsapp_business_manager_messaging_limit?: string;
  /** Deprecated per-number tier, used only when the portfolio limit is missing */
  messaging_limit_tier?: string;
  throughput?: { level?: string };
  is_on_biz_app?: boolean;
}

// ─── Meta value → label maps ──────────────────────────────────────────────────

const QUALITY: Record<string, { label: string; bars: number; bar: string; text: string }> = {
  GREEN: { label: 'High', bars: 3, bar: 'bg-emerald-600', text: 'text-emerald-700' },
  YELLOW: { label: 'Medium', bars: 2, bar: 'bg-amber-500', text: 'text-amber-700' },
  RED: { label: 'Low', bars: 1, bar: 'bg-red-500', text: 'text-red-600' },
};
const QUALITY_UNRATED = { label: 'Not rated yet', bars: 0, bar: 'bg-slate-300', text: 'text-slate-500' };

const LIMIT_TIERS: Record<string, string> = {
  TIER_50: '50',
  TIER_250: '250',
  TIER_1K: '1,000',
  TIER_2K: '2,000',
  TIER_10K: '10,000',
  TIER_100K: '100,000',
};

const messagingLimit = (tier?: string) =>
  tier === 'TIER_UNLIMITED' ? 'Unlimited customers' : tier && LIMIT_TIERS[tier] ? `${LIMIT_TIERS[tier]} customers / 24 h` : null;

const THROUGHPUT: Record<string, string> = {
  STANDARD: '80 messages / second',
  HIGH: 'Up to 1,000 messages / second',
};

const NAME_STATUS: Record<string, { label: string; className: string }> = {
  APPROVED: { label: 'Approved', className: 'text-emerald-700' },
  AVAILABLE_WITHOUT_REVIEW: { label: 'Approved', className: 'text-emerald-700' },
  PENDING_REVIEW: { label: 'In review', className: 'text-amber-700' },
  DECLINED: { label: 'Declined', className: 'text-red-600' },
  EXPIRED: { label: 'Expired', className: 'text-slate-500' },
};

const coexistence = (onBizApp?: boolean) => (onBizApp === true ? "On · owner's phone" : onBizApp === false ? 'Off · API only' : null);

const metaSuiteUrl = (wabaId?: string | null) =>
  wabaId
    ? `https://business.facebook.com/wa/manage/phone-numbers/?waba_id=${encodeURIComponent(wabaId)}`
    : 'https://business.facebook.com/wa/manage/home/';

function Metric({ label, value, loading, children }: { label: string; value?: string | null; loading: boolean; children?: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">{label}</p>
      {loading ? (
        <div className="mt-1.5 h-3.5 w-24 rounded bg-slate-100 animate-pulse" />
      ) : (
        children ?? <p className="mt-0.5 text-xs font-medium text-slate-700 truncate">{value ?? '—'}</p>
      )}
    </div>
  );
}

/**
 * Health of one WhatsApp number at Meta (quality, messaging limit, throughput, display name review), read live
 * when the channel card is opened. Disconnected numbers have no token, so nothing is read for them.
 */
export function WhatsAppNumberHealth({ channel }: { channel: Channel }) {
  const [phone, setPhone] = useState<PhoneStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const request = useRef(0);
  const paused = channel.status === 'disconnected';

  const load = useCallback(async () => {
    if (paused) return;
    const current = ++request.current;
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<{ phone: PhoneStatus }>(`/api/channels/${channel.id}/whatsapp-profile`);
      if (current === request.current) setPhone(res.data.phone ?? {});
    } catch (err) {
      if (current === request.current) setError(err);
    } finally {
      if (current === request.current) setLoading(false);
    }
  }, [channel.id, paused]);

  useEffect(() => {
    load();
  }, [load]);

  const quality = (phone?.quality_rating && QUALITY[phone.quality_rating]) || QUALITY_UNRATED;
  const nameStatus = phone?.name_status ? NAME_STATUS[phone.name_status] ?? { label: phone.name_status, className: 'text-slate-600' } : null;
  const metricsLoading = loading && !phone;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold text-slate-700">Number health at Meta</p>
        {!paused && (
          <button
            type="button"
            onClick={load}
            disabled={loading}
            title="Refresh from Meta"
            className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        )}
      </div>

      {error ? (
        <ErrorState error={error} title="Couldn't read this number from Meta" compact onRetry={load} retrying={loading} />
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-x-6 gap-y-3">
          <Metric label="Display name" loading={metricsLoading}>
            <p className="mt-0.5 text-xs font-medium text-slate-700 truncate">
              {phone?.verified_name || channel.verified_name}
              {nameStatus && <span className={`ml-1 font-semibold ${nameStatus.className}`}>· {nameStatus.label}</span>}
            </p>
          </Metric>
          <Metric label="Quality rating" loading={metricsLoading}>
            {paused ? (
              <p className="mt-0.5 text-xs font-medium text-slate-400">Paused</p>
            ) : (
              <div className="mt-1 flex items-center gap-2">
                <div className="flex gap-0.5">
                  {[0, 1, 2].map((i) => (
                    <span key={i} className={`h-1.5 w-5 rounded-full ${i < quality.bars ? quality.bar : 'bg-slate-200'}`} />
                  ))}
                </div>
                <span className={`text-xs font-semibold ${quality.text}`}>{quality.label}</span>
              </div>
            )}
          </Metric>
          <Metric label="Messaging limit" value={paused ? 'Paused' : messagingLimit(phone?.whatsapp_business_manager_messaging_limit ?? phone?.messaging_limit_tier)} loading={metricsLoading} />
          <Metric
            label="Throughput"
            value={paused ? 'Paused' : phone?.throughput?.level ? THROUGHPUT[phone.throughput.level] ?? phone.throughput.level : null}
            loading={metricsLoading}
          />
          <Metric label="Coexistence" value={paused ? 'Paused' : coexistence(phone?.is_on_biz_app)} loading={metricsLoading} />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <a
          href={metaSuiteUrl(channel.wabaId)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs font-semibold text-[#3440a8] hover:underline"
        >
          Open in Meta Business Suite <ExternalLink className="w-3 h-3" />
        </a>
        <button
          type="button"
          onClick={() =>
            gooeyToast.info('Changing the display name is coming soon', { description: 'Until then, request a new display name in Meta Business Suite.' })
          }
          className="text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer"
        >
          Change display name
        </button>
        <span className="inline-flex items-center gap-1 text-[11px] text-slate-400" title="Customers will be able to message you without your phone number">
          <Info className="w-3 h-3" /> WhatsApp username: coming soon
        </span>
      </div>
    </div>
  );
}

export default WhatsAppNumberHealth;
