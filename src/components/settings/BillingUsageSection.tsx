'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Calculator, ExternalLink, Info, RotateCcw } from 'lucide-react';
import apiClient from '@/lib/api/client';
import { notifyError } from '@/lib/api/notify';
import {
  DEFAULT_USD_TO_INR,
  FREE_SERVICE_MESSAGES_PER_NUMBER,
  META_PRICING_URL,
  costPerReplyUsd,
  estimate,
  formatMoney,
  fromUsd,
  META_RATES,
  marketRates,
  type Currency,
  type EstimateInput,
  type Market,
} from '@/lib/billing/cost-estimate';
import type { UsageForEstimate } from '@/lib/services/billing.service';

/** Used when the AI service can't be reached for its price list (USD per 1M tokens) */
const FALLBACK_PRICES: Record<string, { input: number; output: number }> = { 'gpt-4o-mini': { input: 0.15, output: 0.6 } };

const EXAMPLE: Omit<EstimateInput, 'currency' | 'usdToInr' | 'modelPrice' | 'rates' | 'byo'> = {
  whatsappConversations: 1000,
  webchatConversations: 300,
  repliesPerConversation: 4,
  aiSharePct: 70,
  modelReplySharePct: 60,
  inputTokensPerReply: 2000,
  outputTokensPerReply: 150,
  marketingTemplates: 0,
  utilityTemplates: 0,
  authenticationTemplates: 0,
  whatsappNumbers: 1,
};

