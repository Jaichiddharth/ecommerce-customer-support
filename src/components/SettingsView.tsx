'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Settings,
  Radio,
  ChevronDown,
  AlertTriangle,
  CheckCircle2,
  Clock,
  XCircle,
  MessageCircle,
  Mail,
  Globe,
  Loader2,
  Unplug,
  CalendarDays,
  Hash,
  Phone,
  Layers,
  AtSign,
  Copy,
  Check,
  Plus,
  RefreshCw,
  WifiOff,
} from 'lucide-react';

const InstagramGlyph = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="5" />
    <circle cx="12" cy="12" r="4" />
    <circle cx="17.5" cy="6.5" r="0.6" fill="currentColor" stroke="none" />
  </svg>
);

const MessengerGlyph = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor">
    <path d="M12 2C6.36 2 2 6.13 2 11.7c0 2.91 1.19 5.44 3.14 7.17.16.14.26.35.27.57l.05 1.78a.8.8 0 0 0 1.12.71l1.99-.88a.8.8 0 0 1 .53-.04c.91.25 1.88.39 2.9.39 5.64 0 10-4.13 10-9.7S17.64 2 12 2zm6 7.46-2.94 4.66a1.5 1.5 0 0 1-2.17.4l-2.34-1.75a.6.6 0 0 0-.72 0l-3.16 2.4c-.42.32-.97-.18-.69-.63l2.94-4.66a1.5 1.5 0 0 1 2.17-.4l2.34 1.75a.6.6 0 0 0 .72 0l3.16-2.4c.42-.32.97.18.69.63z" />
  </svg>
);

import apiClient from '@/lib/api/client';

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
  copyable?: boolean;
}

interface ChannelTypeConfig {
  type: string;
  label: string;
  summary: (ch: Channel) => string | null | undefined;
  fields: (ch: Channel) => DetailField[];
}

// ─── Icon map ─────────────────────────────────────────────────────────────────

const CHANNEL_ICON_BG: Record<string, string> = {
  whatsapp: 'bg-[#25D366]',
  email: 'bg-blue-500',
  instagram: 'bg-gradient-to-br from-[#f58529] via-[#dd2a7b] to-[#8134af]',
  messenger: 'bg-gradient-to-br from-[#00b2ff] to-[#006aff]',
  webchat: 'bg-slate-500',
};

const CHANNEL_ICONS: Record<string, React.ReactNode> = {
  whatsapp: (
    <svg viewBox="0 0 24 24" className="w-[14px] h-[14px] fill-current" xmlns="http://www.w3.org/2000/svg">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
    </svg>
  ),
  email: <Mail className="w-[14px] h-[14px]" />,
  instagram: <InstagramGlyph className="w-[14px] h-[14px]" />,
  messenger: <MessengerGlyph className="w-[14px] h-[14px]" />,
  webchat: <Globe className="w-[14px] h-[14px]" />,
};

