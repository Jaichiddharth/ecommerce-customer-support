'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Settings,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  CalendarDays,
  Hash,
  Phone,
  Layers,
  Copy,
  Check,
  Plus,
  RefreshCw,
  Clock,
  Users,
  Route,
  ShieldCheck,
  Languages,
  CreditCard,
  Webhook,
  Unplug,
  type LucideIcon,
} from 'lucide-react';

import apiClient from '@/lib/api/client';
import { notifyError } from '@/lib/api/notify';
import { useRealtime } from '@/lib/hooks/useRealtime';
import { AddChannelModal } from './channels/AddChannelModal';
import { ChannelIcon } from './inbox/ChannelIcon';
import { InboxConversation, formatPhone, isChannelHealthy } from './inbox/inbox-types';
import { ContactSearch, TopBar } from './TopBar';
import { Channel, STATUS_META, fmtDate, needsReconnect, useDisconnectChannel } from './settings/channel-settings';
import { WhatsAppNumberSection } from './settings/WhatsAppNumberSection';
import { ConsentPrivacySection } from './settings/ConsentPrivacySection';

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

// ─── CopyField ────────────────────────────────────────────────────────────────

function CopyField({ icon, label, value }: DetailField) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch { }
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

// ─── ConnectionCard ───────────────────────────────────────────────────────────

function ConnectionCard({
  channel,
  expanded,
  onToggle,
  onReconnect,
  onDisconnect,
}: {
  channel: Channel;
  expanded: boolean;
  onToggle: () => void;
  onReconnect: () => void;
  onDisconnect: (channel: Channel) => void;
}) {
  const status = STATUS_META[channel.status] ?? STATUS_META.error;
  const number = formatPhone(channel.phoneNumber);
  const isApproved =
    channel.status !== 'disconnected' &&
    (channel.name_status === 'APPROVED' ||
      channel.name_status === 'AVAILABLE_WITHOUT_REVIEW' ||
      (!channel.name_status && channel.type === 'whatsapp' && channel.status === 'connected'));

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
            {isApproved && (
              <>
                {' · '}
                <span className="font-bold text-emerald-600">Approved</span>
              </>
            )}
            <span className="text-slate-400"> · connected {fmtDate(channel.createdAt)}</span>
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

          {channel.status !== 'disconnected' && (
            <div className="mt-4 pt-3 border-t border-slate-100 flex justify-end">
              <button
                type="button"
                onClick={() => onDisconnect(channel)}
                className="px-3.5 py-1.5 rounded-lg text-xs font-semibold text-red-600 hover:text-red-700 hover:bg-red-50 border border-red-200 transition-colors cursor-pointer flex items-center gap-1.5"
              >
                <Unplug className="w-3.5 h-3.5" />
                Disconnect
              </button>
            </div>
          )}
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

  const handleDisconnected = (updatedChannel: Channel) => {
    setChannels((prev) => prev.map((c) => (c.id === updatedChannel.id ? updatedChannel : c)));
  };
  const { requestDisconnect, dialog: disconnectDialog } = useDisconnectChannel(handleDisconnected);

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
                onReconnect={() => setShowConnect(true)}
                onDisconnect={requestDisconnect}
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
      {disconnectDialog}
    </div>
  );
}

// ─── ComingSoonSection ────────────────────────────────────────────────────────

