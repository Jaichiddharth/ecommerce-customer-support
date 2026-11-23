'use client';

import React, { useState } from 'react';
import { getMetaErrorInfo } from '@/lib/errors/meta-errors';

interface Props {
  /** Meta error code stored with the message, if any */
  errorCode?: number | null;
  /** Text stored with the failure; the catalog's message is used when empty */
  errorMessage?: string | null;
  /** Status badge shown at the top of the popover, e.g. { label: 'Failed', className: 'bg-red-50 …' } */
  badge: { label: string; className: string };
  className?: string;
  children: React.ReactNode;
}

const WIDTH = 320;

/**
 * Hover (or focus) popover with the whole story of a failed message: Meta's code, the catalog's title, what
 * happened, why, and what to do. Used by the inbox and the campaign contacts table so both explain errors the same
 * way. It is `position: fixed`, so scroll containers (chat, tables) don't clip it.
 */
export function MessageIssuePopover({ errorCode, errorMessage, badge, className = '', children }: Props) {
  const [pos, setPos] = useState<{ top: number; left: number; above: boolean } | null>(null);
  const info = getMetaErrorInfo(errorCode);
  const message = errorMessage?.trim() || info?.userMessage || (errorCode ? `WhatsApp error ${errorCode}.` : 'The message could not be delivered.');

  const show = (e: React.SyntheticEvent<HTMLElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const above = rect.bottom + 240 > window.innerHeight;
    setPos({
      top: above ? rect.top - 6 : rect.bottom + 6,
      left: Math.max(8, Math.min(rect.left, window.innerWidth - WIDTH - 8)),
      above,
    });
  };

  return (
    <span
      className={`cursor-help outline-none ${className}`}
      tabIndex={0}
      onMouseEnter={show}
      onMouseLeave={() => setPos(null)}
      onFocus={show}
      onBlur={() => setPos(null)}
    >
      {children}
      {pos && (
        <span
          role="tooltip"
          className="fixed z-50 block w-[320px] rounded-lg border border-slate-200 bg-white p-3 shadow-lg text-left whitespace-normal font-normal"
          style={{ top: pos.top, left: pos.left, transform: pos.above ? 'translateY(-100%)' : undefined }}
        >
          <span className="flex items-center gap-2 mb-1.5">
            <span className={`inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded-md border ${badge.className}`}>{badge.label}</span>
            {errorCode ? <span className="font-mono text-[11px] text-slate-700">Error {errorCode}</span> : null}
          </span>
          {info?.title && <span className="block text-[12px] font-semibold text-slate-900 mb-1">{info.title}</span>}
          <span className="block text-[12px] leading-snug text-slate-800">{message}</span>
          {info?.description && info.description !== message && (
            <span className="block mt-2 text-[11px] leading-snug text-slate-700">
              <span className="font-semibold text-slate-900">Why: </span>
              {info.description}
            </span>
          )}
          {info?.solution && (
            <span className="block mt-1.5 text-[11px] leading-snug text-slate-700">
              <span className="font-semibold text-slate-900">What to do: </span>
              {info.solution}
            </span>
          )}
        </span>
      )}
    </span>
  );
}
