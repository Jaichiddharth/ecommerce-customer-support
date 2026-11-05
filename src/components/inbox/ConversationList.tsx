'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Check, ListFilter, Plus, Search, User, Lock } from 'lucide-react';
import { ErrorState } from '@/components/ui/states';
import type { ApiError } from '@/lib/api/api-error';
import { ChannelIcon } from './ChannelIcon';
import {
  CHANNEL_LABELS,
  InboxConversation,
  ListTab,
  conversationChannelType,
  formatListTime,
  getInitials,
  lastMessagePreview,
} from './inbox-types';

export type StatusFilter = 'open' | 'resolved' | 'all';

interface ConversationListProps {
  conversations: InboxConversation[];
  counts: Record<ListTab, number>;
  tab: ListTab;
  onTabChange: (tab: ListTab) => void;
  search: string;
  onSearchChange: (value: string) => void;
  statusFilter: StatusFilter;
  onStatusFilterChange: (value: StatusFilter) => void;
  unreadOnly: boolean;
  onUnreadOnlyChange: (value: boolean) => void;
  selectedCustomerId: number | null;
  onSelect: (conv: InboxConversation) => void;
  onNewContact: () => void;
  canCreate?: boolean;
  isLoading: boolean;
  error: ApiError | null;
  onRetry: () => void;
}

const TABS: { key: ListTab; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'ai', label: 'AI' },
  { key: 'needs_human', label: 'Needs human' },
  { key: 'mine', label: 'Mine' },
];

export const Avatar: React.FC<{ name: string; src?: string | null; size?: 'md' | 'lg' }> = ({ name, src, size = 'md' }) => {
  const dims = size === 'lg' ? 'w-10 h-10 text-[13px]' : 'w-9 h-9 text-xs';
  if (src) {
    return <img src={src} alt={name} className={`${dims} rounded-full object-cover shrink-0`} />;
  }
  return (
    <span className={`${dims} rounded-full bg-[#fce8f0] text-[#b4366b] font-semibold flex items-center justify-center shrink-0`}>
      {getInitials(name)}
    </span>
  );
};