function ComingSoonSection({ icon: Icon, title, description }: { icon: LucideIcon; title: string; description: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
      <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center">
        <Icon className="w-5 h-5 text-slate-400" />
      </div>
      <div>
        <p className="text-sm font-semibold text-slate-700">{title} is coming soon</p>
        <p className="text-xs text-slate-400 mt-1 max-w-xs leading-relaxed">{description}</p>
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

type Section = 'general' | 'channels' | 'whatsapp' | 'team' | 'routing' | 'consent' | 'languages' | 'billing' | 'api';

/** Sections with `soon` are listed but open a "coming soon" panel */
const SECTIONS: { key: Section; label: string; subtitle: string; icon: LucideIcon; soon?: boolean }[] = [
  { key: 'general', label: 'General', subtitle: 'Workspace name, timezone and notification preferences.', icon: Settings, soon: true },
  { key: 'channels', label: 'Channels', subtitle: 'Connect the messaging accounts your team replies from and manage the ones already connected', icon: Layers },
  { key: 'whatsapp', label: 'WhatsApp number', subtitle: 'Your connected number, its health at Meta and the business profile customers see', icon: Phone },
  { key: 'team', label: 'Team & roles', subtitle: 'Invite teammates, assign roles and control who can reply.', icon: Users, soon: true },
  { key: 'routing', label: 'Routing & hours', subtitle: 'Assign conversations automatically and set business hours and away messages.', icon: Route, soon: true },
  { key: 'consent', label: 'Consent & privacy', subtitle: 'Opt-out keywords, confirmation messages and data retention.', icon: ShieldCheck },
  { key: 'languages', label: 'Languages', subtitle: 'The languages your AI agent and templates reply in.', icon: Languages, soon: true },
  { key: 'billing', label: 'Billing & usage', subtitle: 'Your plan, seats, AI resolutions and invoices.', icon: CreditCard, soon: true },
  { key: 'api', label: 'API & webhooks', subtitle: 'API keys and webhooks to connect UnoCX to your own systems.', icon: Webhook, soon: true },
];

interface SettingsViewProps {
  /** Opens a contact picked in the top-bar search in the inbox (id is `cust-<customerId>`) */
  onOpenConversation?: (id: string) => void;
}

/** Top-bar data: the live WhatsApp number, and contacts for the search (loaded on first use) */
function useSettingsTopBar() {
  const [whatsappChannels, setWhatsappChannels] = useState<Channel[]>([]);
  const [conversations, setConversations] = useState<InboxConversation[]>([]);
  const conversationsRequested = useRef(false);

  const fetchChannels = useCallback(async () => {
    try {
      const res = await apiClient.get<{ channels: Channel[] }>('/api/channels', { params: { type: 'whatsapp' } });
      setWhatsappChannels(res.data.channels ?? []);
    } catch {
      // The number pill is decorative here; the sections below show their own load errors
    }
  }, []);

  useEffect(() => {
    fetchChannels();
  }, [fetchChannels]);

  const { isConnected } = useRealtime({ onChannelUpdated: () => fetchChannels() });

  const loadConversations = useCallback(async () => {
    if (conversationsRequested.current) return;
    conversationsRequested.current = true;
    try {
      const res = await apiClient.get<{ conversations: InboxConversation[] }>('/api/conversations');
      setConversations(res.data.conversations ?? []);
    } catch (err) {
      conversationsRequested.current = false;
      notifyError(err, { where: 'SettingsView.search', title: "Couldn't load contacts" });
    }
  }, []);

  const primaryNumber = (whatsappChannels.find(isChannelHealthy) || whatsappChannels[0])?.phoneNumber ?? null;
  return { primaryNumber, isLive: isConnected, conversations, loadConversations };
}

export const SettingsView: React.FC<SettingsViewProps> = ({ onOpenConversation }) => {
  const [activeSection, setActiveSection] = useState<Section>('whatsapp');
  const active = SECTIONS.find((s) => s.key === activeSection)!;
  const topBar = useSettingsTopBar();

  return (
    <div className="flex flex-col h-full bg-[#f8f9fc]">
      <TopBar
        primaryNumber={topBar.primaryNumber}
        isLive={topBar.isLive}
        search={
          <ContactSearch
            conversations={topBar.conversations}
            onActivate={topBar.loadConversations}
            onOpenConversation={(conv) => onOpenConversation?.(`cust-${conv.customer.id}`)}
          />
        }
      >
        <div className="min-w-0">
          <p className="flex items-center gap-1 text-[12px] text-slate-500 leading-tight">
            Settings <ChevronRight className="w-3 h-3" /> <span className="text-slate-800">{active.label}</span>
          </p>
          <h1 className="mt-0.5 text-[18px] font-semibold text-slate-900 leading-tight truncate">{active.label}</h1>
        </div>
      </TopBar>

      <div className="flex flex-1 min-h-0">
        {/* Sidebar */}
        <aside className="w-[220px] shrink-0 border-r border-slate-200 bg-white flex flex-col pt-6">
          <p className="px-5 mb-3 text-[11px] font-bold text-slate-400 uppercase tracking-widest">Settings</p>
          <nav className="px-3 space-y-0.5">
            {SECTIONS.map(({ key, label, soon }) => {
              const isActive = activeSection === key;
              return (
                <button
                  key={key}
                  onClick={() => setActiveSection(key)}
                  title={soon ? `${label} · coming soon` : label}
                  className={`w-full flex items-center px-3 py-2 rounded-lg border text-[13px] transition-colors cursor-pointer text-left ${isActive
                      ? 'bg-[#eef0fb] border-[#dfe3f7] text-[#3440a8] font-semibold'
                      : 'border-transparent text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                    }`}
                >
                  {label}
                </button>
              );
            })}
          </nav>
        </aside>

        {/* Content */}
        <main className="flex-1 overflow-y-auto pt-4">
          {active.soon && <ComingSoonSection icon={active.icon} title={active.label} description={active.subtitle} />}
          {activeSection === 'channels' && (
            <>
              <p className="px-8 pt-2 pb-5 text-xs text-slate-500">{active.subtitle}</p>
              <ChannelsSection />
            </>
          )}
          {activeSection === 'whatsapp' && <WhatsAppNumberSection onOpenChannels={() => setActiveSection('channels')} />}
          {activeSection === 'consent' && <ConsentPrivacySection />}
        </main>
      </div>
    </div>
  );
};

export default SettingsView;
