'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { ExternalLink, Info } from 'lucide-react';
import { aiAgentApi, type AgentConfig } from '@/components/ai-agent/api';
import { VariableInput } from './VariableInput';
import type { FieldLikeProps } from './whatsapp/AutomationFlowFields';

const HANDOVER_OPTIONS = [
  { value: 'agent', label: 'The agent’s own handover message', hint: 'For example: “I’m connecting you with our team, they’ll reply here shortly.”' },
  { value: 'custom', label: 'My message', hint: 'Sent instead of the agent’s message.' },
  { value: 'none', label: 'Nothing', hint: 'Handle it yourself with steps on the Handover path.' },
] as const;

const CONVERSATION_OPTIONS = [
  {
    key: 'quickReplies',
    label: 'Show reply buttons',
    hint: 'Tappable next steps under the agent’s replies, such as “Track my order” or “No, that’s all”.',
  },
  {
    key: 'resolveOnEnd',
    label: 'Resolve the ticket when the customer ends the chat',
    hint: 'After “No, that’s all”, “thanks, bye” and similar. Their next message opens a new ticket.',
  },
] as const;

type Status ={ state: 'loading' } | { state: 'ok'; config: AgentConfig } | { state: 'unknown' };

/**
 * Settings of the AI Agent Reply step. What the agent knows and its guardrails are set on the AI agent
 * page; here the merchant only decides what the customer gets when the agent hands over.
 */
export function AiAgentFields({
  local,
  set,
  inputCls,
  invalidCls,
  errors,
  Field,
}: {
  local: Record<string, unknown>;
  set: (k: string, v: unknown) => void;
  inputCls: string;
  invalidCls: string;
  errors: Record<string, string>;
  Field: React.FC<FieldLikeProps>;
}) {
  const [status, setStatus] = useState<Status>({ state: 'loading' });
  const handoverReply = (local.handoverReply as string) || 'agent';

  useEffect(() => {
    let alive = true;
    // Teammates without access to the AI agent page simply don't see the status
    aiAgentApi.getConfig().then(
      (config) => alive && setStatus({ state: 'ok', config }),
      () => alive && setStatus({ state: 'unknown' }),
    );
    return () => {
      alive = false;
    };
  }, []);

  return (
    <>
      <AgentStatus status={status} />

      <p className="flex items-start gap-2 text-[12px] text-slate-500 leading-snug bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5">
        <Info className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-px" />
        <span>
          Answers the customer’s message with your AI agent: help and FAQ from its knowledge, and order status for the
          orders linked to the customer’s WhatsApp number. Refunds, exchanges and anything your guardrails flag go to the
          Handover path. It stays quiet while a teammate is handling the chat.
        </span>
      </p>

      <Field label="When the agent hands over, send">
        <div className="space-y-1.5" role="radiogroup">
          {HANDOVER_OPTIONS.map((o) => (
            <label
              key={o.value}
              className={`flex items-start gap-2.5 rounded-lg border px-3 py-2 cursor-pointer transition-colors ${
                handoverReply === o.value ? 'border-[#3440a8]/50 bg-[#eef0fb]/60' : 'border-slate-200 hover:bg-slate-50'
              }`}
            >
              <input
                type="radio"
                name="handoverReply"
                className="mt-0.5 accent-[#3440a8]"
                checked={handoverReply === o.value}
                onChange={() => set('handoverReply', o.value)}
              />
              <span className="min-w-0">
                <span className="block text-[12px] font-medium text-slate-700">{o.label}</span>
                <span className="block text-[11px] text-slate-500 leading-snug">{o.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </Field>

      <Field label="Conversation">
        <div className="space-y-1.5">
          {CONVERSATION_OPTIONS.map((o) => (
            <label key={o.key} className="flex items-start gap-2.5 rounded-lg border border-slate-200 px-3 py-2 cursor-pointer hover:bg-slate-50">
              <input
                type="checkbox"
                className="mt-0.5 accent-[#3440a8]"
                checked={local[o.key] !== false}
                onChange={(e) => set(o.key, e.target.checked)}
              />
              <span className="min-w-0">
                <span className="block text-[12px] font-medium text-slate-700">{o.label}</span>
                <span className="block text-[11px] text-slate-500 leading-snug">{o.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </Field>

      {handoverReply === 'custom' && (
        <Field label="Handover message" name="handoverMessage" required hint="Use Insert variable to personalise it.">
          <VariableInput
            multiline
            rows={3}
            value={String(local.handoverMessage ?? '')}
            onChange={(v) => set('handoverMessage', v)}
            className={`${inputCls} min-h-[80px] ${errors.handoverMessage ? invalidCls : ''}`}
            placeholder="Thanks {{contact.name}}, one of our team will reply here shortly."
          />
        </Field>
      )}
    </>
  );
}

function AgentStatus({ status }: { status: Status }) {
  const link = (
    <Link
      href="/ai-agent"
      target="_blank"
      className="inline-flex items-center gap-1 text-[11.5px] font-medium text-[#3440a8] hover:underline shrink-0"
    >
      AI agent settings
      <ExternalLink className="w-3 h-3" />
    </Link>
  );
  if (status.state === 'loading') {
    return <div className="h-[42px] rounded-lg bg-slate-50 border border-slate-200 animate-pulse" />;
  }
  if (status.state === 'unknown') {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2.5">
        <span className="text-[12px] text-slate-600">Knowledge, guardrails and the model are set on the AI agent page.</span>
        {link}
      </div>
    );
  }
  const { enabled, liveVersion } = status.config;
  return (
    <div
      className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 ${
        enabled ? 'border-emerald-200 bg-emerald-50/60' : 'border-amber-200 bg-amber-50/70'
      }`}
    >
      <span className="min-w-0">
        <span className={`flex items-center gap-1.5 text-[12px] font-semibold ${enabled ? 'text-emerald-700' : 'text-amber-800'}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${enabled ? 'bg-emerald-500' : 'bg-amber-500'}`} />
          {enabled ? 'AI agent is live' : 'AI agent is paused'}
          {liveVersion && <span className="font-normal text-slate-500">· v{liveVersion.version}</span>}
        </span>
        {!enabled && (
          <span className="block text-[11px] text-amber-800/80 leading-snug mt-0.5">
            While it’s paused, this step sends nothing and follows the Handover path.
          </span>
        )}
      </span>
      {link}
    </div>
  );
}