export const ConversationList: React.FC<ConversationListProps> = ({
  conversations,
  counts,
  tab,
  onTabChange,
  search,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  unreadOnly,
  onUnreadOnlyChange,
  selectedCustomerId,
  onSelect,
  onNewContact,
  canCreate = true,
  isLoading,
  error,
  onRetry,
}) => {
  const [showFilters, setShowFilters] = useState(false);
  const filtersRef = useRef<HTMLDivElement>(null);
  const filtersActive = statusFilter !== 'open' || unreadOnly;

  useEffect(() => {
    if (!showFilters) return;
    const close = (e: MouseEvent) => {
      if (filtersRef.current && !filtersRef.current.contains(e.target as Node)) setShowFilters(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [showFilters]);

  return (
    <div className="w-[285px] bg-white border-r border-slate-200 flex flex-col shrink-0 h-full select-none">
      {/* Tabs */}
      <div className="px-4 flex items-center gap-4 border-b border-slate-200 text-[13px] shrink-0">
        {TABS.map(({ key, label }) => {
          const active = tab === key;
          return (
            <button
              key={key}
              onClick={() => onTabChange(key)}
              className={`py-3 -mb-px border-b-2 whitespace-nowrap cursor-pointer transition-colors ${
                active ? 'border-[#3440a8] text-[#3440a8] font-bold' : 'border-transparent text-slate-800 font-medium hover:text-black'
              }`}
            >
              {label} <span className={active ? 'text-[#3440a8] font-bold' : 'text-slate-600 font-semibold'}>{counts[key]}</span>
            </button>
          );
        })}
      </div>

      {/* Search + filter */}
      <div className="p-3 flex items-center gap-2 border-b border-slate-100 shrink-0">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search name, handle, order #"
            className="w-full pl-8 pr-2 py-2 text-[13px] border border-slate-200 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-none focus:border-[#3440a8] focus:ring-1 focus:ring-[#3440a8]"
          />
        </div>
        <div className="relative" ref={filtersRef}>
          <button
            onClick={() => setShowFilters((v) => !v)}
            title="Filters"
            className={`w-9 h-9 rounded-lg border flex items-center justify-center cursor-pointer transition-colors ${
              filtersActive ? 'border-[#3440a8] text-[#3440a8] bg-[#eef0fb]' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            <ListFilter className="w-4 h-4" />
          </button>
          {showFilters && (
            <div className="absolute right-0 top-full mt-1.5 w-52 bg-white border border-slate-200 rounded-xl shadow-lg p-1.5 z-30 text-[13px]">
              <p className="px-2 pt-1 pb-1.5 text-[11px] font-semibold text-slate-500 tracking-wider">STATUS</p>
              {(['open', 'resolved', 'all'] as StatusFilter[]).map((value) => (
                <button
                  key={value}
                  onClick={() => onStatusFilterChange(value)}
                  className="w-full flex items-center justify-between px-2 py-1.5 rounded-lg hover:bg-slate-50 cursor-pointer capitalize text-slate-700"
                >
                  {value}
                  {statusFilter === value && <Check className="w-4 h-4 text-[#3440a8]" />}
                </button>
              ))}
              <div className="my-1 border-t border-slate-100" />
              <button
                onClick={() => onUnreadOnlyChange(!unreadOnly)}
                className="w-full flex items-center justify-between px-2 py-1.5 rounded-lg hover:bg-slate-50 cursor-pointer text-slate-700"
              >
                Unread only
                {unreadOnly && <Check className="w-4 h-4 text-[#3440a8]" />}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Cards */}
      <div className="flex-1 overflow-y-auto">
        {error && conversations.length > 0 && (
          <div role="alert" className="px-3 py-2 bg-red-50 text-[11px] text-red-700 flex items-center justify-between gap-2">
            <span className="truncate">Couldn&apos;t refresh conversations: {error.message}</span>
            <button type="button" onClick={onRetry} className="font-semibold underline cursor-pointer shrink-0">
              Retry
            </button>
          </div>
        )}

        {isLoading && conversations.length === 0 ? (
          <div className="p-8 flex flex-col items-center gap-2 text-xs text-slate-500">
            <div className="w-5 h-5 border-2 border-slate-300 border-t-[#3440a8] rounded-full animate-spin" />
            Loading conversations...
          </div>
        ) : error && conversations.length === 0 ? (
          <ErrorState error={error} title="Couldn't load conversations" onRetry={onRetry} />
        ) : conversations.length === 0 ? (
          <div className="p-8 text-center flex flex-col items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-400">
              <User className="w-5 h-5" />
            </div>
            <div>
              <p className="font-semibold text-slate-700 text-[13px]">No conversations</p>
              <p className="text-xs text-slate-400 mt-0.5">Nothing matches this view yet.</p>
            </div>
            <button
              onClick={canCreate ? onNewContact : undefined}
              disabled={!canCreate}
              title={!canCreate ? 'You do not have permission to create contacts' : undefined}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                canCreate
                  ? 'border-slate-200 text-[#3440a8] hover:bg-[#eef0fb] cursor-pointer'
                  : 'border-slate-200 text-slate-400 bg-slate-50 cursor-not-allowed opacity-60'
              }`}
            >
              <Plus className="w-3.5 h-3.5" />
              New contact
              {!canCreate && <Lock className="w-3 h-3 text-slate-400" />}
            </button>
          </div>
        ) : (
          conversations.map((conv) => {
            const selected = conv.customer.id === selectedCustomerId;
            const unread = conv.unreadCount > 0 && !selected;
            const type = conversationChannelType(conv);
            return (
              <button
                key={conv.id}
                onClick={() => onSelect(conv)}
                className={`w-full text-left px-3.5 py-3 border-b border-slate-100 border-l-[3px] grid grid-cols-[36px_1fr] gap-x-3 gap-y-2 cursor-pointer transition-colors ${
                  selected ? 'bg-[#eef0fb] border-l-[#3440a8]' : 'border-l-transparent hover:bg-slate-50'
                }`}
              >
                <Avatar name={conv.customer.name} src={conv.customer.avatarUrl} />
                <span className="min-w-0">
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-bold text-[13px] text-slate-950 truncate">{conv.customer.name}</span>
                    <span className="text-[11px] text-slate-600 font-medium shrink-0">{formatListTime(conv.lastMessageAt)}</span>
                  </span>
                  <span className="mt-0.5 flex items-center justify-between gap-2">
                    <span className={`text-[12.5px] truncate ${unread ? 'font-bold text-black' : 'text-slate-700'}`}>
                      {lastMessagePreview(conv)}
                    </span>
                    {unread && (
                      <span className="min-w-5 h-5 px-1 rounded-full bg-[#3440a8] text-white text-[11px] font-semibold flex items-center justify-center shrink-0">
                        {conv.unreadCount}
                      </span>
                    )}
                  </span>
                </span>

                <span className="flex justify-center items-center">
                  <ChannelIcon type={type} size="xs" />
                </span>
                <span className="flex items-center gap-1.5 flex-wrap min-w-0">
                  <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[11px]">{CHANNEL_LABELS[type] || type}</span>
                  {conv.channel?.status === 'disconnected' && (
                    <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 text-[10px] font-medium">
                      Disconnected
                    </span>
                  )}
                  {conv.handledBy === 'ai' && (
                    <span className="px-1.5 py-0.5 rounded bg-[#eef0fb] text-[#3440a8] text-[11px] font-medium">AI</span>
                  )}
                  {conv.needsHuman && (
                    <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 text-[11px] font-medium">Needs human</span>
                  )}
                  {conv.tags.map((tag) => (
                    <span key={tag} className="px-1.5 py-0.5 rounded bg-[#fde8ef] text-[#c0365f] text-[11px]">
                      {tag}
                    </span>
                  ))}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
};
