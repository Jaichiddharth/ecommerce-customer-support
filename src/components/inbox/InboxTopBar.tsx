'use client';

import React from 'react';
import { ChevronRight } from 'lucide-react';
import { ChannelIcon } from './ChannelIcon';
import { InboxConversation } from './inbox-types';
import { ContactSearch, TopBar } from '../TopBar';

interface InboxTopBarProps {
  scope: { type: string | null; label: string };
  conversations: InboxConversation[];
  onOpenConversation: (conv: InboxConversation) => void;
  onNewContact: (prefill: string) => void;
  primaryNumber: string | null;
  isLive: boolean;
  isChannelsCollapsed: boolean;
  onExpandChannels: () => void;
}

export const InboxTopBar: React.FC<InboxTopBarProps> = ({
  scope,
  conversations,
  onOpenConversation,
  onNewContact,
  primaryNumber,
  isLive,
  isChannelsCollapsed,
  onExpandChannels,
}) => (
  <TopBar
    primaryNumber={primaryNumber}
    isLive={isLive}
    search={<ContactSearch conversations={conversations} onOpenConversation={onOpenConversation} onNewContact={onNewContact} />}
  >
    {isChannelsCollapsed && (
      <button
        onClick={onExpandChannels}
        title="Show channels"
        className="w-7 h-7 rounded-lg border border-slate-200 text-slate-500 hover:text-slate-800 hover:bg-slate-50 flex items-center justify-center cursor-pointer"
      >
        <ChevronRight className="w-4 h-4" />
      </button>
    )}
    <h1 className="text-[18px] font-semibold text-slate-900">Inbox</h1>
    <span className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-slate-100 text-xs text-slate-700 truncate">
      {scope.type && <ChannelIcon type={scope.type} size="xs" />}
      <span className="truncate">{scope.label}</span>
    </span>
  </TopBar>
);
