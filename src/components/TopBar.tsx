'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Bell, CircleHelp, Plus, Search } from 'lucide-react';
import { ChannelIcon } from './inbox/ChannelIcon';
import { Avatar } from './inbox/ConversationList';
import { InboxConversation, contactIdentifier, conversationChannelType, formatPhone } from './inbox/inbox-types';

const MAX_RESULTS = 8;

// ─── ContactSearch ────────────────────────────────────────────────────────────

interface ContactSearchProps {
  conversations: InboxConversation[];
  onOpenConversation: (conv: InboxConversation) => void;
  /** Shows a "New WhatsApp contact" row under the results when given */
  onNewContact?: (prefill: string) => void;
  /** Called on first focus, so pages without conversations loaded can fetch them lazily */
  onActivate?: () => void;
}

/** Contact search box with a results dropdown; Ctrl/Cmd + K focuses it */
export const ContactSearch: React.FC<ContactSearchProps> = ({ conversations, onOpenConversation, onNewContact, onActivate }) => {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);

  const activate = () => {
    setOpen(true);
    onActivate?.();
  };

  // Ctrl/Cmd + K focuses the contact search
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const digits = q.replace(/\D/g, '');
    return conversations
      .filter((c) => {
        const { name, handle, phone, email } = c.customer;
        return (
          name.toLowerCase().includes(q) ||
          (handle && handle.toLowerCase().includes(q.replace(/^@/, ''))) ||
          (email && email.toLowerCase().includes(q)) ||
          (digits.length > 2 && phone && phone.includes(digits))
        );
      })
      .slice(0, MAX_RESULTS);
  }, [conversations, query]);

  const choose = (conv: InboxConversation) => {
    onOpenConversation(conv);
    setQuery('');
    setOpen(false);
    inputRef.current?.blur();
  };

  return (
    <div className="relative" ref={boxRef}>
      <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={activate}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && results[0]) choose(results[0]);
          if (e.key === 'Escape') {
            setOpen(false);
            inputRef.current?.blur();
          }
        }}
        placeholder="Search contacts, orders..."
        className="w-[230px] pl-9 pr-11 py-2 text-[13px] bg-slate-50 border border-slate-200 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-[#3440a8] focus:ring-1 focus:ring-[#3440a8]"
      />
      <kbd className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-slate-400 font-sans pointer-events-none">
        {isMac ? '⌘K' : 'Ctrl K'}
      </kbd>

      {open && query.trim() && (
        <div className="absolute right-0 top-full mt-1.5 w-[300px] bg-white border border-slate-200 rounded-xl shadow-lg p-1.5 z-40">
          {results.length === 0 ? (
            <p className="px-2.5 py-3 text-xs text-slate-500">No contacts match &ldquo;{query.trim()}&rdquo;.</p>
          ) : (
            results.map((conv) => (
              <button
                key={conv.id}
                onClick={() => choose(conv)}
                className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-slate-50 text-left cursor-pointer"
              >
                <Avatar name={conv.customer.name} src={conv.customer.avatarUrl} />
                <span className="flex-1 min-w-0">
                  <span className="block text-[13px] font-medium text-slate-900 truncate">{conv.customer.name}</span>
                  <span className="block text-[11px] text-slate-500 truncate">{contactIdentifier(conv)}</span>
                </span>
                <ChannelIcon type={conversationChannelType(conv)} size="sm" />
              </button>
            ))
          )}
          {onNewContact && (
            <button
              onClick={() => {
                onNewContact(query.trim());
                setQuery('');
                setOpen(false);
              }}
              className="w-full mt-1 pt-2 border-t border-slate-100 flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-slate-50 text-[13px] font-medium text-[#3440a8] cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              New WhatsApp contact
            </button>
          )}
        </div>
      )}
    </div>
  );
};

// ─── TopBar ───────────────────────────────────────────────────────────────────

interface TopBarProps {
  /** Left side: page title, breadcrumb, context chips */
  children: React.ReactNode;
  /** Usually a <ContactSearch /> */
  search?: React.ReactNode;
  primaryNumber: string | null;
  isLive: boolean;
}

/** Page header shared by the inbox and settings: title on the left; search, live number, notifications and help on the right */
export const TopBar: React.FC<TopBarProps> = ({ children, search, primaryNumber, isLive }) => (
  <header className="h-16 bg-white border-b border-slate-200 px-5 flex items-center justify-between gap-4 shrink-0">
    <div className="flex items-center gap-3 min-w-0">{children}</div>

    <div className="flex items-center gap-3 shrink-0">
      {search}

      {primaryNumber && (
        <span
          title={isLive ? 'WhatsApp number connected · live updates on' : 'Reconnecting live updates…'}
          className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-[13px] font-medium ${
            isLive ? 'bg-[#ebf8f0] border-[#c9ecd6] text-[#17803d]' : 'bg-amber-50 border-amber-200 text-amber-700'
          }`}
        >
          <span className={`w-2 h-2 rounded-full ${isLive ? 'bg-[#22a453]' : 'bg-amber-500'}`} />
          {formatPhone(primaryNumber)}
        </span>
      )}

      <button title="Notifications" className="w-9 h-9 rounded-lg text-slate-600 hover:bg-slate-100 flex items-center justify-center cursor-pointer">
        <Bell className="w-[18px] h-[18px]" />
      </button>
      <button title="Help" className="w-9 h-9 rounded-lg text-slate-600 hover:bg-slate-100 flex items-center justify-center cursor-pointer">
        <CircleHelp className="w-[18px] h-[18px]" />
      </button>
    </div>
  </header>
);