const withAt = (h?: string | null) => (h ? `@${h.replace(/^@/, '')}` : null);
const fmtDate = (d?: string | null) => {
  if (!d) return null;
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const CHANNEL_TYPES: ChannelTypeConfig[] = [
  {
    type: 'whatsapp',
    label: 'WhatsApp',
    summary: (ch) => ch.phoneNumber ?? ch.verified_name,
    fields: (ch) => [
      { icon: <Phone className="w-3.5 h-3.5" />, label: 'Phone number', value: ch.phoneNumber, copyable: true },
      { icon: <Hash className="w-3.5 h-3.5" />, label: 'Phone number ID', value: ch.metaPhoneNumberId, copyable: true },
      { icon: <Layers className="w-3.5 h-3.5" />, label: 'WABA ID', value: ch.wabaId, copyable: true },
    ],
  },
  {
    type: 'email',
    label: 'Email',
    summary: (ch) => ch.handle ?? ch.verified_name,
    fields: (ch) => [
      { icon: <AtSign className="w-3.5 h-3.5" />, label: 'Email address', value: ch.handle, copyable: true },
    ],
  },
  {
    type: 'instagram',
    label: 'Instagram',
    summary: (ch) => withAt(ch.handle) ?? ch.verified_name,
    fields: (ch) => [
      { icon: <AtSign className="w-3.5 h-3.5" />, label: 'Username', value: withAt(ch.handle), copyable: true },
    ],
  },
  {
    type: 'messenger',
    label: 'Facebook Messenger',
    summary: (ch) => ch.handle ?? ch.verified_name,
    fields: (ch) => [
      { icon: <AtSign className="w-3.5 h-3.5" />, label: 'Page', value: ch.handle, copyable: true },
    ],
  },
];

const FALLBACK_TYPE = (type: string): ChannelTypeConfig => ({
  type,
  label: type.charAt(0).toUpperCase() + type.slice(1),
  summary: (ch) => ch.phoneNumber ?? ch.handle ?? ch.verified_name,
  fields: (ch) => [
    { icon: <Phone className="w-3.5 h-3.5" />, label: 'Phone number', value: ch.phoneNumber, copyable: true },
    { icon: <Radio className="w-3.5 h-3.5" />, label: 'Handle', value: ch.handle, copyable: true },
  ],
});

// ─── Status dot ───────────────────────────────────────────────────────────────

const STATUS_DOT: Record<string, string> = {
  connected: 'bg-emerald-500',
  token_expired: 'bg-amber-400',
  error: 'bg-red-500',
  disconnected: 'bg-slate-300',
};

const STATUS_LABEL: Record<string, string> = {
  connected: 'Connected',
  token_expired: 'Token expired',
  error: 'Error',
  disconnected: 'Disconnected',
};

// ─── CopyField ────────────────────────────────────────────────────────────────

function CopyField({ icon, label, value }: DetailField) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1400); } catch {}
  };
  return (
    <div className="group flex items-center justify-between gap-2 py-2.5 border-b border-slate-100 last:border-0">
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="text-slate-400 shrink-0">{icon}</span>
        <div className="min-w-0">
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">{label}</p>
          <p className="text-xs font-medium text-slate-700 truncate">{value}</p>
        </div>
      </div>
      <button
        type="button"
        onClick={copy}
        className="opacity-0 group-hover:opacity-100 shrink-0 p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-all cursor-pointer"
      >
        {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
}

// ─── ConnectionRow ────────────────────────────────────────────────────────────

function ConnectionRow({
  channel,
  config,
  expanded,
  onToggle,
  onDisconnected,
}: {
  channel: Channel;
  config: ChannelTypeConfig;
  expanded: boolean;
  onToggle: () => void;
  onDisconnected: (id: number) => void;
}) {
  const [disconnecting, setDisconnecting] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [disconnectError, setDisconnectError] = useState<string | null>(null);

  const iconBg = CHANNEL_ICON_BG[channel.type] ?? 'bg-slate-500';
  const icon = CHANNEL_ICONS[channel.type] ?? <MessageCircle className="w-[14px] h-[14px]" />;
  const dot = STATUS_DOT[channel.status] ?? STATUS_DOT.disconnected;
  const statusLabel = STATUS_LABEL[channel.status] ?? channel.status;
  const summary = config.summary(channel);

  const handleDisconnect = async () => {
    setDisconnecting(true);
    setDisconnectError(null);
    try {
      await apiClient.delete(`/api/channels/${channel.id}`);
      onDisconnected(channel.id);
    } catch (err: any) {
      setDisconnectError(err?.message ?? 'Failed to disconnect');
      setDisconnecting(false);
      setShowConfirm(false);
    }
  };

  const fields: DetailField[] = [
    ...config.fields(channel),
    { icon: <Hash className="w-3.5 h-3.5" />, label: 'Channel ID', value: String(channel.id), copyable: true },
    { icon: <CalendarDays className="w-3.5 h-3.5" />, label: 'Connected', value: fmtDate(channel.createdAt) },
    { icon: <Clock className="w-3.5 h-3.5" />, label: 'Token expires', value: channel.tokenExpiresAt ? fmtDate(channel.tokenExpiresAt) : null },
  ].filter((f) => f.value);

  return (
    <div className={`transition-colors ${expanded ? 'bg-slate-50/60' : ''}`}>
      {/* Row */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors cursor-pointer text-left group"
      >
        {/* Brand icon */}
        <div className={`w-7 h-7 rounded-lg shrink-0 flex items-center justify-center text-white ${iconBg}`}>
          {icon}
        </div>

        {/* Name + subtitle */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-800 truncate">{channel.verified_name}</p>
          <p className="text-xs text-slate-400 truncate">{summary}</p>
        </div>

        {/* Status */}
        <div className="flex items-center gap-1.5 shrink-0">
          <span className={`w-1.5 h-1.5 rounded-full ${dot} ${channel.status === 'connected' ? 'animate-pulse' : ''}`} />
          <span className="text-xs text-slate-500 hidden sm:inline">{statusLabel}</span>
        </div>

        {/* Chevron */}
        <ChevronDown className={`w-3.5 h-3.5 text-slate-300 group-hover:text-slate-400 transition-transform duration-150 ${expanded ? 'rotate-180 text-slate-400' : ''}`} />
      </button>

      {/* Expanded detail panel */}
      {expanded && (
        <div className="px-4 pb-4 border-t border-slate-100">
          {/* Detail fields */}
          <div className="mt-1">
            {fields.map((f) => <CopyField key={f.label} {...f} />)}
          </div>

          {/* Last error */}
          {channel.lastError && (
            <div className="mt-3 flex gap-2 p-3 rounded-lg bg-red-50 border border-red-100">
              <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
              <p className="text-xs text-red-600 leading-relaxed">{channel.lastError}</p>
            </div>
          )}

          {/* Disconnect */}
          <div className="mt-4 flex items-center justify-between gap-3">
            {disconnectError && <p className="text-xs text-red-500">{disconnectError}</p>}
            {!disconnectError && <span />}

            {!showConfirm ? (
              <button
                type="button"
                onClick={() => setShowConfirm(true)}
                className="text-xs text-red-500 hover:text-red-600 font-medium transition-colors cursor-pointer flex items-center gap-1"
              >
                <Unplug className="w-3 h-3" />
                Disconnect
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500">Sure?</span>
                <button
                  type="button"
                  onClick={handleDisconnect}
                  disabled={disconnecting}
                  className="px-2.5 py-1 rounded-md text-[11px] font-bold text-white bg-red-500 hover:bg-red-600 disabled:opacity-50 transition-colors cursor-pointer flex items-center gap-1"
                >
                  {disconnecting && <Loader2 className="w-3 h-3 animate-spin" />}
                  {disconnecting ? 'Removing…' : 'Remove'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowConfirm(false)}
                  className="px-2.5 py-1 rounded-md text-[11px] font-medium text-slate-500 hover:bg-slate-100 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── ChannelGroup ─────────────────────────────────────────────────────────────

function ChannelGroup({
  config,
  channels,
  expandedIds,
  onToggle,
  onDisconnected,
  onConnect,
}: {
  config: ChannelTypeConfig;
  channels: Channel[];
  expandedIds: Set<number>;
  onToggle: (id: number) => void;
  onDisconnected: (id: number) => void;
  onConnect?: () => void;
}) {
  return (
    <div>
      {/* Group label row */}
      <div className="flex items-center justify-between px-4 py-2">
        <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">{config.label}</span>
        {onConnect && (
          <button
            type="button"
            onClick={onConnect}
            className="flex items-center gap-1 text-[11px] font-semibold text-slate-400 hover:text-[#3440a8] transition-colors cursor-pointer"
          >
            <Plus className="w-3 h-3" />
            Add
          </button>
        )}
      </div>

      {/* Connections */}
      {channels.length === 0 ? (
        <div className="mx-4 mb-1 px-3 py-3 rounded-lg border border-dashed border-slate-200 flex items-center gap-2.5">
          <WifiOff className="w-3.5 h-3.5 text-slate-300 shrink-0" />
          <p className="text-xs text-slate-400">No {config.label} accounts connected</p>
          {onConnect && (
            <button
              type="button"
              onClick={onConnect}
              className="ml-auto text-xs font-semibold text-[#3440a8] hover:underline cursor-pointer shrink-0"
            >
              Connect →
            </button>
          )}
        </div>
      ) : (
        <div className="mx-4 mb-1 rounded-xl border border-slate-200 overflow-hidden divide-y divide-slate-100">
          {channels.map((ch) => (
            <ConnectionRow
              key={ch.id}
              channel={ch}
              config={config}
              expanded={expandedIds.has(ch.id)}
              onToggle={() => onToggle(ch.id)}
              onDisconnected={onDisconnected}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── ChannelsSection ──────────────────────────────────────────────────────────

function ChannelsSection({ onConnect }: { onConnect?: () => void }) {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  const fetchChannels = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<{ channels: Channel[] }>('/api/channels');
      setChannels(res.data.channels ?? []);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load channels');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchChannels(); }, [fetchChannels]);

  const toggle = (id: number) =>
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const handleDisconnected = (id: number) => {
    setChannels((prev) => prev.filter((c) => c.id !== id));
    setExpandedIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 py-20">
        <AlertTriangle className="w-5 h-5 text-amber-400" />
        <p className="text-sm text-slate-500">{error}</p>
        <button onClick={fetchChannels} className="inline-flex items-center gap-1.5 text-sm text-[#3440a8] hover:underline cursor-pointer">
          <RefreshCw className="w-3.5 h-3.5" /> Retry
        </button>
      </div>
    );
  }

  const activeChannels = channels.filter((c) => c.status !== 'disconnected');
  const knownTypes = new Set(CHANNEL_TYPES.map((t) => t.type));
  const extraTypes = Array.from(new Set(activeChannels.map((c) => c.type))).filter((t) => !knownTypes.has(t)).map(FALLBACK_TYPE);
  const groups = [...CHANNEL_TYPES, ...extraTypes];

  return (
    <div className="space-y-5">
      {groups.map((config) => (
        <ChannelGroup
          key={config.type}
          config={config}
          channels={activeChannels.filter((c) => c.type === config.type)}
          expandedIds={expandedIds}
          onToggle={toggle}
          onDisconnected={handleDisconnected}
          onConnect={onConnect}
        />
      ))}
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

export const SettingsView: React.FC<{ onOpenIntegrations?: () => void }> = ({ onOpenIntegrations }) => {
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
                  <span className="text-[9px] font-bold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded-full">
                    {badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </aside>

      {/* Content */}
      <main className="flex-1 overflow-y-auto">
        {/* Page header */}
        <div className="px-8 pt-7 pb-5 border-b border-slate-100">
          <h1 className="text-sm font-bold text-slate-900">
            {activeSection === 'general' ? 'General' : 'Channels'}
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            {activeSection === 'general'
              ? 'Manage your workspace preferences'
              : 'View and manage connected messaging channels'}
          </p>
        </div>

        <div className="py-5">
          {activeSection === 'general' && <GeneralSection />}
          {activeSection === 'channels' && <ChannelsSection onConnect={onOpenIntegrations} />}
        </div>
      </main>
    </div>
  );
};

export default SettingsView;
