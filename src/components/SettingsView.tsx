'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Settings,
  ChevronDown,
  AlertTriangle,
  Loader2,
  Unplug,
  CalendarDays,
  Hash,
  Phone,
  Layers,
  Copy,
  Check,
  Plus,
  RefreshCw,
  Clock,
} from 'lucide-react';

import apiClient from '@/lib/api/client';
import { notifyError } from '@/lib/api/notify';
import { useRealtime } from '@/lib/hooks/useRealtime';
import { gooeyToast } from '@/components/ui/goey-toaster';
import { AddChannelModal } from './channels/AddChannelModal';
import { ChannelIcon } from './inbox/ChannelIcon';
import { formatPhone } from './inbox/inbox-types';

/** Row returned by GET /api/channels (disconnected channels are never returned) */
interface Channel {
  id: number;
  type: string;
  verified_name: string;
  handle?: string | null;
  phoneNumber?: string | null;
  metaPhoneNumberId?: string | null;
  wabaId?: string | null;
  status: string;
  tokenExpiresAt?: string | null;
  lastError?: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface DetailField {
  icon: React.ReactNode;
  label: string;
  value?: string | null;
}

// ─── Channel catalogue ────────────────────────────────────────────────────────

/** Channel types that will be connectable from Settings; only WhatsApp is live today */
const UPCOMING_CHANNELS: { type: string; label: string; description: string }[] = [
  { type: 'instagram', label: 'Instagram Direct', description: 'DMs, story mentions and replies.' },
  { type: 'messenger', label: 'Facebook Messenger', description: 'Conversations from your Facebook Page.' },
  { type: 'email', label: 'Email', description: 'A shared support mailbox.' },
];

const fmtDate = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null;

const STATUS_META: Record<string, { label: string; dot: string; pill: string }> = {
  connected: { label: 'Connected', dot: 'bg-emerald-500', pill: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  token_expired: { label: 'Token expired', dot: 'bg-amber-500', pill: 'bg-amber-50 text-amber-700 border-amber-200' },
  error: { label: 'Error', dot: 'bg-red-500', pill: 'bg-red-50 text-red-700 border-red-200' },
};

const needsReconnect = (ch: Channel) => ch.status === 'token_expired' || ch.status === 'error';

// ─── CopyField ────────────────────────────────────────────────────────────────

function CopyField({ icon, label, value }: DetailField) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {}
  };
  return (
    <div className="group flex items-center gap-2.5 min-w-0">
      <span className="text-slate-400 shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">{label}</p>
        <p className="text-xs font-medium text-slate-700 truncate">{value}</p>
      </div>
      <button
        type="button"
        onClick={copy}
        title={`Copy ${label.toLowerCase()}`}
        className="opacity-0 group-hover:opacity-100 focus:opacity-100 shrink-0 p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-all cursor-pointer"
      >
        {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
}

// ─── DisconnectDialog ─────────────────────────────────────────────────────────

function DisconnectDialog({
  channel,
  busy,
  onConfirm,
  onCancel,
}: {
  channel: Channel;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const number = formatPhone(channel.phoneNumber) || channel.verified_name;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div role="alertdialog" aria-modal="true" className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 p-6">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-red-50 text-red-500 flex items-center justify-center shrink-0">
            <Unplug className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-slate-900">Disconnect {number}?</h3>
            <p className="mt-0.5 text-xs text-slate-500">{channel.verified_name}</p>
          </div>
        </div>

        <ul className="mt-4 space-y-2 text-[13px] text-slate-600">
          <li className="flex gap-2">
            <span className="mt-2 w-1 h-1 rounded-full bg-slate-400 shrink-0" />
            UnoCX is removed from this WhatsApp Business Account at Meta, so new messages stop arriving.
          </li>
          <li className="flex gap-2">
            <span className="mt-2 w-1 h-1 rounded-full bg-slate-400 shrink-0" />
            The number disappears from the inbox and settings. Its past conversations stay readable but can&apos;t be replied to.
          </li>
          <li className="flex gap-2">
            <span className="mt-2 w-1 h-1 rounded-full bg-slate-400 shrink-0" />
            Reconnect the same number any time to pick those conversations back up.
          </li>
        </ul>

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-red-500 hover:bg-red-600 transition-colors cursor-pointer disabled:opacity-60 flex items-center gap-1.5"
          >
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {busy ? 'Disconnecting…' : 'Disconnect'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── ConnectionCard ───────────────────────────────────────────────────────────

function ConnectionCard({
  channel,
  expanded,
  onToggle,
  onDisconnect,
  onReconnect,
}: {
  channel: Channel;
  expanded: boolean;
  onToggle: () => void;
  onDisconnect: () => void;
  onReconnect: () => void;
}) {
  const status = STATUS_META[channel.status] ?? STATUS_META.error;
  const number = formatPhone(channel.phoneNumber);

  const fields: DetailField[] = [
    { icon: <Phone className="w-3.5 h-3.5" />, label: 'Phone number', value: number || null },
    { icon: <Hash className="w-3.5 h-3.5" />, label: 'Phone number ID', value: channel.metaPhoneNumberId },
    { icon: <Layers className="w-3.5 h-3.5" />, label: 'WABA ID', value: channel.wabaId },
    { icon: <CalendarDays className="w-3.5 h-3.5" />, label: 'Connected on', value: fmtDate(channel.createdAt) },
    { icon: <Clock className="w-3.5 h-3.5" />, label: 'Token expires', value: fmtDate(channel.tokenExpiresAt) },
    { icon: <Hash className="w-3.5 h-3.5" />, label: 'Channel ID', value: String(channel.id) },
  ];

  return (
    <div className={`rounded-xl border bg-white transition-shadow ${expanded ? 'border-slate-300 shadow-sm' : 'border-slate-200'}`}>
      <div className="flex items-center gap-3 px-4 py-3.5">
        <ChannelIcon type={channel.type} size="lg" />

        <button type="button" onClick={onToggle} aria-expanded={expanded} className="flex-1 min-w-0 text-left cursor-pointer">
          <p className="text-sm font-semibold text-slate-900 truncate">{number || channel.verified_name}</p>
          <p className="text-xs text-slate-500 truncate">
            {number ? channel.verified_name : 'WhatsApp Business'}
            <span className="text-slate-400"> · since {fmtDate(channel.createdAt)}</span>
          </p>
        </button>

        <span className={`hidden sm:inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[11px] font-semibold ${status.pill}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`} />
          {status.label}
        </span>

        {needsReconnect(channel) && (
          <button
            type="button"
            onClick={onReconnect}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-[#3440a8] hover:bg-[#2b358c] transition-colors cursor-pointer"
          >
            Reconnect
          </button>
        )}

        <button
          type="button"
          onClick={onToggle}
          title={expanded ? 'Hide details' : 'Show details'}
          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
        >
          <ChevronDown className={`w-4 h-4 transition-transform duration-150 ${expanded ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {expanded && (
        <div className="px-4 pb-4 pt-3 border-t border-slate-100">
          {channel.lastError && (
            <div className="mb-3 flex gap-2 p-3 rounded-lg bg-red-50 border border-red-100">
              <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
              <p className="text-xs text-red-600 leading-relaxed">{channel.lastError}</p>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-3">
            {fields.map((f) => (
              <CopyField key={f.label} {...f} />
            ))}
          </div>

          <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between gap-3">
            <p className="text-[11px] text-slate-400">Disconnecting also removes UnoCX from this account at Meta.</p>
            <button
              type="button"
              onClick={onDisconnect}
              className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-red-600 border border-red-200 hover:bg-red-50 transition-colors cursor-pointer"
            >
              <Unplug className="w-3.5 h-3.5" />
              Disconnect
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── ChannelsSection ──────────────────────────────────────────────────────────

function ChannelsSection() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [showConnect, setShowConnect] = useState(false);
  const [pendingDisconnect, setPendingDisconnect] = useState<Channel | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);

  const fetchChannels = useCallback(async ({ quiet = false }: { quiet?: boolean } = {}) => {
    if (!quiet) setLoading(true);
    try {
      const res = await apiClient.get<{ channels: Channel[] }>('/api/channels');
      setChannels(res.data.channels ?? []);
      setLoadError(null);
    } catch (err: any) {
      setLoadError(err?.message ?? 'Failed to load channels');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchChannels();
  }, [fetchChannels]);

  // Stay in sync with connects/disconnects made in other tabs or by teammates
  useRealtime({ onChannelUpdated: () => fetchChannels({ quiet: true }) });

  const toggle = (id: number) =>
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const confirmDisconnect = async () => {
    if (!pendingDisconnect) return;
    const channel = pendingDisconnect;
    setDisconnecting(true);
    try {
      const res = await apiClient.delete<{ metaUnsubscribed: boolean; metaSkippedReason?: string }>(`/api/channels/${channel.id}`);
      setChannels((prev) => prev.filter((c) => c.id !== channel.id));
      setPendingDisconnect(null);

      const number = formatPhone(channel.phoneNumber) || channel.verified_name;
      if (res.data.metaSkippedReason === 'meta_error' || res.data.metaSkippedReason === 'missing_credentials') {
        gooeyToast.warning(`${number} disconnected`, {
          description:
            "Removed from UnoCX, but Meta didn't confirm the unlink. You can also remove UnoCX in Meta Business Settings → Integrations.",
        });
      } else {
        gooeyToast.success(`${number} disconnected`, {
          description:
            res.data.metaSkippedReason === 'waba_shared'
              ? 'Other numbers on this WhatsApp Business Account are still connected, so the account stays linked at Meta.'
              : 'Removed from UnoCX and unlinked at Meta.',
        });
      }
    } catch (err) {
      notifyError(err, { where: 'SettingsView.disconnect', title: "Couldn't disconnect channel" });
    } finally {
      setDisconnecting(false);
    }
  };

  const whatsapp = channels.filter((c) => c.type === 'whatsapp');
  const attention = channels.filter(needsReconnect).length;

  if (loading) {
    return (
      <div className="px-8 space-y-3 max-w-4xl">
        {[0, 1].map((i) => (
          <div key={i} className="h-[68px] rounded-xl bg-slate-100 animate-pulse" />
        ))}
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex flex-col items-center gap-3 py-20">
        <AlertTriangle className="w-5 h-5 text-amber-400" />
        <p className="text-sm text-slate-500">{loadError}</p>
        <button
          onClick={() => fetchChannels()}
          className="inline-flex items-center gap-1.5 text-sm text-[#3440a8] hover:underline cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Retry
        </button>
      </div>
    );
  }

  return (
    <div className="px-8 pb-10 space-y-8 max-w-4xl">
      {/* Summary */}
      <div className="flex items-center justify-between gap-4">
        <p className="text-xs text-slate-500 flex items-center gap-2">
          <span
            className={`w-1.5 h-1.5 rounded-full ${attention > 0 ? 'bg-amber-500' : channels.length ? 'bg-emerald-500' : 'bg-slate-300'}`}
          />
          {channels.length === 0
            ? 'No channels connected yet'
            : `${channels.length} connected${attention > 0 ? ` · ${attention} need${attention === 1 ? 's' : ''} attention` : ''}`}
        </p>
        <button
          type="button"
          onClick={() => setShowConnect(true)}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold text-white bg-[#3440a8] hover:bg-[#2b358c] transition-colors cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
          Connect channel
        </button>
      </div>

      {/* WhatsApp */}
      <section>
        <div className="flex items-end justify-between mb-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">WhatsApp</h2>
            <p className="text-xs text-slate-500">Official Meta Cloud API. Every connected number feeds the shared inbox.</p>
          </div>
          {whatsapp.length > 0 && (
            <button
              type="button"
              onClick={() => setShowConnect(true)}
              className="flex items-center gap-1 text-xs font-semibold text-[#3440a8] hover:underline cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              Add number
            </button>
          )}
        </div>

        {whatsapp.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/50 px-6 py-8 flex flex-col items-center text-center">
            <ChannelIcon type="whatsapp" size="lg" />
            <p className="mt-3 text-sm font-semibold text-slate-800">Connect your WhatsApp Business number</p>
            <p className="mt-1 text-xs text-slate-500 max-w-sm">
              Sign in with Facebook to link a number through Meta. Messages to it will land in your UnoCX inbox.
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
        ) : (
          <div className="space-y-2.5">
            {whatsapp.map((ch) => (
              <ConnectionCard
                key={ch.id}
                channel={ch}
                expanded={expandedIds.has(ch.id)}
                onToggle={() => toggle(ch.id)}
                onDisconnect={() => setPendingDisconnect(ch)}
                onReconnect={() => setShowConnect(true)}
              />
            ))}
          </div>
        )}
      </section>

      {/* Coming soon */}
      <section>
        <h2 className="text-sm font-semibold text-slate-900">More channels</h2>
        <p className="text-xs text-slate-500 mb-3">Coming soon. They&apos;ll be connectable from here.</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          {UPCOMING_CHANNELS.map((c) => (
            <div key={c.type} className="rounded-xl border border-slate-200 bg-white px-4 py-3.5 flex items-start gap-3">
              <ChannelIcon type={c.type} size="md" className="opacity-60" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-[13px] font-semibold text-slate-700 truncate">{c.label}</p>
                  <span className="text-[9px] font-bold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded-full shrink-0">SOON</span>
                </div>
                <p className="text-[11px] text-slate-400 mt-0.5">{c.description}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <AddChannelModal
        isOpen={showConnect}
        onClose={() => setShowConnect(false)}
        onSuccess={() => fetchChannels({ quiet: true })}
      />

      {pendingDisconnect && (
        <DisconnectDialog
          channel={pendingDisconnect}
          busy={disconnecting}
          onConfirm={confirmDisconnect}
          onCancel={() => setPendingDisconnect(null)}
        />
      )}
    </div>
  );
}

// ─── GeneralSection ───────────────────────────────────────────────────────────

function GeneralSection() {
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
      <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center">
        <Settings className="w-5 h-5 text-slate-400" />
      </div>
      <div>
        <p className="text-sm font-semibold text-slate-700">General settings coming soon</p>
        <p className="text-xs text-slate-400 mt-1 max-w-xs leading-relaxed">
          Workspace preferences, timezone, and notification settings will be available here.
        </p>
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

type Section = 'general' | 'channels';

const SECTION_COPY: Record<Section, { title: string; subtitle: string }> = {
  general: { title: 'General', subtitle: 'Manage your workspace preferences' },
  channels: { title: 'Channels', subtitle: 'Connect the messaging accounts your team replies from and manage the ones already connected' },
};

export const SettingsView: React.FC = () => {
  const [activeSection, setActiveSection] = useState<Section>('channels');

  const NAV: { key: Section; label: string; badge?: string }[] = [
    { key: 'general', label: 'General', badge: 'Soon' },
    { key: 'channels', label: 'Channels' },
  ];

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <aside className="w-[180px] shrink-0 border-r border-slate-100 flex flex-col pt-6">
        <p className="px-4 mb-3 text-[11px] font-bold text-slate-400 uppercase tracking-widest">Settings</p>
        <nav className="px-2 space-y-0.5">
          {NAV.map(({ key, label, badge }) => {
            const active = activeSection === key;
            return (
              <button
                key={key}
                onClick={() => setActiveSection(key)}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors cursor-pointer text-left ${
                  active ? 'bg-slate-100 text-slate-900 font-semibold' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
                }`}
              >
                <span className="flex-1">{label}</span>
                {badge && (
                  <span className="text-[9px] font-bold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded-full">{badge}</span>
                )}
              </button>
            );
          })}
        </nav>
      </aside>

      {/* Content */}
      <main className="flex-1 overflow-y-auto">
        <div className="px-8 pt-7 pb-5 mb-6 border-b border-slate-100">
          <h1 className="text-base font-bold text-slate-900">{SECTION_COPY[activeSection].title}</h1>
          <p className="text-xs text-slate-500 mt-0.5">{SECTION_COPY[activeSection].subtitle}</p>
        </div>

        {activeSection === 'general' && <GeneralSection />}
        {activeSection === 'channels' && <ChannelsSection />}
      </main>
    </div>
  );
};

export default SettingsView;
