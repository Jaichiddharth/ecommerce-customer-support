'use client';

import React, { useMemo } from 'react';
import { ChevronLeft, Inbox, Plus } from 'lucide-react';
import { ChannelIcon } from './ChannelIcon';
import {
  CHANNEL_LABELS,
  CHANNEL_TYPES,
  ChannelFilter,
  InboxChannel,
  InboxConversation,
  channelNeedsReconnect,
  formatHandle,
  formatPhone,
  isChannelHealthy,
} from './inbox-types';

interface ChannelsPaneProps {
  channels: InboxChannel[];
  conversations: InboxConversation[];
  isLoading: boolean;
  filter: ChannelFilter;
  onFilterChange: (filter: ChannelFilter) => void;
  onConnect: (type: string) => void;
  onCollapse: () => void;
}

const CountPill: React.FC<{ count: number; active?: boolean }> = ({ count, active }) => (
  <span
    className={`min-w-5 h-5 px-1.5 rounded-full text-[11px] font-bold flex items-center justify-center shrink-0 ${
      active ? 'bg-[#3440a8] text-white' : 'bg-slate-200 text-slate-900'
    }`}
  >
    {count}
  </span>
);

export const ChannelsPane: React.FC<ChannelsPaneProps> = ({
  channels,
  conversations,
  isLoading,
  filter,
  onFilterChange,
  onConnect,
  onCollapse,
}) => {
  // Conversation counts per channel id and per channel type
  const { byChannel, byType } = useMemo(() => {
    const byChannel = new Map<number, number>();
    const byType = new Map<string, number>();
    for (const conv of conversations) {
      const type = conv.channel?.type || 'whatsapp';
      byType.set(type, (byType.get(type) ?? 0) + 1);
      if (conv.channel) byChannel.set(conv.channel.id, (byChannel.get(conv.channel.id) ?? 0) + 1);
    }
    return { byChannel, byType };
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

  const isTypeActive = (type: string) => filter.kind === 'type' && filter.type === type;
  const isChannelActive = (id: number) => filter.kind === 'channel' && filter.id === id;

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
        {/* All conversations */}
        <button
          onClick={() => onFilterChange({ kind: 'all' })}
          className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left cursor-pointer transition-colors ${
            filter.kind === 'all' ? 'bg-[#eef0fb] text-slate-950 font-bold' : 'text-slate-800 font-medium hover:bg-slate-100/70'
          }`}
        >
          <Inbox className="w-4 h-4 text-slate-700" />
          <span className="flex-1">All conversations</span>
          <CountPill count={conversations.length} active={filter.kind === 'all'} />
        </button>

        {/* Connected */}
        <div className="mt-5 mb-1.5 px-2.5 flex items-center justify-between text-[11px] font-bold text-slate-700 tracking-wider">
          <span>CONNECTED · {groups.length}</span>
          <button
            onClick={() => onConnect('')}
            title="Connect new channel"
            className="text-slate-600 hover:text-[#3440a8] cursor-pointer"
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
              const active = isTypeActive(type);

              return (
                <div key={type}>
                  <button
                    onClick={() => onFilterChange({ kind: 'type', type })}
                    className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left cursor-pointer transition-colors ${
                      active ? 'bg-[#eef0fb]' : 'hover:bg-slate-50'
                    }`}
                  >
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
                    </span>
                    <CountPill count={byType.get(type) ?? 0} active={active} />
                  </button>

                  {/* Individual numbers when a channel type has several accounts */}
                  {items.length > 1 && (
                    <div className="ml-5 pl-3 space-y-0.5">
                      {items.map((channel) => {
                        const channelActive = isChannelActive(channel.id);
                        return (
                          <button
                            key={channel.id}
                            onClick={() => onFilterChange({ kind: 'channel', id: channel.id })}
                            title={channel.lastError || (channel.status === 'disconnected' ? 'Channel is disconnected' : undefined)}
                            className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left cursor-pointer transition-colors ${
                              channelActive ? 'bg-[#eef0fb]' : 'hover:bg-slate-50'
                            }`}
                          >
                            <span
                              className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                channel.status === 'disconnected'
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
                            </span>
                            <CountPill count={byChannel.get(channel.id) ?? 0} active={channelActive} />
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
                    onClick={() => onConnect(type)}
                    className="px-2 py-1 rounded-md border border-slate-300 text-[12px] font-semibold shrink-0 text-[#3440a8] hover:bg-[#eef0fb] cursor-pointer"
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
          onClick={() => onConnect('')}
          className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-lg border border-dashed border-slate-300 text-[13px] font-medium text-[#3440a8] hover:bg-[#eef0fb] cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          Connect new channel
        </button>
        <p className="mt-2.5 px-1 text-[11px] text-slate-500 flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full ${attentionCount > 0 ? 'bg-orange-500' : 'bg-emerald-500'}`} />
          {liveCount} live{attentionCount > 0 ? ` · ${attentionCount} needs attention` : ''}
        </p>
      </div>
    </aside>
  );
};
