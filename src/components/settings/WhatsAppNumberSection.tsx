'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { MessageCircle, ExternalLink, Info, Loader2, Plus, AlertTriangle, Unplug, RefreshCw } from 'lucide-react';

import apiClient from '@/lib/api/client';
import { notifyError } from '@/lib/api/notify';
import { useRealtime } from '@/lib/hooks/useRealtime';
import { gooeyToast } from '@/components/ui/goey-toaster';
import { ErrorState } from '@/components/ui/states';
import {
  WHATSAPP_BUSINESS_VERTICALS,
  WHATSAPP_PROFILE_LIMITS,
  type WhatsAppBusinessProfile,
} from '@/types/whatsapp';
import { AddChannelModal } from '../channels/AddChannelModal';
import { formatPhone } from '../inbox/inbox-types';
import { Channel, STATUS_META, fmtDate, needsReconnect, useDisconnectChannel } from './channel-settings';

/** Live phone number fields from GET /api/channels/:id/whatsapp-profile */
interface PhoneStatus {
  id: string;
  display_phone_number?: string;
  verified_name?: string;
  name_status?: string;
  quality_rating?: string;
  messaging_limit_tier?: string;
  throughput?: { level?: string };
  is_on_biz_app?: boolean;
}

interface NumberDetails {
  phone: PhoneStatus;
  profile: WhatsAppBusinessProfile;
}

