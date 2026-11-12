'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Loader2, Lock, Search, User, UserMinus } from 'lucide-react';
import { getInitials, type InboxTeammate } from './inbox-types';

interface AssigneeMenuProps {
  assigneeId: number | null;
  /** Name the ticket carries; used when the owner isn't in the teammate list (e.g. removed from the workspace) */
  assigneeName: string | null;
  teammates: InboxTeammate[];
  isLoading: boolean;
  /** Teammates couldn't be loaded; opening the menu retries */
  loadFailed: boolean;
  onRetry: () => void;
  currentUserId: number | null;
  disabled?: boolean;
  /** null unassigns the ticket */
  onAssign: (teammate: InboxTeammate | null) => void;
}

/** Shows who owns the ticket; the menu assigns it to a teammate (the signed-in one is marked "(me)") or unassigns it */
export const AssigneeMenu: React.FC<AssigneeMenuProps> = ({
  assigneeId,
  assigneeName,
  teammates,
  isLoading,
  loadFailed,
  onRetry,
  currentUserId,
  disabled = false,
  onAssign,
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    if (loadFailed) onRetry();
    // Focus once the menu is painted
    const t = setTimeout(() => searchRef.current?.focus(), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // The signed-in teammate first, then everyone else by name
  const ordered = useMemo(() => {
    const me = teammates.filter((t) => t.id === currentUserId);
    const others = teammates.filter((t) => t.id !== currentUserId);
    return [...me, ...others];
  }, [teammates, currentUserId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ordered;
    return ordered.filter((t) => t.name.toLowerCase().includes(q) || t.email.toLowerCase().includes(q) || (t.id === currentUserId && 'me'.includes(q)));
  }, [ordered, query, currentUserId]);

  const isMine = assigneeId != null && assigneeId === currentUserId;
  const ownerName = assigneeId == null ? null : teammates.find((t) => t.id === assigneeId)?.name ?? assigneeName ?? 'Teammate';

  const pick = (teammate: InboxTeammate | null) => {
    setOpen(false);
    if ((teammate?.id ?? null) === assigneeId) return;
    onAssign(teammate);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={disabled ? 'You do not have permission to assign tickets' : 'Assign this ticket'}
        className={`flex items-center gap-1.5 max-w-[220px] px-2.5 py-2 rounded-lg text-[13px] font-medium ${
          disabled ? 'bg-slate-50 text-slate-400 cursor-not-allowed' : 'bg-slate-100 text-slate-700 hover:bg-slate-200/70 cursor-pointer'
        }`}
      >
        <User className="w-4 h-4 shrink-0" />
        <span className="truncate">
          {ownerName ? (
            <>
              {ownerName}
              {isMine && <span className="text-slate-500 font-normal"> (me)</span>}
            </>
          ) : (
            <span className="text-slate-500">Unassigned</span>
          )}
        </span>
        {disabled ? <Lock className="w-3.5 h-3.5 shrink-0" /> : <ChevronDown className="w-3.5 h-3.5 shrink-0" />}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-72 bg-white border border-slate-200 rounded-xl shadow-lg z-30 text-[13px] overflow-hidden">
          <div className="px-3 pt-2.5 pb-1.5 text-[10.5px] font-semibold tracking-wider text-slate-500">ASSIGN TO</div>
          <div className="px-2 pb-2 border-b border-slate-100">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                ref={searchRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && filtered.length > 0) pick(filtered[0]);
                }}
                placeholder="Search teammates"
                className="w-full pl-7 pr-2 py-1.5 text-[12.5px] border border-slate-200 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-none focus:border-[#3440a8] focus:ring-1 focus:ring-[#3440a8]"
              />
            </div>
          </div>

          <div role="listbox" className="max-h-64 overflow-y-auto p-1.5">
            {isLoading && teammates.length === 0 ? (
              <div className="flex items-center justify-center gap-2 py-4 text-xs text-slate-500">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Loading teammates…
              </div>
            ) : loadFailed && teammates.length === 0 ? (
              <div className="py-4 text-center text-xs text-slate-500">
                Couldn&apos;t load teammates.{' '}
                <button type="button" onClick={onRetry} className="font-semibold text-[#3440a8] hover:underline cursor-pointer">
                  Retry
                </button>
              </div>
            ) : filtered.length === 0 ? (
              <div className="py-4 text-center text-xs text-slate-500">No teammates match “{query.trim()}”</div>
            ) : (
              filtered.map((t) => {
                const selected = t.id === assigneeId;
                const me = t.id === currentUserId;
                return (
                  <button
                    key={t.id}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => pick(t)}
                    className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-left cursor-pointer ${selected ? 'bg-[#eef0fb]' : 'hover:bg-slate-50'}`}
                  >
                    <span className="relative shrink-0">
                      {t.avatarUrl ? (
                        <img src={t.avatarUrl} alt="" className="w-7 h-7 rounded-full object-cover" />
                      ) : (
                        <span className="w-7 h-7 rounded-full bg-[#eef0fb] text-[#3440a8] text-[11px] font-semibold flex items-center justify-center">
                          {getInitials(t.name)}
                        </span>
                      )}
                      {t.isOnline && (
                        <span title="Online" className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-white" />
                      )}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block font-medium text-slate-900 truncate">
                        {t.name}
                        {me && <span className="text-slate-500 font-normal"> (me)</span>}
                      </span>
                      <span className="block text-[11px] text-slate-500 truncate">{t.email}</span>
                    </span>
                    {selected && <Check className="w-4 h-4 text-[#3440a8] shrink-0" />}
                  </button>
                );
              })
            )}
          </div>

          {assigneeId != null && (
            <div className="p-1.5 border-t border-slate-100">
              <button
                type="button"
                onClick={() => pick(null)}
                className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-left text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                <UserMinus className="w-4 h-4 text-slate-500" />
                Unassign
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
