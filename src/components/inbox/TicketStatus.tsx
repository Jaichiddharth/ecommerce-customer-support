'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  CircleCheck,
  CircleDot,
  CirclePause,
  Coins,
  Lock,
  RotateCcw,
  Sparkles,
  Ticket,
  TicketPlus,
  UserMinus,
  UserPlus,
} from 'lucide-react';
import { isClosedTicketStatus, type TicketCredits, type TicketEvent, type TicketEventAction } from '@/types/ticket';

const formatWhen = (iso?: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString([], { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const EVENT_STYLE: Record<TicketEventAction, { icon: React.ElementType; className: string }> = {
  opened: { icon: TicketPlus, className: 'bg-[#eef0fb]/70 border-[#dfe2f6] text-[#3440a8]' },
  resolved: { icon: CircleCheck, className: 'bg-emerald-50/60 border-emerald-100 text-emerald-800' },
  reopened: { icon: RotateCcw, className: 'bg-slate-50 border-slate-200 text-slate-700' },
  status: { icon: CircleDot, className: 'bg-slate-50 border-slate-200 text-slate-700' },
  assigned: { icon: UserPlus, className: 'bg-slate-50 border-slate-200 text-slate-700' },
  unassigned: { icon: UserMinus, className: 'bg-slate-50 border-slate-200 text-slate-700' },
  ai_on: { icon: Sparkles, className: 'bg-[#eef0fb]/70 border-[#dfe2f6] text-[#3440a8]' },
  ai_off: { icon: CirclePause, className: 'bg-slate-50 border-slate-200 text-slate-700' },
  billable: { icon: Coins, className: 'bg-amber-50/60 border-amber-100 text-amber-800' },
};

/** Ticket audit entry in the thread: what changed, who changed it and when. Only the team sees it. */
export const TicketEventRow: React.FC<{ event: TicketEvent; text: string }> = ({ event, text }) => {
  const { icon: Icon, className } = EVENT_STYLE[event.action] ?? EVENT_STYLE.status;
  return (
    <div className="flex justify-center py-1">
      <div className={`max-w-[85%] rounded-lg border px-3 py-1.5 text-center text-[11.5px] leading-snug ${className}`}>
        <p className="font-semibold inline-flex items-center gap-1">
          <Icon className="w-3.5 h-3.5 shrink-0" />
          {text}
        </p>
        <p className="text-[10.5px] text-slate-400">{formatWhen(event.occurredAt)} · visible to your team only</p>
      </div>
    </div>
  );
};

type MenuStatus = 'OPEN' | 'RESOLVED';

const STATUS_OPTIONS: { value: MenuStatus; label: string; hint: string; icon: React.ElementType; iconClass: string }[] = [
  { value: 'OPEN', label: 'Open', hint: 'The team is working on it', icon: CircleDot, iconClass: 'text-[#3440a8]' },
  {
    value: 'RESOLVED',
    label: 'Resolved',
    hint: "Moves it to Closed. The customer's next message opens a new ticket.",
    icon: CircleCheck,
    iconClass: 'text-emerald-600',
  },
];

/** Chat header dropdown: the ticket's status (Open / Resolved) */
export const TicketStatusMenu: React.FC<{
  status: string | null;
  disabled?: boolean;
  onChange: (status: MenuStatus) => void;
}> = ({ status, disabled, onChange }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const closed = isClosedTicketStatus(status);
  const current: MenuStatus = closed ? 'RESOLVED' : 'OPEN';

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={disabled ? undefined : () => setOpen((v) => !v)}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        title={disabled ? 'You do not have permission to update conversations' : 'Ticket status'}
        className={`flex items-center gap-1.5 px-2.5 py-2 rounded-lg border text-[13px] font-medium whitespace-nowrap transition-colors ${
          closed ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-slate-300 bg-white text-slate-900'
        } ${disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer hover:bg-slate-50'}`}
      >
        {closed ? <CircleCheck className="w-4 h-4 text-emerald-600" /> : <CircleDot className="w-4 h-4 text-[#3440a8]" />}
        {closed ? 'Resolved' : 'Open'}
        {disabled ? <Lock className="w-3.5 h-3.5 text-slate-400" /> : <ChevronDown className="w-3.5 h-3.5" />}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full mt-1.5 w-72 bg-white border border-slate-200 rounded-xl shadow-lg p-1.5 z-30 text-[13px]">
          {STATUS_OPTIONS.map(({ value, label, hint, icon: Icon, iconClass }) => (
            <button
              key={value}
              type="button"
              role="menuitemradio"
              aria-checked={current === value}
              onClick={() => {
                setOpen(false);
                if (current !== value) onChange(value);
              }}
              className="w-full flex items-start gap-2.5 px-2.5 py-2 rounded-lg hover:bg-slate-50 text-left cursor-pointer"
            >
              <Icon className={`w-4 h-4 mt-0.5 ${iconClass}`} />
              <span className="flex-1">
                <span className="block font-medium text-slate-900">
                  {value === 'OPEN' && closed ? 'Reopen' : label}
                </span>
                <span className="block text-xs text-slate-500">{hint}</span>
              </span>
              {current === value && <Check className="w-4 h-4 text-[#3440a8]" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

/**
 * Composer footer: whether this ticket is billable yet and the workspace's ticket credits left.
 * Mock billing: a ticket uses one credit the first time a teammate replies on it; sending is never blocked.
 */
export const TicketCreditsBar: React.FC<{
  credits: TicketCredits | null;
  billableAt?: string | null;
  isClosed: boolean;
}> = ({ credits, billableAt, isClosed }) => {
  const ticketLine = isClosed
    ? 'Resolved ticket · replying opens a new ticket and uses 1 credit'
    : billableAt
      ? `Billable ticket · 1 credit used${formatWhen(billableAt) ? ` on ${formatWhen(billableAt)}` : ''}`
      : 'Not billed yet · your first reply uses 1 ticket credit';

  const over = credits ? Math.max(0, credits.used - credits.allowance) : 0;
  const empty = credits ? credits.remaining === 0 : false;
  const usedPct = credits && credits.allowance > 0 ? Math.min(100, (credits.used / credits.allowance) * 100) : 0;

  return (
    <div
      className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between gap-3 text-[11px]"
      title="Billing preview (mock): each ticket uses one credit the first time a teammate replies on it. Internal notes are free."
    >
      <span className={`flex items-center gap-1.5 min-w-0 ${billableAt && !isClosed ? 'text-amber-800' : 'text-slate-500'}`}>
        {billableAt && !isClosed ? <Coins className="w-3.5 h-3.5 shrink-0" /> : <Ticket className="w-3.5 h-3.5 shrink-0" />}
        <span className="truncate">{ticketLine}</span>
      </span>
      {credits && (
        <span className={`flex items-center gap-2 shrink-0 ${empty ? 'text-red-600' : 'text-slate-600'}`}>
          <span
            className="w-16 h-1.5 rounded-full bg-slate-100 overflow-hidden"
            role="meter"
            aria-label="Ticket credits used"
            aria-valuemin={0}
            aria-valuemax={credits.allowance}
            aria-valuenow={Math.min(credits.used, credits.allowance)}
          >
            <span
              className={`block h-full rounded-full ${empty ? 'bg-red-500' : usedPct >= 80 ? 'bg-amber-500' : 'bg-[#3440a8]'}`}
              style={{ width: `${usedPct}%` }}
            />
          </span>
          <span>
            <span className="font-semibold">{credits.remaining}</span> / {credits.allowance} credits left
            {over > 0 && <span className="font-medium"> · over by {over}</span>}
          </span>
        </span>
      )}
    </div>
  );
};
