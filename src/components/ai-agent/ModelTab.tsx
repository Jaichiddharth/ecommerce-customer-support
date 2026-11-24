'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { notifyError } from '@/lib/api/notify';
import { gooeyToast } from '@/components/ui/goey-toaster';
import { ErrorState } from '@/components/ui/states';
import { CREDITS_PER_RESOLUTION, type ModelTier } from '@/lib/ai-agent/policy';
import { aiAgentApi, type ByoConfig, type KnowledgeStats, type Usage, type Version } from './api';
import { ByoCard } from './ByoCard';
import { Card, Pill, Skeleton, fmtDate, pct, timeAgo } from './ui';
import type { AgentContext } from './AiAgentView';

const MODELS: { key: ModelTier; name: string; desc: string; badge?: React.ReactNode }[] = [
  { key: 'standard', name: 'UnoCX Standard', desc: 'Fast and low cost. Best for order status, FAQs and policies.', badge: <Pill tone="green" dot>Recommended</Pill> },
  { key: 'advanced', name: 'UnoCX Advanced', desc: 'Better at long, multi-step chats and Indian languages.' },
  { key: 'byo', name: 'Bring your own model', desc: 'Your own OpenAI, Anthropic, Gemini or Groq key, connected below. You pay the provider.' },
];

