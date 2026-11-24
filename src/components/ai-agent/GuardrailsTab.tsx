'use client';

import React, { useState } from 'react';
import { Loader2, Lock, Plus, ShieldCheck, X } from 'lucide-react';
import { notifyError } from '@/lib/api/notify';
import {
  ADVANCED_GUARDRAIL_PLANS, BRAND_VOICE_MAX, CONFIDENCE_OPTIONS, LENGTH_OPTIONS, MAX_NEVER_SAY, MAX_TOPICS, RETENTION_OPTIONS,
  SUPPORTED_LANGUAGES, TONE_OPTIONS, TURN_OPTIONS, advancedGuardrailsIncluded, type AgentPolicy, type HandoverRules,
} from '@/lib/ai-agent/policy';
import { aiAgentApi, type ChatReply } from './api';
import { Card, Pill, Select, Toggle } from './ui';
import type { AgentContext } from './AiAgentView';

const AMOUNT_OPTIONS = [2000, 5000, 10000, 25000, 50000];
const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;

export function GuardrailsTab({ ctx }: { ctx: AgentContext }) {
  const { draft, setDraft, canEdit } = ctx;
  const h = draft.handover;
  const setRule = <K extends keyof HandoverRules>(key: K, patch: Partial<HandoverRules[K]>) =>
    setDraft((p) => ({ ...p, handover: { ...p.handover, [key]: { ...p.handover[key], ...patch } } }));

  const rules: { key: keyof HandoverRules | 'refund' | 'critical'; title: string; sub: string; setting: React.ReactNode; on: boolean; locked?: boolean }[] = [
    {
      key: 'askHuman', title: 'Customer asks for a person', sub: '"human", "agent", "call me"', on: h.askHuman.on,
      setting: <Select label="Languages" disabled={!canEdit || !h.askHuman.on} value={h.askHuman.scope} onChange={(v) => setRule('askHuman', { scope: v })}
        options={[{ value: 'any_language', label: 'Any language' }, { value: 'english_only', label: 'English only' }]} />,
    },
    {
      key: 'angryTone', title: 'Complaint or angry tone', sub: 'Detected from the message', on: h.angryTone.on,
      setting: <Select label="Sensitivity" disabled={!canEdit || !h.angryTone.on} value={h.angryTone.sensitivity} onChange={(v) => setRule('angryTone', { sensitivity: v })}
        options={[{ value: 'low', label: 'Sensitivity: Low (abusive only)' }, { value: 'medium', label: 'Sensitivity: Medium' }, { value: 'high', label: 'Sensitivity: High (any unhappiness)' }]} />,
    },
    {
      key: 'sensitiveTopics', title: 'Legal topics', sub: 'Legal notice, consumer court, police', on: h.sensitiveTopics.on,
      setting: <Select label="Mode" disabled value="always" onChange={() => undefined} options={[{ value: 'always', label: 'Hand over' }]} />,
    },
    {
      key: 'critical', title: 'Self-harm, fraud or safety', sub: 'Unauthorised payments, injuries, allergic reactions', on: true, locked: true,
      setting: <Select label="Mode" disabled value="always" onChange={() => undefined} options={[{ value: 'always', label: 'Always hand over' }]} />,
    },
    {
      key: 'lowConfidence', title: 'No answer in knowledge', sub: 'Below confidence threshold', on: h.lowConfidence.on,
      setting: <Select label="Threshold" disabled={!canEdit || !h.lowConfidence.on} value={h.lowConfidence.threshold} onChange={(v) => setRule('lowConfidence', { threshold: v })}
        options={CONFIDENCE_OPTIONS.map((v) => ({ value: v, label: `Threshold: ${v.toFixed(2)}` }))} />,
    },
    {
      key: 'turnLimit', title: 'Too many agent turns', sub: 'Customer still not resolved', on: h.turnLimit.on,
      setting: <Select label="Turns" disabled={!canEdit || !h.turnLimit.on} value={h.turnLimit.turns} onChange={(v) => setRule('turnLimit', { turns: v })}
        options={TURN_OPTIONS.map((v) => ({ value: v, label: `After ${v} turns` }))} />,
    },
    {
      key: 'highValueOrder', title: 'High-value order', sub: 'Order total above limit', on: h.highValueOrder.on,
      setting: <Select label="Amount" disabled={!canEdit || !h.highValueOrder.on} value={h.highValueOrder.amount} onChange={(v) => setRule('highValueOrder', { amount: v })}
        options={Array.from(new Set([...AMOUNT_OPTIONS, h.highValueOrder.amount])).sort((a, b) => a - b).map((v) => ({ value: v, label: `Above ${inr(v)}` }))} />,
    },
    {
      key: 'repeatContact', title: 'Repeat customer contact', sub: `Same issue within ${h.repeatContact.hours} h`, on: h.repeatContact.on,
      setting: h.repeatContact.on
        ? <Select label="Window" disabled={!canEdit} value={h.repeatContact.hours} onChange={(v) => setRule('repeatContact', { hours: v })}
            options={[12, 24, 48, 72].map((v) => ({ value: v, label: `Within ${v} h` }))} />
        : <span className="px-3 text-slate-400">—</span>,
    },
    {
      key: 'refund', title: 'Refund or exchange request', sub: 'Only your team can approve these', on: true, locked: true,
      setting: <Select label="Mode" disabled value="always" onChange={() => undefined} options={[{ value: 'always', label: 'Always hand over' }]} />,
    },
  ];

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1.65fr_1fr] gap-6 items-start">
      <div className="space-y-6">
        <Card title="Handover rules" subtitle="When any rule matches, the agent stops and assigns the chat to your team." bodyClassName="p-0 pt-3">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <th className="px-5 py-2.5">Rule</th>
                  <th className="px-3 py-2.5 w-[38%]">Setting</th>
                  <th className="px-5 py-2.5 text-center w-20">On</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((r) => (
                  <tr key={r.key} className="border-t border-slate-100">
                    <td className="px-5 py-3">
                      <div className="text-[14px] font-medium text-slate-800">{r.title}</div>
                      <div className="text-[12px] text-slate-500">{r.sub}</div>
                    </td>
                    <td className="px-3 py-3">{r.setting}</td>
                    <td className="px-5 py-3 text-center">
                      {r.locked ? (
                        <span title="Platform rule: always on" className="inline-flex"><Lock className="w-4 h-4 text-slate-400" /></span>
                      ) : (
                        <Toggle label={r.title} checked={r.on} disabled={!canEdit} onChange={(v) => setRule(r.key as keyof HandoverRules, { on: v } as never)} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <NeverSayCard ctx={ctx} />
        <TopicsCard draft={draft} setDraft={setDraft} canEdit={canEdit} />
        <ModerationCard draft={draft} setDraft={setDraft} canEdit={canEdit} />
      </div>

      <div className="space-y-6">
        <BehaviourCard draft={draft} setDraft={setDraft} canEdit={canEdit} />
        <AlwaysOnCard />
        <AdvancedCard draft={draft} setDraft={setDraft} canEdit={canEdit} plan={ctx.config.plan.name} />
        <PrivacyCard draft={draft} setDraft={setDraft} canEdit={canEdit} />
      </div>
    </div>
  );
}

function BehaviourCard({ draft, setDraft, canEdit }: { draft: AgentPolicy; setDraft: AgentContext['setDraft']; canEdit: boolean }) {
  const pe = draft.persona;
  const setPersona = (patch: Partial<AgentPolicy['persona']>) => setDraft((p) => ({ ...p, persona: { ...p.persona, ...patch } }));
  const radio = (checked: boolean) => (
    <span className={`flex h-[18px] w-[18px] items-center justify-center rounded-full border-2 ${checked ? 'border-[#3440a8]' : 'border-slate-300'}`}>
      {checked && <span className="h-2 w-2 rounded-full bg-[#3440a8]" />}
    </span>
  );
  return (
    <Card title="Behaviour" subtitle="How the agent sounds and when it replies">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[13px] font-semibold text-slate-800">Tone</div>
          <div className="text-[11px] text-slate-500">{TONE_OPTIONS.find((t) => t.value === pe.tone)?.hint}</div>
        </div>
        <Select label="Tone" className="w-44" disabled={!canEdit} value={pe.tone} onChange={(v) => setPersona({ tone: v })}
          options={TONE_OPTIONS.map((t) => ({ value: t.value, label: t.label }))} />
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="text-[13px] font-semibold text-slate-800">Reply length</div>
        <Select label="Reply length" className="w-56" disabled={!canEdit} value={pe.replyLength} onChange={(v) => setPersona({ replyLength: v })}
          options={LENGTH_OPTIONS} />
      </div>
      <label className="mt-4 block text-[13px] font-semibold text-slate-800">{pe.tone === 'custom' ? 'Brand voice' : 'Brand-voice notes'}</label>
      <div className="relative mt-1.5">
        <textarea
          value={pe.brandVoice}
          disabled={!canEdit}
          maxLength={BRAND_VOICE_MAX}
          onChange={(e) => setPersona({ brandVoice: e.target.value })}
          rows={3}
          className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 pb-6 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#3440a8]/20 disabled:bg-slate-50"
        />
        <span className="absolute bottom-2 right-3 text-[11px] text-slate-400">{pe.brandVoice.length} / {BRAND_VOICE_MAX}</span>
      </div>
      <p className="text-[11px] text-slate-500 mt-1">Tone only. Safety rules and your guardrails always come first.</p>

      <div className="mt-4 text-[13px] font-semibold text-slate-800">Reply language</div>
      <div className="mt-2 space-y-2" role="radiogroup">
        <button disabled={!canEdit} onClick={() => setPersona({ replyLanguage: 'match' })} className="flex items-center gap-2 text-[13px] text-slate-700">{radio(pe.replyLanguage === 'match')} Match the customer</button>
        {pe.replyLanguage === 'match' && (
          <div className="ml-7 flex flex-wrap gap-2">
            {SUPPORTED_LANGUAGES.filter((l) => l !== 'Tanglish').map((l) => {
              const on = pe.languages.includes(l);
              const locked = l === 'English';
              return (
                <button
                  key={l}
                  disabled={!canEdit || locked}
                  title={locked ? 'English is always available' : on ? 'Click to stop replying in this language' : 'Click to reply in this language'}
                  onClick={() => setPersona({ languages: on ? pe.languages.filter((x) => x !== l) : [...pe.languages, l] })}
                  className={`rounded-full px-3 py-1 text-[12px] font-medium transition-colors ${on ? 'bg-indigo-50 text-[#3440a8]' : 'bg-white text-slate-400 border border-dashed border-slate-300'}`}
                >
                  {l}
                </button>
              );
            })}
          </div>
        )}
        <button disabled={!canEdit} onClick={() => setPersona({ replyLanguage: 'english' })} className="flex items-center gap-2 text-[13px] text-slate-700">{radio(pe.replyLanguage === 'english')} Always English</button>
      </div>

      <div className="mt-4 text-[13px] font-semibold text-slate-800">When the agent replies</div>
      <div className="mt-2 space-y-2" role="radiogroup">
        <button disabled={!canEdit} onClick={() => setPersona({ replyHours: '24x7' })} className="flex items-center gap-2 text-[13px] text-slate-700">{radio(pe.replyHours === '24x7')} 24 × 7</button>
        <button disabled={!canEdit} onClick={() => setPersona({ replyHours: 'outside_business_hours' })} className="flex items-center gap-2 text-[13px] text-slate-700 text-left">
          {radio(pe.replyHours === 'outside_business_hours')} Only outside business hours
        </button>
        <p className="ml-7 text-[11px] text-slate-500">Business hours come from Settings › Routing.</p>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <div>
          <div className="text-[13px] font-semibold text-slate-800">Max reply length</div>
          <div className="text-[11px] text-slate-500">Links only from your knowledge · no tables</div>
        </div>
        <Select label="Max reply length" className="w-44" disabled={!canEdit} value={pe.maxReplyChars} onChange={(v) => setPersona({ maxReplyChars: v })}
          options={Array.from(new Set([300, 400, 600, 900, 1200, pe.maxReplyChars])).sort((a, b) => a - b).map((v) => ({ value: v, label: `${v} characters` }))} />
      </div>
    </Card>
  );
}

function NeverSayCard({ ctx }: { ctx: AgentContext }) {
  const { draft, setDraft, canEdit } = ctx;
  const [adding, setAdding] = useState(false);
  const [question, setQuestion] = useState('Can you give me 50% off?');
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<ChatReply | null>(null);

  const test = async () => {
    if (!question.trim()) return;
    setTesting(true);
    setResult(null);
    try {
      setResult(await aiAgentApi.testChat({
        conversationId: `guard_${Date.now()}`,
        messages: [{ role: 'user', content: question.trim() }],
        policy: draft,
      }));
    } catch (err) {
      notifyError(err, { where: 'GuardrailsTab.test', title: "Couldn't test the agent" });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Card
      title="Never say or promise"
      subtitle="The agent refuses politely and offers a person instead."
      action={canEdit && draft.neverSay.length < MAX_NEVER_SAY && (
        <button onClick={() => setAdding(true)} className="inline-flex items-center gap-1 text-[13px] font-semibold text-[#3440a8] hover:underline"><Plus className="w-4 h-4" /> Add rule</button>
      )}
    >
      <ChipList
        items={draft.neverSay}
        onChange={(neverSay) => setDraft((p) => ({ ...p, neverSay }))}
        canEdit={canEdit}
        adding={adding}
        setAdding={setAdding}
        placeholder="e.g. Bulk pricing"
        empty="No rules yet."
      />

      <div className="mt-5 rounded-xl bg-indigo-50/70 p-4">
        <form onSubmit={(e) => { e.preventDefault(); void test(); }} className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-semibold text-[#3440a8]">Test it:</span>
          <input value={question} onChange={(e) => setQuestion(e.target.value)} className="flex-1 min-w-[180px] rounded-lg border border-indigo-100 bg-white px-3 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#3440a8]/20" />
          <button type="submit" disabled={testing} className="inline-flex items-center gap-1.5 rounded-lg bg-[#3440a8] px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-60">
            {testing && <Loader2 className="w-3 h-3 animate-spin" />} Ask
          </button>
        </form>
        {result && (
          <div className="mt-3 text-[13px] text-slate-700">
            <span className="font-medium">Agent:</span> &ldquo;{result.reply}&rdquo;
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <Pill tone={result.outcome === 'handover' ? 'amber' : result.outcome === 'blocked' ? 'red' : 'green'}>{result.outcome}</Pill>
              {result.flags.includes('never_say_blocked') && <Pill tone="red">Blocked by never-say</Pill>}
              <span className="text-[11px] text-slate-500 self-center">Uses your unsaved changes</span>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

function PrivacyCard({ draft, setDraft, canEdit }: { draft: AgentPolicy; setDraft: AgentContext['setDraft']; canEdit: boolean }) {
  const pr = draft.privacy;
  const always = (label: string) => (
    <div className="flex items-center gap-3">
      <span className="text-[12px] text-slate-500">Always</span>
      <Toggle label={label} checked disabled />
    </div>
  );
  return (
    <Card title="Data & privacy" subtitle="What the model sees and what we keep">
      <ul className="space-y-4 text-[13px] text-slate-800">
        <li className="flex items-center justify-between gap-3"><span>Mask phone numbers and emails in logs</span>{always('Mask phone numbers and emails in logs')}</li>
        <li className="flex items-center justify-between gap-3"><span>Hide full address from the model</span>{always('Hide address')}</li>
        <li className="flex items-center justify-between gap-3"><span>Never send card or UPI details</span>{always('Never send card or UPI details')}</li>
        <li className="flex items-center justify-between gap-3"><span>Provider may not train on your data</span>{always('No provider training')}</li>
        <li className="flex items-center justify-between gap-3">
          <span>Keep chat transcripts</span>
          <Select label="Keep chat transcripts" className="w-36" disabled={!canEdit} value={pr.retentionDays}
            onChange={(v) => setDraft((p) => ({ ...p, privacy: { ...p.privacy, retentionDays: v } }))}
            options={Array.from(new Set([...RETENTION_OPTIONS, pr.retentionDays])).sort((a, b) => a - b).map((v) => ({ value: v, label: v >= 365 ? `${Math.round(v / 365)} year` : `${v} days` }))} />
        </li>
      </ul>
    </Card>
  );
}

/** Editable list of short phrases (never-say rules, restricted topics, competitor names) */
function ChipList({ items, onChange, canEdit, adding, setAdding, placeholder, empty, max = MAX_TOPICS }: {
  items: string[];
  onChange: (items: string[]) => void;
  canEdit: boolean;
  adding: boolean;
  setAdding: (v: boolean) => void;
  placeholder: string;
  empty: string;
  max?: number;
}) {
  const [value, setValue] = useState('');
  const add = () => {
    const v = value.trim().slice(0, 80);
    if (v && items.length < max && !items.some((x) => x.toLowerCase() === v.toLowerCase())) onChange([...items, v]);
    setValue('');
    setAdding(false);
  };
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((t) => (
        <span key={t} className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 text-[13px] text-slate-700">
          {t}
          {canEdit && (
            <button aria-label={`Remove ${t}`} onClick={() => onChange(items.filter((x) => x !== t))} className="text-slate-400 hover:text-slate-700">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </span>
      ))}
      {adding && (
        <form onSubmit={(e) => { e.preventDefault(); add(); }} className="inline-flex">
          <input autoFocus value={value} onChange={(e) => setValue(e.target.value)} onBlur={add} maxLength={80} placeholder={placeholder}
            className="w-48 rounded-full border border-[#3440a8]/40 px-3 py-1.5 text-[13px] focus:outline-none" />
        </form>
      )}
      {items.length === 0 && !adding && <span className="text-[13px] text-slate-500">{empty}</span>}
    </div>
  );
}

type CardProps = { draft: AgentPolicy; setDraft: AgentContext['setDraft']; canEdit: boolean };

function TopicsCard({ draft, setDraft, canEdit }: CardProps) {
  const t = draft.topics;
  const [addingTopic, setAddingTopic] = useState(false);
  const [addingRival, setAddingRival] = useState(false);
  const setTopics = (patch: Partial<AgentPolicy['topics']>) => setDraft((p) => ({ ...p, topics: { ...p.topics, ...patch } }));
  const addButton = (onClick: () => void, show: boolean) => show && canEdit && (
    <button onClick={onClick} className="inline-flex items-center gap-1 text-[13px] font-semibold text-[#3440a8] hover:underline"><Plus className="w-4 h-4" /> Add</button>
  );
  return (
    <Card title="Topics" subtitle="What the agent talks about">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[13px] font-semibold text-slate-800">Store topics only</div>
          <div className="text-[12px] text-slate-500">Questions about something else (homework, news, jokes) get a polite &ldquo;I can only help with questions about your store&rdquo;. They don&apos;t show up as knowledge gaps.</div>
        </div>
        <Toggle label="Store topics only" checked={t.businessOnly} disabled={!canEdit} onChange={(v) => setTopics({ businessOnly: v })} />
      </div>

      <div className="mt-5 flex items-center justify-between">
        <div>
          <div className="text-[13px] font-semibold text-slate-800">Topics the agent declines</div>
          <div className="text-[12px] text-slate-500">When a customer raises one, the agent says it can&apos;t help with that and offers your team.</div>
        </div>
        {addButton(() => setAddingTopic(true), t.restricted.length < MAX_TOPICS)}
      </div>
      <div className="mt-2">
        <ChipList items={t.restricted} onChange={(restricted) => setTopics({ restricted })} canEdit={canEdit} adding={addingTopic} setAdding={setAddingTopic}
          placeholder="e.g. Crypto payments" empty="None. Add subjects like wholesale orders or franchise enquiries." />
      </div>

      <div className="mt-5 flex items-center justify-between">
        <div>
          <div className="text-[13px] font-semibold text-slate-800">Competitors</div>
          <div className="text-[12px] text-slate-500">Never recommended, compared with or mentioned. A reply naming one is replaced.</div>
        </div>
        {addButton(() => setAddingRival(true), t.competitors.length < MAX_TOPICS)}
      </div>
      <div className="mt-2">
        <ChipList items={t.competitors} onChange={(competitors) => setTopics({ competitors })} canEdit={canEdit} adding={addingRival} setAdding={setAddingRival}
          placeholder="e.g. Brand name" empty="None added." />
      </div>
    </Card>
  );
}

function ModerationCard({ draft, setDraft, canEdit }: CardProps) {
  const m = draft.moderation;
  const set = (patch: Partial<AgentPolicy['moderation']>) => setDraft((p) => ({ ...p, moderation: { ...p.moderation, ...patch } }));
  const rows: { key: keyof AgentPolicy['moderation']; title: string; sub: string }[] = [
    { key: 'profanity', title: 'Abusive language', sub: 'A calm reply asking to keep it respectful. With "Complaint or angry tone" on, abusive chats go to your team instead.' },
    { key: 'harmful', title: 'Harmful requests', sub: 'Violence, weapons or drugs, sexual or hateful messages are declined.' },
    { key: 'outputFilter', title: 'Check the agent’s replies', sub: 'A reply containing abusive words is never sent.' },
  ];
  return (
    <Card title="Content moderation" subtitle="Word lists in English, Hindi, Hinglish and Tamil. No extra AI cost.">
      <ul className="space-y-4">
        {rows.map((r) => (
          <li key={r.key} className="flex items-start justify-between gap-4">
            <div>
              <div className="text-[13px] font-semibold text-slate-800">{r.title}</div>
              <div className="text-[12px] text-slate-500">{r.sub}</div>
            </div>
            <Toggle label={r.title} checked={m[r.key]} disabled={!canEdit} onChange={(v) => set({ [r.key]: v })} />
          </li>
        ))}
      </ul>
    </Card>
  );
}

function AlwaysOnCard() {
  const items = [
    'Prompt-injection and jailbreak attempts are refused (also Hindi and Hinglish, and disguised spellings)',
    'Instructions hidden in your website pages, PDFs or product descriptions are ignored',
    'Customers only ever see their own orders; stores never see each other’s data',
    'Card numbers, OTPs, PINs, passwords and keys are removed from messages, replies and logs',
    'Prices, discounts and stock in replies come only from your store; invented ones are removed',
    'Phone numbers or emails the agent wasn’t given are removed from its replies',
    'Refunds and exchanges are approved only by your team',
    'Chats are deleted after your retention period',
  ];
  return (
    <Card title="Always on" subtitle="Platform protections that can't be switched off">
      <ul className="space-y-2.5">
        {items.map((t) => (
          <li key={t} className="flex items-start gap-2 text-[13px] text-slate-700">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />{t}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function AdvancedCard({ draft, setDraft, canEdit, plan }: CardProps & { plan: string }) {
  const a = draft.advanced;
  const included = advancedGuardrailsIncluded(plan);
  const set = (patch: Partial<AgentPolicy['advanced']>) => setDraft((p) => ({ ...p, advanced: { ...p.advanced, ...patch } }));
  const rows: { key: keyof AgentPolicy['advanced']; title: string; sub: string }[] = [
    { key: 'groundednessCheck', title: 'Double-check weak answers', sub: 'A second AI check of help answers that look uncertain. Unsupported answers go to your team. Small extra AI cost, only on those answers.' },
    { key: 'injectionClassifier', title: 'Smarter injection detection', sub: 'Catches reworded attempts to override the agent, by meaning. No extra cost.' },
    { key: 'aiModeration', title: 'AI content moderation', sub: 'The AI provider’s moderation check for messages the word lists don’t catch.' },
  ];
  const plans = ADVANCED_GUARDRAIL_PLANS.map((x) => x[0].toUpperCase() + x.slice(1)).join(' and ');
  return (
    <Card title="Advanced protection" subtitle={included ? 'Included in your plan' : `Included in the ${plans} plans`}
      action={!included && <Pill tone="blue">{plans}</Pill>}>
      <ul className="space-y-4">
        {rows.map((r) => (
          <li key={r.key} className="flex items-start justify-between gap-4">
            <div className={included ? '' : 'opacity-60'}>
              <div className="text-[13px] font-semibold text-slate-800">{r.title}</div>
              <div className="text-[12px] text-slate-500">{r.sub}</div>
            </div>
            <Toggle label={r.title} checked={included && a[r.key]} disabled={!canEdit || !included} onChange={(v) => set({ [r.key]: v })} />
          </li>
        ))}
      </ul>
    </Card>
  );
}