/** The editable profile fields as the form holds them (website without its scheme) */
interface ProfileForm {
  about: string;
  vertical: string;
  email: string;
  website: string;
  address: string;
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

export const NAME_STATUS: Record<string, { label: string; className: string }> = {
  APPROVED: { label: 'Approved', className: 'font-bold text-emerald-600' },
  AVAILABLE_WITHOUT_REVIEW: { label: 'Approved', className: 'font-bold text-emerald-600' },
  PENDING_REVIEW: { label: 'Name in review', className: 'font-semibold text-amber-600' },
  DECLINED: { label: 'Name declined', className: 'font-semibold text-red-600' },
  EXPIRED: { label: 'Name expired', className: 'font-semibold text-slate-500' },
};

const coexistence = (onBizApp?: boolean) =>
  onBizApp === true ? "On · owner's phone" : onBizApp === false ? 'Off · API only' : null;

const metaSuiteUrl = (wabaId?: string | null) =>
  wabaId
    ? `https://business.facebook.com/wa/manage/phone-numbers/?waba_id=${encodeURIComponent(wabaId)}`
    : 'https://business.facebook.com/wa/manage/home/';

const initialsOf = (value?: string | null) => {
  const parts = (value ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return (parts[0] ?? 'WA').slice(0, 2).toUpperCase();
};

// ─── Form helpers ─────────────────────────────────────────────────────────────

const toForm = (p: WhatsAppBusinessProfile): ProfileForm => ({
  about: p.about ?? '',
  vertical: p.vertical && WHATSAPP_BUSINESS_VERTICALS.some((v) => v.value === p.vertical) ? p.vertical : '',
  email: p.email ?? '',
  website: (p.websites?.[0] ?? '').replace(/^https?:\/\//i, ''),
  address: p.address ?? '',
});

/** Only the fields that changed, shaped for PATCH /api/channels/:id/whatsapp-profile */
function profileChanges(form: ProfileForm, initial: ProfileForm, profile: WhatsAppBusinessProfile) {
  const changes: Record<string, unknown> = {};
  for (const key of ['about', 'email', 'address'] as const) {
    if (form[key].trim() !== initial[key].trim()) changes[key] = form[key].trim();
  }
  if (form.vertical && form.vertical !== initial.vertical) changes.vertical = form.vertical;
  if (form.website.trim() !== initial.website.trim()) {
    const site = form.website.trim();
    const primary = site && !/^https?:\/\//i.test(site) ? `https://${site}` : site;
    // Only the first website is editable here; a second one set in Meta is kept
    changes.websites = [primary, ...(profile.websites ?? []).slice(1)].filter(Boolean);
  }
  return changes;
}

// ─── Small building blocks ────────────────────────────────────────────────────

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6">
      <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
      {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Metric({ label, value, loading, children }: { label: string; value?: string | null; loading: boolean; children?: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] text-slate-500">{label}</p>
      {loading ? (
        <div className="mt-1.5 h-4 w-28 rounded bg-slate-100 animate-pulse" />
      ) : (
        children ?? <p className="mt-1 text-[13px] font-semibold text-slate-900 truncate">{value ?? '—'}</p>
      )}
    </div>
  );
}

const inputClass =
  'w-full px-3 py-2 text-[13px] text-slate-900 bg-white border border-slate-200 rounded-lg placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#3440a8]/20 focus:border-[#3440a8] disabled:bg-slate-50 disabled:text-slate-500 transition-colors';

function Field({ label, hint, className = '', children }: { label: string; hint?: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={`block ${className}`}>
      <span className="flex items-baseline justify-between gap-2 text-xs text-slate-600 mb-1.5">
        {label}
        {hint && <span className="text-[10px] text-slate-400">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

// ─── WhatsAppNumberSection ────────────────────────────────────────────────────

export function WhatsAppNumberSection({ onOpenChannels }: { onOpenChannels: () => void }) {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [channelsLoading, setChannelsLoading] = useState(true);
  const [channelsError, setChannelsError] = useState<unknown>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const [details, setDetails] = useState<NumberDetails | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState<unknown>(null);
  const detailsRequest = useRef(0);

  const [form, setForm] = useState<ProfileForm | null>(null);
  const [initialForm, setInitialForm] = useState<ProfileForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [showConnect, setShowConnect] = useState(false);

  const handleDisconnected = (updatedChannel: Channel) => {
    setChannels((prev) => prev.map((c) => (c.id === updatedChannel.id ? updatedChannel : c)));
  };
  const { requestDisconnect, dialog: disconnectDialog } = useDisconnectChannel(handleDisconnected);


  const fetchChannels = useCallback(async ({ quiet = false }: { quiet?: boolean } = {}) => {
    if (!quiet) setChannelsLoading(true);
    try {
      const res = await apiClient.get<{ channels: Channel[] }>('/api/channels', { params: { type: 'whatsapp' } });
      setChannels(res.data.channels ?? []);
      setChannelsError(null);
    } catch (err) {
      setChannelsError(err);
    } finally {
      setChannelsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchChannels();
  }, [fetchChannels]);

  // Stay in sync with connects/disconnects made in other tabs or by teammates
  useRealtime({ onChannelUpdated: () => fetchChannels({ quiet: true }) });

  // Keep a valid selection as numbers come and go
  useEffect(() => {
    if (channels.length === 0) setSelectedId(null);
    else if (!channels.some((c) => c.id === selectedId)) setSelectedId(channels[0].id);
  }, [channels, selectedId]);

  const fetchDetails = useCallback(async (channelId: number) => {
    const ch = channels.find((c) => c.id === channelId);
    if (ch?.status === 'disconnected') {
      setDetails(null);
      setForm(null);
      setInitialForm(null);
      setDetailsLoading(false);
      setDetailsError(null);
      return;
    }
    const request = ++detailsRequest.current;
    setDetailsLoading(true);
    setDetailsError(null);
    // Never show one number's health or profile under another number's header
    setDetails(null);
    setForm(null);
    setInitialForm(null);
    try {
      const res = await apiClient.get<NumberDetails>(`/api/channels/${channelId}/whatsapp-profile`);
      if (request !== detailsRequest.current) return;
      setDetails({ phone: res.data.phone, profile: res.data.profile ?? {} });
      const next = toForm(res.data.profile ?? {});
      setForm(next);
      setInitialForm(next);
    } catch (err) {
      if (request !== detailsRequest.current) return;
      setDetails(null);
      setForm(null);
      setInitialForm(null);
      setDetailsError(err);
    } finally {
      if (request === detailsRequest.current) setDetailsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedId !== null) fetchDetails(selectedId);
  }, [selectedId, fetchDetails]);

  const channel = channels.find((c) => c.id === selectedId) ?? null;
  const changes = form && initialForm && details ? profileChanges(form, initialForm, details.profile) : {};
  const dirty = Object.keys(changes).length > 0;

  const setField = (key: keyof ProfileForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((prev) => (prev ? { ...prev, [key]: e.target.value } : prev));

  const selectNumber = (id: number) => {
    if (dirty && !window.confirm('You have unsaved changes to this business profile. Discard them?')) return;
    setSelectedId(id);
  };

  const discard = () => setForm(initialForm);

  const save = async () => {
    if (!channel || !dirty) return;
    setSaving(true);
    try {
      const res = await apiClient.patch<{ profile: WhatsAppBusinessProfile }>(
        `/api/channels/${channel.id}/whatsapp-profile`,
        changes
      );
      const profile = res.data.profile ?? {};
      setDetails((prev) => (prev ? { ...prev, profile } : prev));
      const next = toForm(profile);
      setForm(next);
      setInitialForm(next);
      gooeyToast.success('Business profile saved', { description: 'Customers will see the update in their WhatsApp chat.' });
    } catch (err) {
      notifyError(err, { where: 'WhatsAppNumberSection.save', title: "Couldn't save business profile" });
    } finally {
      setSaving(false);
    }
  };

  const comingSoon = (feature: string, description?: string) => gooeyToast.info(`${feature} is coming soon`, { description });

  // ── Loading / error / empty ──

  if (channelsLoading) {
    return (
      <div className="px-8 pb-10 space-y-5 max-w-5xl">
        {[180, 320, 200].map((h) => (
          <div key={h} style={{ height: h }} className="rounded-xl bg-slate-100 animate-pulse" />
        ))}
      </div>
    );
  }

  if (channelsError) {
    return (
      <div className="px-8 max-w-5xl">
        <div className="rounded-xl border border-slate-200 bg-white">
          <ErrorState error={channelsError} title="Couldn't load WhatsApp numbers" onRetry={() => fetchChannels()} />
        </div>
      </div>
    );
  }

  if (!channel) {
    return (
      <div className="px-8 pb-10 max-w-5xl">
        <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 flex flex-col items-center text-center">
          <div className="w-12 h-12 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
            <MessageCircle className="w-6 h-6" />
          </div>
          <p className="mt-3 text-sm font-semibold text-slate-800">No WhatsApp number connected</p>
          <p className="mt-1 text-xs text-slate-500 max-w-sm">
            Connect a number through Meta to manage its business profile and see its health here.
          </p>
          <button
            type="button"
            onClick={() => setShowConnect(true)}
            className="mt-4 flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold text-white bg-[#3440a8] hover:bg-[#2b358c] transition-colors cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            Connect WhatsApp
          </button>
        </div>
        <AddChannelModal isOpen={showConnect} onClose={() => setShowConnect(false)} onSuccess={() => fetchChannels({ quiet: true })} />
      </div>
    );
  }

  // ── Connected number ──

  const phone = details?.phone;
  const status = STATUS_META[channel.status] ?? STATUS_META.error;
  const number = formatPhone(phone?.display_phone_number || channel.phoneNumber) || channel.verified_name;
  const displayName = phone?.verified_name || channel.verified_name;
  const nameStatus =
    channel.status === 'disconnected'
      ? null
      : phone?.name_status
      ? NAME_STATUS[phone.name_status] ?? { label: phone.name_status, className: 'font-semibold text-slate-600' }
      : channel.status === 'connected' && displayName
      ? { label: 'Approved', className: 'font-bold text-emerald-600' }
      : null;
  const quality = (phone?.quality_rating && QUALITY[phone.quality_rating]) || QUALITY_UNRATED;
  const metricsLoading = detailsLoading && !details;

  return (
    <div className="px-8 pb-10 max-w-5xl">
      {/* Action bar */}
      <div className="sticky top-0 z-10 -mx-2 px-2 py-3 mb-2 bg-[#f8f9fc]/95 backdrop-blur-sm flex items-center justify-between gap-3">
        <div className="min-w-0">
          {channels.length > 1 && (
            <label className="flex items-center gap-2 text-xs text-slate-500">
              Number
              <select
                value={channel.id}
                onChange={(e) => selectNumber(Number(e.target.value))}
                className="px-2.5 py-1.5 text-xs font-semibold text-slate-800 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3440a8]/20 cursor-pointer"
              >
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    {formatPhone(c.phoneNumber) || c.verified_name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {dirty && <span className="hidden sm:inline text-[11px] text-slate-400 mr-1">Unsaved changes</span>}
          <button
            type="button"
            onClick={discard}
            disabled={!dirty || saving}
            className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Discard
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!dirty || saving}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold text-white bg-[#3440a8] hover:bg-[#2b358c] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>

      <div className="space-y-5">
        {channel.status === 'disconnected' ? (
          <div className="flex items-center gap-3 p-3.5 rounded-xl bg-slate-50 border border-slate-200">
            <span className="w-2.5 h-2.5 rounded-full bg-slate-400 shrink-0 ml-1" />
            <div className="flex-1">
              <p className="text-xs font-semibold text-slate-800">Messaging is paused for this number</p>
              <p className="text-[11px] text-slate-500">Access token removed. Reconnect anytime to resume sending and receiving messages.</p>
            </div>
            <button
              type="button"
              onClick={() => setShowConnect(true)}
              className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-[#3440a8] hover:bg-[#2b358c] transition-colors cursor-pointer flex items-center gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Reconnect
            </button>
          </div>
        ) : needsReconnect(channel) ? (
          <div className="flex items-center gap-3 p-3.5 rounded-xl bg-amber-50 border border-amber-200">
            <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
            <p className="flex-1 text-xs text-amber-800">
              {channel.lastError || 'Meta access for this number has expired. Reconnect it to keep receiving messages.'}
            </p>
            <button
              type="button"
              onClick={() => setShowConnect(true)}
              className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-[#3440a8] hover:bg-[#2b358c] transition-colors cursor-pointer"
            >
              Reconnect
            </button>
          </div>
        ) : null}

        {/* Connected number */}
        <Card title="Connected number" subtitle="Meta WhatsApp Business Platform · Cloud API">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0">
              <MessageCircle className="w-6 h-6" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-lg font-semibold font-mono tracking-tight text-slate-900 truncate">{number}</p>
              <p className="text-xs text-slate-500 truncate">
                Display name: {displayName}
                {nameStatus && (
                  <>
                    {' · '}
                    <span className={nameStatus.className}>{nameStatus.label}</span>
                  </>
                )}
                <span className="text-slate-400"> · connected {fmtDate(channel.createdAt)}</span>
              </p>
            </div>
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-semibold shrink-0 ${status.pill}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`} />
              {status.label}
            </span>
          </div>

          <div className="mt-6 grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-4">
            <Metric label="Quality rating" loading={metricsLoading}>
              {channel.status === 'disconnected' ? (
                <span className="text-[13px] font-medium text-slate-400">Paused</span>
              ) : (
                <div className="mt-1.5 flex items-center gap-2.5">
                  <div className="flex gap-1">
                    {[0, 1, 2].map((i) => (
                      <span key={i} className={`h-1.5 w-7 rounded-full ${i < quality.bars ? quality.bar : 'bg-slate-200'}`} />
                    ))}
                  </div>
                  <span className={`text-[13px] font-semibold ${quality.text}`}>{quality.label}</span>
                </div>
              )}
            </Metric>
            <Metric
              label="Messaging limit"
              value={channel.status === 'disconnected' ? 'Paused' : messagingLimit(phone?.messaging_limit_tier)}
              loading={metricsLoading}
            />
            <Metric
              label="Throughput"
              value={
                channel.status === 'disconnected'
                  ? 'Paused'
                  : phone?.throughput?.level
                  ? THROUGHPUT[phone.throughput.level] ?? null
                  : null
              }
              loading={metricsLoading}
            />
            <Metric
              label="Coexistence"
              value={channel.status === 'disconnected' ? 'Paused' : coexistence(phone?.is_on_biz_app)}
              loading={metricsLoading}
            />
          </div>

          <div className="mt-6 pt-4 border-t border-slate-100 flex flex-wrap items-center justify-between gap-y-3">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
              <button
                type="button"
                onClick={() => comingSoon('Changing the display name', 'Until then, request a new display name in Meta Business Suite.')}
                className="px-3.5 py-2 rounded-lg text-xs font-semibold text-slate-800 bg-white border border-slate-300 hover:bg-slate-50 transition-colors cursor-pointer"
              >
                Change display name
              </button>
              <a
                href={metaSuiteUrl(channel.wabaId)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs font-semibold text-[#3440a8] hover:underline"
              >
                Open in Meta Business Suite
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>

            {channel.status !== 'disconnected' ? (
              <button
                type="button"
                onClick={() => requestDisconnect(channel)}
                className="px-3.5 py-2 rounded-lg text-xs font-semibold text-red-600 hover:text-red-700 hover:bg-red-50 border border-red-200 transition-colors cursor-pointer flex items-center gap-1.5"
              >
                <Unplug className="w-3.5 h-3.5" />
                Disconnect
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setShowConnect(true)}
                className="px-3.5 py-2 rounded-lg text-xs font-semibold text-white bg-[#3440a8] hover:bg-[#2b358c] transition-colors cursor-pointer flex items-center gap-1.5"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Reconnect number
              </button>
            )}
          </div>
        </Card>

        {/* Business profile */}
        {/* <Card title="Business profile" subtitle="Customers see this when they open your chat">
          {detailsError ? (
            <ErrorState
              error={detailsError}
              title="Couldn't load the business profile from Meta"
              onRetry={() => fetchDetails(channel.id)}
              retrying={detailsLoading}
            />
          ) : !form ? (
            <div className="flex gap-6">
              <div className="w-20 h-20 rounded-full bg-slate-100 animate-pulse shrink-0" />
              <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="h-14 rounded-lg bg-slate-100 animate-pulse" />
                ))}
              </div>
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row gap-6">
              <div className="flex flex-col items-center gap-2 shrink-0">
                {details?.profile.profile_picture_url ? (
                  <img
                    src={details.profile.profile_picture_url}
                    alt={`${displayName} profile photo`}
                    className="w-20 h-20 rounded-full object-cover border border-slate-200"
                  />
                ) : (
                  <div className="w-20 h-20 rounded-full bg-[#fde8ef] text-[#c0365f] flex items-center justify-center text-xl font-semibold">
                    {initialsOf(displayName)}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => comingSoon('Changing the profile photo')}
                  className="text-xs font-semibold text-[#3440a8] hover:underline cursor-pointer"
                >
                  Change photo
                </button>
              </div>

              <div className="flex-1 min-w-0 grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-4">
                <Field label="About" hint={`${form.about.length}/${WHATSAPP_PROFILE_LIMITS.about}`}>
                  <input
                    value={form.about}
                    onChange={setField('about')}
                    maxLength={WHATSAPP_PROFILE_LIMITS.about}
                    placeholder="A short line about your business"
                    className={inputClass}
                  />
                </Field>
                <Field label="Category">
                  <select value={form.vertical} onChange={setField('vertical')} className={`${inputClass} cursor-pointer`}>
                    <option value="" disabled>
                      Choose a category
                    </option>
                    {WHATSAPP_BUSINESS_VERTICALS.map((v) => (
                      <option key={v.value} value={v.value}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Business email">
                  <input
                    type="email"
                    value={form.email}
                    onChange={setField('email')}
                    maxLength={WHATSAPP_PROFILE_LIMITS.email}
                    placeholder="hello@yourstore.com"
                    className={inputClass}
                  />
                </Field>
                <Field label="Website">
                  <div className="flex rounded-lg border border-slate-200 bg-white focus-within:ring-2 focus-within:ring-[#3440a8]/20 focus-within:border-[#3440a8] transition-colors overflow-hidden">
                    <span className="px-3 flex items-center text-[13px] text-slate-400 bg-slate-50 border-r border-slate-200">https://</span>
                    <input
                      value={form.website}
                      onChange={setField('website')}
                      maxLength={WHATSAPP_PROFILE_LIMITS.website}
                      placeholder="yourstore.com"
                      className="flex-1 min-w-0 px-3 py-2 text-[13px] text-slate-900 placeholder:text-slate-400 focus:outline-none"
                    />
                  </div>
                </Field>
                <Field label="Address" className="md:col-span-2">
                  <input
                    value={form.address}
                    onChange={setField('address')}
                    maxLength={WHATSAPP_PROFILE_LIMITS.address}
                    placeholder="Street, city, state and PIN code"
                    className={inputClass}
                  />
                </Field>
              </div>
            </div>
          )}
        </Card> */}

        {/* Username and identity */}
        <Card title="Username and identity" subtitle="WhatsApp usernames let customers message you without sharing a phone number">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
            <div>
              <p className="text-xs text-slate-600 mb-1.5">WhatsApp username</p>
              <div className="flex items-center gap-3">
                <div className="flex flex-1 rounded-lg border border-slate-200 bg-slate-50 overflow-hidden">
                  <span className="px-3 flex items-center text-[13px] text-slate-400 border-r border-slate-200">@</span>
                  <input
                    disabled
                    placeholder="username"
                    className="flex-1 min-w-0 px-3 py-2 text-[13px] font-mono bg-transparent text-slate-500 placeholder:text-slate-400 cursor-not-allowed"
                  />
                </div>
                <span className="shrink-0 px-2.5 py-1 rounded-full bg-slate-100 text-slate-500 text-[11px] font-semibold">Coming soon</span>
              </div>
            </div>
            <div className="flex gap-2.5 p-3.5 rounded-lg bg-[#eef0fb] text-[#2b358c]">
              <Info className="w-4 h-4 shrink-0 mt-0.5" />
              <p className="text-xs leading-relaxed">
                Contacts who write via your username arrive with a business-scoped ID (BSUID) and may have no phone number.
                UnoCX will store both and merge them when a phone is shared.
              </p>
            </div>
          </div>
        </Card>

        <p className="text-[11px] text-slate-400">
          Looking for every connected number?{' '}
          <button type="button" onClick={onOpenChannels} className="font-semibold text-[#3440a8] hover:underline cursor-pointer">
            Manage channels
          </button>
        </p>
      </div>

      <AddChannelModal isOpen={showConnect} onClose={() => setShowConnect(false)} onSuccess={() => fetchChannels({ quiet: true })} />
      {disconnectDialog}
    </div>
  );
}

export default WhatsAppNumberSection;