export function ModelTab({ ctx }: { ctx: AgentContext }) {
  const { draft, setDraft, canEdit, config } = ctx;
  const [usage, setUsage] = useState<Usage | null>(null);
  const [stats, setStats] = useState<KnowledgeStats | null>(null);
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [rebuilding, setRebuilding] = useState(false);
  const [restoring, setRestoring] = useState<number | null>(null);
  const [byo, setByo] = useState<ByoConfig | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [u, k, v] = await Promise.all([aiAgentApi.usage(), aiAgentApi.knowledge(), aiAgentApi.versions()]);
      setUsage(u);
      setStats(k.stats);
      setVersions(v);
    } catch (err) {
      setError(err);
    }
  }, []);
  useEffect(() => { void load(); }, [load, config.liveVersion?.id]);

  const rebuild = async () => {
    setRebuilding(true);
    try {
      const r = await aiAgentApi.rebuildIndex();
      gooeyToast.success('Rebuilding the index', { description: `${r.queued} source${r.queued === 1 ? '' : 's'} queued. Answers keep working meanwhile.` });
      setTimeout(load, 2500);
    } catch (err) {
      notifyError(err, { where: 'ModelTab.rebuild', title: "Couldn't rebuild the index" });
    } finally {
      setRebuilding(false);
    }
  };

  const restore = async (v: Version) => {
    setRestoring(v.id);
    try {
      const c = await aiAgentApi.restore(v.id);
      ctx.applyConfig(c);
      gooeyToast.success(`v${v.version} restored`, { description: `Now live as v${c.liveVersion?.version}.` });
    } catch (err) {
      notifyError(err, { where: 'ModelTab.restore', title: "Couldn't restore this version" });
    } finally {
      setRestoring(null);
    }
  };

  const cap = config.plan.includedResolutions;
  const used = usage?.creditsUsed ?? 0;
  const nextMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1.65fr_1fr] gap-6 items-start">
      <div className="space-y-6">
        <Card title="AI model" subtitle="Pick the model your agent uses. You can switch at any time.">
          <div className="space-y-3" role="radiogroup">
            {MODELS.map((m) => {
              const selected = m.key === draft.modelTier;
              const disabled = !canEdit || (m.key === 'byo' && !byo?.configured);
              return (
                <button
                  key={m.key}
                  role="radio"
                  aria-checked={selected}
                  disabled={disabled}
                  onClick={() => setDraft((p) => ({ ...p, modelTier: m.key }))}
                  className={`w-full rounded-xl border-2 p-4 text-left transition-colors
                    ${selected ? 'border-[#3440a8] bg-indigo-50/60' : 'border-slate-200 hover:border-slate-300'} ${disabled && !selected ? 'cursor-not-allowed' : ''}`}
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <span className={`flex h-5 w-5 items-center justify-center rounded-full border-2 ${selected ? 'border-[#3440a8]' : 'border-slate-300'}`}>
                      {selected && <span className="h-2.5 w-2.5 rounded-full bg-[#3440a8]" />}
                    </span>
                    <span className="text-[15px] font-semibold text-slate-900">{m.name}</span>
                    {m.badge}
                    {m.key === 'byo' && byo?.configured && <Pill tone="slate">{byo.model}</Pill>}
                    {m.key === 'byo' && byo && !byo.configured && <Pill tone="amber">Connect a key below</Pill>}
                    <span className="ml-auto text-[13px] text-slate-500">
                      {m.key === 'byo' ? 'No credits used' : `${CREDITS_PER_RESOLUTION[m.key]} credit${CREDITS_PER_RESOLUTION[m.key] > 1 ? 's' : ''} per resolution`}
                    </span>
                  </div>
                  <p className="ml-8 mt-1 text-[13px] text-slate-600">{m.desc}</p>
                </button>
              );
            })}
          </div>
        </Card>

        <ByoCard ctx={ctx} onChange={setByo} />
      </div>

      <div className="space-y-6">
        {error ? <ErrorState error={error} title="Couldn't load usage" onRetry={load} /> : (
          <>
            <Card title="Usage this month" subtitle={`Resets on ${nextMonth.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`}>
              {!usage ? <Skeleton className="h-36" /> : (
                <>
                  <div className="flex items-baseline gap-2">
                    <span className="text-[36px] font-bold text-slate-900 tabular-nums">{used}</span>
                    <span className="text-[14px] text-slate-500">{cap ? `/ ${cap} AI resolution credits` : 'AI resolution credits'}</span>
                  </div>
                  {cap && (
                    <div className="mt-2 h-2.5 rounded-full bg-slate-100 overflow-hidden">
                      <div className={`h-full rounded-full ${used / cap >= 0.9 ? 'bg-red-600' : 'bg-[#3440a8]'}`} style={{ width: `${Math.min(100, (used / cap) * 100)}%` }} />
                    </div>
                  )}
                  <dl className="mt-4 divide-y divide-slate-100 text-[13px]">
                    {[
                      ['Resolved conversations', usage.resolutions.toLocaleString()],
                      ['Avg. reply time', usage.avg_latency_ms == null ? '—' : `${(usage.avg_latency_ms / 1000).toFixed(1)} s`],
                      ['Tokens per AI reply', usage.tokens_per_reply == null ? '—' : `~${usage.tokens_per_reply.toLocaleString()}`],
                      ['Model cost so far', `$${usage.cost_usd.toFixed(2)}`],
                    ].map(([k, v]) => (
                      <div key={k} className="flex justify-between py-2"><dt className="text-slate-600">{k}</dt><dd className="font-semibold text-slate-900 tabular-nums">{v}</dd></div>
                    ))}
                  </dl>
                </>
              )}
            </Card>

            <Card title="Knowledge index">
              {!stats ? <Skeleton className="h-20" /> : (
                <>
                  <p className="text-[13px] text-slate-700">Multilingual · {stats.items.toLocaleString()} items · {stats.live_sources} source{stats.live_sources === 1 ? '' : 's'}</p>
                  <p className="text-[12px] text-slate-500">Last rebuilt {timeAgo(stats.last_synced_at)}</p>
                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    <button onClick={rebuild} disabled={!canEdit || rebuilding || stats.sources === 0} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-[13px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                      {rebuilding ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Rebuild index
                    </button>
                    {stats.processing > 0 ? <Pill tone="blue" dot>Updating</Pill> : stats.errors > 0 ? <Pill tone="red" dot>{stats.errors} failed</Pill> : <Pill tone="green" dot>Up to date</Pill>}
                  </div>
                </>
              )}
            </Card>

            <Card title="Versions" action={<span className="text-[12px] text-slate-500 pt-1">Test-set score</span>} bodyClassName="pt-3">
              {!versions ? <Skeleton className="h-32" /> : versions.length === 0 ? (
                <p className="text-[13px] text-slate-500">Every time you save Guardrails or Model, a version is kept here so you can go back.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {versions.slice(0, 8).map((v) => (
                    <li key={v.id} className="flex items-start justify-between gap-3 py-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-[14px] font-semibold text-slate-900">
                          v{v.version} · {v.modelTier === 'advanced' ? 'Advanced' : v.modelTier === 'byo' ? 'Own model' : 'Standard'}
                          {v.live && <Pill tone="green" dot>Live</Pill>}
                        </div>
                        <div className="text-[12px] text-slate-500 truncate">
                          {v.live ? 'Current · ' : ''}{fmtDate(v.createdAt)}{v.createdByName ? `, ${v.createdByName.split(' ')[0]}` : ''}{v.note ? ` · ${v.note}` : ''}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className={`text-[14px] font-semibold tabular-nums ${v.testScore == null ? 'text-slate-400' : v.testScore >= 0.85 ? 'text-emerald-700' : 'text-amber-700'}`}>{pct(v.testScore)}</div>
                        {!v.live && canEdit && (
                          <button onClick={() => restore(v)} disabled={restoring !== null} className="text-[13px] font-semibold text-[#3440a8] hover:underline disabled:opacity-50">
                            {restoring === v.id ? 'Restoring…' : 'Restore'}
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
