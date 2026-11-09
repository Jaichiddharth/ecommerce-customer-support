'use client';

import React from 'react';
import { ClipboardList } from 'lucide-react';
import type { Message } from '@/types';

type FlowResponse = NonNullable<Message['flowResponse']>;

/** A customer's WhatsApp Flow (form) response in the thread: one row per question, in the Flow's order */
export const FlowResponseCard: React.FC<{ response: FlowResponse }> = ({ response }) => (
  <div className="min-w-[220px]">
    <div className="mb-2 flex items-center gap-2">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#eef0fb] text-[#3440a8]">
        <ClipboardList className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Form response</p>
        {response.flowName && (
          <p className="truncate text-[13px] font-semibold text-slate-900" title={response.flowName}>
            {response.flowName}
          </p>
        )}
      </div>
    </div>
    {response.answers.length === 0 ? (
      <p className="text-xs text-slate-500">The customer submitted the form without answers.</p>
    ) : (
      <dl className="divide-y divide-slate-100 rounded-lg border border-slate-100 bg-slate-50/60">
        {response.answers.map((a) => (
          <div key={a.key} className="px-2.5 py-1.5">
            <dt className="text-[11px] text-slate-500">{a.label}</dt>
            <dd className="whitespace-pre-wrap break-words text-[13px] font-medium text-slate-800">{a.value}</dd>
          </div>
        ))}
      </dl>
    )}
  </div>
);