function Card({ title, subtitle, action, children }: { title: string; subtitle?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[14px] font-semibold text-slate-900">{title}</h2>
          {subtitle && <p className="text-xs text-slate-500 mt-0.5 leading-snug">{subtitle}</p>}
        </div>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function NumberField({ label, value, onChange, suffix, step = 1, min = 0, max, hint }: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  suffix?: string;
  step?: number;
  min?: number;
  max?: number;
  hint?: string;
}) {
  return (
    <label className="block min-w-0">
      {label && <span className="block text-[12.5px] text-slate-600 mb-1.5">{label}</span>}
      <div className="flex h-9 items-center rounded-lg border border-slate-200 bg-white focus-within:border-[#3440a8] focus-within:ring-2 focus-within:ring-[#3440a8]/15">
        <input
          type="number"
          inputMode="decimal"
          min={min}
          max={max}
          step={step}
          value={Number.isFinite(value) ? value : 0}
          onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
          className="min-w-0 flex-1 bg-transparent px-3 text-[13px] text-slate-900 outline-none"
        />
        {suffix && <span className="shrink-0 pr-3 text-[12px] text-slate-400">{suffix}</span>}
      </div>
      {hint && <span className="mt-1 block text-[11px] text-slate-400 leading-snug">{hint}</span>}
    </label>
  );
}

function SelectField({ label, value, onChange, options }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="block min-w-0">
      <span className="block text-[12.5px] text-slate-600 mb-1.5">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-[13px] text-slate-900 outline-none focus:border-[#3440a8]"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-slate-50 px-3 py-2.5">
      <p className="text-[11px] text-slate-500 truncate">{label}</p>
      <p className="mt-0.5 text-[15px] font-semibold text-slate-900 truncate">{value}</p>
    </div>
  );
}

const count = (v: number) => Math.round(v).toLocaleString('en-IN');

/** The calculator's starting numbers from the workspace's last 30 days (only what it actually has data for) */
function fromUsage(u: UsageForEstimate): Partial<typeof EXAMPLE> {
  const wa = u.conversations.whatsapp ?? 0;
  const web = u.conversations.webchat ?? 0;
  const total = Object.values(u.conversations).reduce((s, v) => s + v, 0);
  const out: Partial<typeof EXAMPLE> = {
    whatsappConversations: wa,
    webchatConversations: web,
    marketingTemplates: u.templates.marketing ?? 0,
    utilityTemplates: u.templates.utility ?? 0,
    authenticationTemplates: u.templates.authentication ?? 0,
    whatsappNumbers: Math.max(1, u.whatsappNumbers),
  };
  if (u.ai.conversations > 0) {
    out.repliesPerConversation = Math.round((u.ai.replies / u.ai.conversations) * 10) / 10;
    if (total > 0) out.aiSharePct = Math.min(100, Math.round((u.ai.conversations / total) * 100));
  }
  if (u.ai.replies > 0) out.modelReplySharePct = Math.round((u.ai.llmReplies / u.ai.replies) * 100);
  if (u.ai.inputTokensPerReply) out.inputTokensPerReply = u.ai.inputTokensPerReply;
  if (u.ai.outputTokensPerReply) out.outputTokensPerReply = u.ai.outputTokensPerReply;
  return out;
}

/**
 * Settings › Billing & usage: a monthly cost calculator for AI model usage and WhatsApp (Meta) charges, starting
 * from the workspace's last 30 days. UnoCX's own plan pricing isn't final, so it is shown but not added to the total.
 */
export function BillingUsageSection() {
  const [usage, setUsage] = useState<UsageForEstimate | null>(null);
  const [loading, setLoading] = useState(true);

  const [currency, setCurrency] = useState<Currency>('INR');
  const [usdToInr, setUsdToInr] = useState(DEFAULT_USD_TO_INR);
  const [values, setValues] = useState(EXAMPLE);
  const [model, setModel] = useState('gpt-4o-mini');
  const [market, setMarket] = useState<Market | 'custom'>('india');
  const [customRates, setCustomRates] = useState(() => marketRates('india', 'INR', DEFAULT_USD_TO_INR));
  const [source, setSource] = useState<'usage' | 'example'>('example');

  useEffect(() => {
    let alive = true;
    apiClient
      .get<{ usage: UsageForEstimate }>('/api/billing/usage', { params: { days: 30 } })
      .then((res) => {
        if (!alive) return;
        const u = res.data.usage;
        setUsage(u);
        if (u.ai.model) setModel(u.ai.model);
        const hasData = Object.values(u.conversations).some((v) => v > 0) || Object.values(u.templates).some((v) => v > 0);
        if (hasData) {
          setValues((v) => ({ ...v, ...fromUsage(u) }));
          setSource('usage');
        } else {
          setValues((v) => ({ ...v, whatsappNumbers: Math.max(1, u.whatsappNumbers) }));
        }
      })
      .catch((err) => notifyError(err, { where: 'BillingUsageSection.load', title: "Couldn't load your usage" }))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const prices = usage && Object.keys(usage.prices).length ? usage.prices : FALLBACK_PRICES;
  const chatModels = Object.keys(prices).filter((m) => !m.startsWith('text-embedding'));
  const modelPrice = prices[model] ?? prices[chatModels[0]] ?? FALLBACK_PRICES['gpt-4o-mini'];
  const byo = usage?.ai.modelTier === 'byo';
  const rates = market === 'custom' ? customRates : marketRates(market, currency, usdToInr);

  const result = useMemo(
    () => estimate({ ...values, currency, usdToInr, modelPrice, rates, byo }),
    [values, currency, usdToInr, modelPrice, rates, byo],
  );

  const set = (key: keyof typeof EXAMPLE) => (v: number) => {
    setValues((s) => ({ ...s, [key]: v }));
  };

  const changeCurrency = (c: Currency) => {
    if (c === currency) return;
    // Keep custom rates worth the same in the new currency
    const k = c === 'INR' ? usdToInr : 1 / (usdToInr || DEFAULT_USD_TO_INR);
    setCustomRates((r) => ({ marketing: r.marketing * k, utility: r.utility * k, authentication: r.authentication * k }));
    setCurrency(c);
  };

  const money = (v: number) => formatMoney(v, currency);
  const replyCost = fromUsd(costPerReplyUsd(modelPrice, values.inputTokensPerReply, values.outputTokensPerReply), currency, usdToInr);

  return (
    <div className="px-8 pb-10 max-w-6xl space-y-5">
      <div className="mt-2 flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
        <Info className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" />
        <p className="text-[13px] leading-snug text-amber-900">
          <strong className="font-semibold">LLM API usage cost, for UnoCX developer reference only.</strong> UnoCX app pricing is yet to
          be decided, so these figures are not what customers will pay.
        </p>
      </div>
      <p className="text-xs text-slate-500">
        Estimate what conversations cost each month: AI agent model usage and WhatsApp (Meta) message charges.
      </p>

      {/* Real usage */}
      <Card
        title="Your last 30 days"
        subtitle={usage && !usage.ai.available ? 'AI usage is unavailable right now; the rest is from your inbox.' : 'From your inbox, AI agent and campaigns.'}
        action={
          usage && (
            <button
              type="button"
              onClick={() => {
                setValues((v) => ({ ...v, ...fromUsage(usage) }));
                setSource('usage');
              }}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-[12.5px] font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" /> Use these numbers
            </button>
          )
        }
      >
        {loading ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-[58px] rounded-lg bg-slate-100 animate-pulse" />)}
          </div>
        ) : usage ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <Stat label="WhatsApp conversations" value={count(usage.conversations.whatsapp ?? 0)} />
            <Stat label="Website chat conversations" value={count(usage.conversations.webchat ?? 0)} />
            <Stat label="AI replies" value={count(usage.ai.replies)} />
            <Stat label="AI model cost" value={byo ? 'Your provider' : money(fromUsd(usage.ai.costUsd, currency, usdToInr))} />
            <Stat
              label="Charged templates"
              value={count(Object.values(usage.templates).reduce((s, v) => s + v, 0))}
            />
          </div>
        ) : (
          <p className="text-[13px] text-slate-500">Usage couldn&apos;t be loaded. You can still use the calculator below.</p>
        )}
      </Card>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)] items-start">
        <div className="space-y-5 min-w-0">
          <Card
            title="Conversations per month"
            subtitle={source === 'usage' ? 'Filled in from your last 30 days. Change any number to see a different month.' : 'Example numbers. Change them to match your business.'}
          >
            <div className="grid gap-4 sm:grid-cols-3">
              <NumberField label="WhatsApp" value={values.whatsappConversations} onChange={set('whatsappConversations')} suffix="chats" />
              <NumberField label="Website chat" value={values.webchatConversations} onChange={set('webchatConversations')} suffix="chats" />
              <NumberField
                label="Replies per conversation"
                value={values.repliesPerConversation}
                onChange={set('repliesPerConversation')}
                step={0.5}
                hint="Messages you send (AI or team)"
              />
            </div>
          </Card>

          <Card title="AI agent" subtitle="Model cost of the replies the AI agent writes. Answers from flows and saved answers cost nothing.">
            {byo && (
              <p className="mb-4 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900">
                <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                You use your own model key, so your provider bills these replies directly. They aren&apos;t added to the total.
              </p>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2 sm:max-w-[calc(50%-0.5rem)]">
                <SelectField
                  label="Model"
                  value={model}
                  onChange={setModel}
                  options={chatModels.map((m) => ({ value: m, label: m === usage?.ai.model ? `${m} (yours)` : m }))}
                />
              </div>
              <NumberField label="Conversations the AI answers" value={values.aiSharePct} onChange={set('aiSharePct')} suffix="%" max={100} />
              <NumberField
                label="AI replies written by the model"
                value={values.modelReplySharePct}
                onChange={set('modelReplySharePct')}
                suffix="%"
                max={100}
                hint="The rest come from flows, saved answers and guardrails, at no cost"
              />
              <NumberField
                label="Input tokens per reply"
                value={values.inputTokensPerReply}
                onChange={set('inputTokensPerReply')}
                step={100}
                hint="Instructions, knowledge and chat history the model reads"
              />
              <NumberField label="Output tokens per reply" value={values.outputTokensPerReply} onChange={set('outputTokensPerReply')} step={10} />
            </div>
            <p className="mt-3 text-[11.5px] text-slate-500">
              {model}: ${modelPrice.input} per 1M input tokens, ${modelPrice.output} per 1M output tokens · about{' '}
              {formatMoney(replyCost, currency)} per reply
            </p>
          </Card>

          <Card
            title="WhatsApp (Meta charges)"
            subtitle={`Meta charges per template message by category. Replies within the 24-hour window are free up to ${count(FREE_SERVICE_MESSAGES_PER_NUMBER)} per number each month, then charged at the utility rate.`}
            action={
              <a
                href={META_PRICING_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex shrink-0 items-center gap-1 text-[12.5px] font-semibold text-[#3440a8] hover:underline"
              >
                Meta&apos;s rate card <ExternalLink className="w-3 h-3" />
              </a>
            }
          >
            <div className="grid gap-4 sm:grid-cols-3">
              <SelectField
                label="Customers' country"
                value={market}
                onChange={(v) => {
                  if (v === 'custom') {
                    // Start custom rates from the country chosen before
                    if (market !== 'custom') setCustomRates(marketRates(market, currency, usdToInr));
                  } else {
                    // Show the country's own currency (custom rates follow the switch)
                    changeCurrency(META_RATES[v as Market].currency);
                  }
                  setMarket(v as Market | 'custom');
                }}
                options={[
                  ...(Object.keys(META_RATES) as Market[]).map((m) => ({ value: m, label: `${META_RATES[m].label} (Meta rate card)` })),
                  { value: 'custom', label: 'Other / custom rates' },
                ]}
              />
              <NumberField label="WhatsApp numbers" value={values.whatsappNumbers} onChange={set('whatsappNumbers')} min={1} />
            </div>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[440px] text-[13px]">
                <thead>
                  <tr className="text-left text-[11.5px] text-slate-500">
                    <th className="pb-2 font-medium">Template category</th>
                    <th className="pb-2 font-medium">Messages per month</th>
                    <th className="pb-2 font-medium">Rate per message ({currency})</th>
                  </tr>
                </thead>
                <tbody className="align-top">
                  {(
                    [
                      ['marketing', 'Marketing', 'Offers, campaigns', 'marketingTemplates'],
                      ['utility', 'Utility', 'Order and delivery updates', 'utilityTemplates'],
                      ['authentication', 'Authentication', 'One-time passwords', 'authenticationTemplates'],
                    ] as const
                  ).map(([key, label, note, field]) => (
                    <tr key={key} className="border-t border-slate-100">
                      <td className="py-2 pr-3">
                        <p className="font-medium text-slate-800">{label}</p>
                        <p className="text-[11px] text-slate-400">{note}</p>
                      </td>
                      <td className="py-2 pr-3 w-[34%]">
                        <NumberField label="" value={values[field]} onChange={set(field)} suffix="msgs" />
                      </td>
                      <td className="py-2 w-[30%]">
                        {market !== 'custom' ? (
                          <p className="h-9 flex items-center px-3 rounded-lg bg-slate-50 text-slate-700">{formatMoney(rates[key], currency)}</p>
                        ) : (
                          <NumberField
                            label=""
                            value={Math.round(customRates[key] * 10000) / 10000}
                            step={0.001}
                            onChange={(v) => setCustomRates((r) => ({ ...r, [key]: v }))}
                          />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        {/* Result */}
        <div className="lg:sticky lg:top-4 min-w-0">
          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 text-[14px] font-semibold text-slate-900">
                <Calculator className="w-4 h-4 text-[#3440a8]" /> Estimated monthly cost
              </h2>
              <div className="flex shrink-0 rounded-lg border border-slate-200 p-0.5">
                {(['INR', 'USD'] as const).map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => changeCurrency(c)}
                    className={`rounded-md px-2.5 py-1 text-[12px] font-semibold cursor-pointer ${currency === c ? 'bg-[#eef0fb] text-[#3440a8]' : 'text-slate-500 hover:text-slate-800'}`}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>

            <p className="mt-4 text-[28px] font-bold leading-none text-slate-900">{money(result.total)}</p>
            <p className="mt-1.5 text-[12px] text-slate-500">
              {count(result.conversations)} conversations
              {result.perConversation !== null && <> · {formatMoney(result.perConversation, currency)} per conversation</>}
            </p>

            <ul className="mt-4 divide-y divide-slate-100 border-t border-slate-100">
              {result.lines.map((l) => (
                <li key={l.key} className="flex items-start justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-[13px] text-slate-800">{l.label}</p>
                    <p className="text-[11px] text-slate-400 leading-snug">{l.detail}</p>
                  </div>
                  {l.amount === null ? (
                    <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">TBA</span>
                  ) : (
                    <span className="shrink-0 text-[13px] font-semibold text-slate-900 tabular-nums">{money(l.amount)}</span>
                  )}
                </li>
              ))}
            </ul>

            <div className="mt-3 flex items-start gap-2 rounded-lg bg-[#eef0fb] px-3 py-2.5 text-[12px] leading-snug text-slate-700">
              <Info className="w-3.5 h-3.5 mt-0.5 shrink-0 text-[#3440a8]" />
              <span>
                <strong className="font-semibold text-slate-900">LLM API usage cost, for UnoCX developer reference only.</strong> UnoCX app
                pricing is yet to be decided. Covers AI model and WhatsApp (Meta) charges, before taxes such as GST.
              </span>
            </div>

            {currency === 'INR' && (
              <div className="mt-4 max-w-[200px]">
                <NumberField label="1 USD in rupees" value={usdToInr} onChange={setUsdToInr} step={0.5} min={1} hint="AI model prices are in USD" />
              </div>
            )}
            <p className="mt-3 text-[11px] text-slate-400 leading-snug">
              Meta&apos;s India and United States rates as of 1 Oct 2026. Rates change and vary by country; check Meta&apos;s rate card
              before budgeting.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
