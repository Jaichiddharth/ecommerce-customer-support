'use client';

import React, { useMemo } from 'react';
import { ChevronLeft, CircleCheck, Plus, Lock, Users, UserRoundX } from 'lucide-react';
import { ChannelIcon } from './ChannelIcon';
import {
  CHANNEL_LABELS,
  CHANNEL_TYPES,
  InboxChannel,
  InboxConversation,
  TicketView,
  channelNeedsReconnect,
  formatHandle,
  formatPhone,
  isChannelHealthy,
} from './inbox-types';

interface ChannelsPaneProps {
  channels: InboxChannel[];
  conversations: InboxConversation[];
  isLoading: boolean;
  /** The channel (number / account) the inbox lists */
  selectedChannelId: number | null;
  onSelectChannel: (id: number) => void;
  onConnect: (type: string) => void;
  onCollapse: () => void;
  canCreate?: boolean;
  /** Ticket views of the selected channel: Unassigned and Closed */
  ticketView: TicketView;
  ticketCounts: { unassigned: number; closed: number };
  onSelectTicketView: (view: TicketView) => void;
}

const TICKET_VIEWS: { key: Exclude<TicketView, 'inbox'>; label: string; hint: string; icon: React.ElementType }[] = [
  {
    key: 'unassigned',
    label: 'Unassigned',
    hint: 'Open tickets the customer started that no teammate owns yet. Replying claims the ticket.',
    icon: UserRoundX,
  },
  {
    key: 'closed',
    label: 'Closed',
    hint: "Resolved tickets. The customer's next message opens a new ticket.",
    icon: CircleCheck,
  },
];

/** Unread-message badge: shown only while the channel has unread messages */
const UnreadBadge: React.FC<{ unread: number }> = ({ unread }) =>
  unread > 0 ? (
    <span
      title={`${unread} unread message${unread === 1 ? '' : 's'}`}
      aria-label={`${unread} unread messages`}
      className="min-w-5 h-5 px-1.5 rounded-full bg-[#3440a8] text-white text-[11px] font-bold flex items-center justify-center shrink-0"
    >
      {unread > 99 ? '99+' : unread}
    </span>
  ) : null;

const nf = new Intl.NumberFormat('en-IN');

/** "12 contacts · 2 opted out": every contact on the channel, with or without a conversation */
const ContactsLine: React.FC<{ total: number; optedOut: number }> = ({ total, optedOut }) => (
  <span className="flex items-center gap-1 text-[11px] text-slate-600 whitespace-nowrap" title="Contacts on this channel, with or without a conversation">
    <Users className="w-3 h-3 shrink-0 text-slate-400" />
    <span className="font-semibold text-slate-700">{nf.format(total)}</span> contact{total === 1 ? '' : 's'}
    {optedOut > 0 && (
      <span className="text-red-600 font-medium" title="Opted out of WhatsApp messages: nothing can be sent to them">
        · {nf.format(optedOut)} opted out
      </span>
    )}
  </span>
);

export const ChannelsPane: React.FC<ChannelsPaneProps> = ({
  channels,
  conversations,
  isLoading,
  selectedChannelId,
  onSelectChannel,
  onConnect,
  onCollapse,
  canCreate = true,
  ticketView,
  ticketCounts,
  onSelectTicketView,
}) => {
  // Unread messages per channel id
  const unreadByChannel = useMemo(() => {
    const map = new Map<number, number>();
    for (const conv of conversations) {
      if (conv.channel && conv.unreadCount > 0) {
        map.set(conv.channel.id, (map.get(conv.channel.id) ?? 0) + conv.unreadCount);
      }
    }
    return map;
  }, [conversations]);

  const groups = useMemo(
    () =>
      CHANNEL_TYPES.map((type) => ({ type, items: channels.filter((c) => c.type === type) })).filter(
        (g) => g.items.length > 0
      ),
    [channels]
  );
  const available = CHANNEL_TYPES.filter((type) => !channels.some((c) => c.type === type));

  const liveCount = groups.filter((g) => g.items.every(isChannelHealthy)).length;
  const attentionCount = groups.length - liveCount;

  const isChannelActive = (id: number) => selectedChannelId === id;

  return (
    <aside className="w-[232px] bg-white border-r border-slate-200 flex flex-col shrink-0 h-full select-none">
      {/* Header */}
      <div className="h-16 px-4 flex items-center justify-between border-b border-slate-100 shrink-0">
        <h2 className="text-[17px] font-semibold text-slate-900">Channels</h2>
        <button
          onClick={onCollapse}
          title="Collapse channels"
          className="w-7 h-7 rounded-lg border border-slate-200 text-slate-500 hover:text-slate-800 hover:bg-slate-50 flex items-center justify-center cursor-pointer"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-3 text-[13px]">
        {/* Connected */}
        <div className="mb-1.5 px-2.5 flex items-center justify-between text-[11px] font-bold text-slate-700 tracking-wider">
          <span>CONNECTED · {groups.length}</span>
          <button
            onClick={canCreate ? () => onConnect('') : undefined}
            disabled={!canCreate}
            title={!canCreate ? 'You do not have permission to connect channels' : 'Connect new channel'}
            className={canCreate ? 'text-slate-600 hover:text-[#3440a8] cursor-pointer' : 'text-slate-300 cursor-not-allowed opacity-40'}
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        {isLoading && channels.length === 0 ? (
          <div className="px-2.5 py-3 space-y-2">
            {[0, 1].map((i) => (
              <div key={i} className="h-9 rounded-lg bg-slate-100 animate-pulse" />
            ))}
          </div>
        ) : groups.length === 0 ? (
          <p className="px-2.5 py-2 text-xs text-slate-400">No channels connected yet.</p>
        ) : (
          <div className="space-y-0.5">
            {groups.map(({ type, items }) => {
              const needsReconnect = items.some(channelNeedsReconnect);
              const isDisconnected = items.every((c) => c.status === 'disconnected');
              const single = items.length === 1 ? items[0] : null;
              const subtitle = needsReconnect || isDisconnected
                ? null
                : type === 'whatsapp'
                  ? items.length > 1
                    ? `${items.length} numbers`
                    : formatPhone(single?.phoneNumber)
                  : single?.handle
                    ? `${formatHandle(single.handle)}${type === 'instagram' ? ' · DMs' : ''}`
                    : single?.verified_name || '';
              // With one account the row picks it; with several it only summarises them and each account is picked below
              const active = single ? isChannelActive(single.id) : false;
              const contactTotal = items.reduce((sum, c) => sum + (c.contactCount ?? 0), 0);
              const optedOutTotal = items.reduce((sum, c) => sum + (c.optedOutCount ?? 0), 0);
              const rowClass = `w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-colors ${single ? `cursor-pointer ${active ? 'bg-[#eef0fb]' : 'hover:bg-slate-50'}` : 'cursor-default'
                }`;

              const rowBody = (
                <>
                  <ChannelIcon type={type} size="md" />
                  <span className="flex-1 min-w-0">
                    <span className={`block truncate text-slate-900 ${active ? 'font-semibold' : 'font-medium'}`}>
                      {CHANNEL_LABELS[type]}
                    </span>
                    {needsReconnect ? (
                      <span className="block whitespace-nowrap text-[11px] text-orange-600">
                        Token expired ·{' '}
                        <span
                          role="link"
                          onClick={(e) => {
                            e.stopPropagation();
                            onConnect(type);
                          }}
                          className="font-medium hover:underline"
                        >
                          Reconnect
                        </span>
                      </span>
                    ) : isDisconnected ? (
                      <span className="block whitespace-nowrap text-[11px] text-amber-600">
                        Disconnected ·{' '}
                        <span
                          role="link"
                          onClick={(e) => {
                            e.stopPropagation();
                            onConnect(type);
                          }}
                          className="font-medium hover:underline"
                        >
                          Reconnect
                        </span>
                      </span>
                    ) : (
                      subtitle && <span className="block truncate text-[11px] text-slate-500">{subtitle}</span>
                    )}
                    {!isDisconnected && <ContactsLine total={contactTotal} optedOut={optedOutTotal} />}
                  </span>
                  {/* Several accounts: the contacts line already summarises them, unread shows on each account below */}
                  {single && <UnreadBadge unread={unreadByChannel.get(single.id) ?? 0} />}
                </>
              );

              return (
                <div key={type}>
                  {single ? (
                    <button type="button" onClick={() => onSelectChannel(single.id)} aria-pressed={active} className={rowClass}>
                      {rowBody}
                    </button>
                  ) : (
                    <div className={rowClass}>{rowBody}</div>
                  )}

                  {/* Individual numbers when a channel type has several accounts */}
                  {items.length > 1 && (
                    <div className="ml-5 pl-3 space-y-0.5">
                      {items.map((channel) => {
                        const channelActive = isChannelActive(channel.id);
                        return (
                          <button
                            key={channel.id}
                            type="button"
                            onClick={() => onSelectChannel(channel.id)}
                            aria-pressed={channelActive}
                            title={channel.lastError || (channel.status === 'disconnected' ? 'Channel is disconnected' : undefined)}
                            className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left cursor-pointer transition-colors ${channelActive ? 'bg-[#eef0fb]' : 'hover:bg-slate-50'
                              }`}
                          >
                            <span
                              className={`w-1.5 h-1.5 rounded-full shrink-0 ${channel.status === 'disconnected'
                                  ? 'bg-amber-500'
                                  : isChannelHealthy(channel)
                                    ? 'bg-emerald-500'
                                    : 'bg-orange-500'
                                }`}
                            />
                            <span className="flex-1 min-w-0">
                              <span className={`block truncate text-slate-800 ${channelActive ? 'font-semibold' : ''}`}>
                                {channel.verified_name || CHANNEL_LABELS[type]}
                              </span>
                              <span className="block truncate text-[11px] text-slate-500">
                                {formatPhone(channel.phoneNumber) || formatHandle(channel.handle)}
                                {channel.status === 'disconnected' ? ' · Disconnected' : ''}
                              </span>
                              {channel.status !== 'disconnected' && (
                                <ContactsLine total={channel.contactCount ?? 0} optedOut={channel.optedOutCount ?? 0} />
                              )}
                            </span>
                            <UnreadBadge unread={unreadByChannel.get(channel.id) ?? 0} />
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}



        {/* Ticket views of the selected channel; picking a channel above goes back to its inbox */}
        {groups.length > 0 && (
          <>
            <div className="mt-5 mb-1.5 px-2.5 text-[11px] font-bold text-slate-700 tracking-wider">TICKETS</div>
            <div className="space-y-0.5">
              {TICKET_VIEWS.map(({ key, label, hint, icon: Icon }) => {
                const active = ticketView === key;
                const count = ticketCounts[key];
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => onSelectTicketView(active ? 'inbox' : key)}
                    aria-pressed={active}
                    title={hint}
                    className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left cursor-pointer transition-colors ${active ? 'bg-[#eef0fb]' : 'hover:bg-slate-50'
                      }`}
                  >
                    <span
                      className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${active ? 'bg-white text-[#3440a8]' : 'bg-slate-100 text-slate-600'
                        }`}
                    >
                      <Icon className="w-4 h-4" />
                    </span>
                    <span className={`flex-1 min-w-0 truncate text-slate-900 ${active ? 'font-semibold' : 'font-medium'}`}>
                      {label}
                    </span>
                    <span
                      className={`min-w-5 h-5 px-1.5 rounded-full text-[11px] font-semibold flex items-center justify-center shrink-0 ${key === 'unassigned' && count > 0 ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'
                        }`}
                    >
                      {nf.format(count)}
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}

        {/* Available to connect */}
        {available.length > 0 && (
          <>
            <div className="mt-5 mb-1.5 px-2.5 text-[11px] font-bold text-black tracking-wider">
              AVAILABLE TO CONNECT
            </div>
            <div className="space-y-0.5">
              {available.map((type) => (
                <div key={type} className="flex items-center gap-2.5 px-2.5 py-2">
                  <ChannelIcon type={type} size="md" className={type === 'email' ? '' : 'opacity-90'} />
                  <span className="flex-1 min-w-0 truncate text-black font-medium">{CHANNEL_LABELS[type]}</span>
                  <button
                    onClick={canCreate ? () => onConnect(type) : undefined}
                    disabled={!canCreate}
                    title={!canCreate ? 'You do not have permission to connect channels' : undefined}
                    className={`px-2 py-1 rounded-md border text-[12px] font-semibold shrink-0 transition-colors ${canCreate
                        ? 'border-slate-300 text-[#3440a8] hover:bg-[#eef0fb] cursor-pointer'
                        : 'border-slate-200 text-slate-400 bg-slate-50 cursor-not-allowed opacity-50'
                      }`}
                  >
                    Connect
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Footer */}
      <div className="px-3 pt-2 pb-3 shrink-0">
        <button
          onClick={canCreate ? () => onConnect('') : undefined}
          disabled={!canCreate}
          title={!canCreate ? 'You do not have permission to connect channels' : undefined}
          className={`w-full flex items-center justify-center gap-1.5 py-2.5 rounded-lg border border-dashed text-[13px] font-medium transition-colors ${canCreate
              ? 'border-slate-300 text-[#3440a8] hover:bg-[#eef0fb] cursor-pointer'
              : 'border-slate-200 text-slate-400 bg-slate-50 cursor-not-allowed opacity-60'
            }`}
        >
          <Plus className="w-4 h-4" />
          Connect new channel
          {!canCreate && <Lock className="w-3.5 h-3.5 ml-1 text-slate-400" />}
        </button>
        <p className="mt-2.5 px-1 text-[11px] text-slate-500 flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full ${attentionCount > 0 ? 'bg-orange-500' : 'bg-emerald-500'}`} />
          {liveCount} live{attentionCount > 0 ? ` · ${attentionCount} needs attention` : ''}
        </p>
      </div>
    </aside>
  );
};
