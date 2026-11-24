'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { ArrowRight, TrendingDown, TrendingUp } from 'lucide-react';
import { ErrorState } from '@/components/ui/states';
import { HANDOVER_REASON_LABELS } from '@/lib/ai-agent/policy';
import { aiAgentApi, type KnowledgeStats, type KnowledgeSource, type Overview, type Usage } from './api';
import { Card, Pill, Skeleton, Stat, pct, timeAgo } from './ui';
import type { AgentContext } from './AiAgentView';

type TabKey = 'overview' | 'knowledge' | 'guardrails' | 'model' | 'test-set';

const CHANNEL_LABEL: Record<string, string> = { whatsapp: 'WhatsApp', instagram: 'Instagram', web: 'Web chat' };

export function OverviewTab({ ctx, goTo }: { ctx: AgentContext; goTo: (t: TabKey) => void }) {
  const [data, setData] = useState<{ overview: Overview; usage: Usage; knowledge: { sources: KnowledgeSource[]; stats: KnowledgeStats } } | null>(null);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [overview, usage, knowledge] = await Promise.all([aiAgentApi.overview(30), aiAgentApi.usage(), aiAgentApi.knowledge()]);
      setData({ overview, usage, knowledge });
    } catch (err) {
      setError(err);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (error) return <ErrorState error={error} title="Couldn't load the overview" onRetry={load} />;
  if (!data) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}</div>
        <Skeleton className="h-80 rounded-2xl" />
      </div>
    );
  }

  const { overview, usage, knowledge } = data;
  const k = overview.kpis;
  const delta = k.resolution_rate != null && k.previous_resolution_rate != null
    ? Math.round((k.resolution_rate - k.previous_resolution_rate) * 100) : null;
  const channels = k.channels.filter((c) => c !== 'test').map((c) => CHANNEL_LABEL[c] ?? c);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <Stat
          label="AI resolution rate"
          value={pct(k.resolution_rate)}
          sub={delta == null ? 'Resolved without your team' : (
            <span className="inline-flex items-center gap-1">
              {delta >= 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
              {Math.abs(delta)} pts vs previous 30 days
            </span>
          )}
          subTone={delta == null ? 'slate' : delta >= 0 ? 'green' : 'red'}
        />
        <Stat
          label="Conversations handled"
          value={k.conversations.toLocaleString()}
          sub={`Last 30 days${channels.length ? ` · ${channels.join(' + ')}` : ''}`}
        />
        <Stat
          label="Handed to your team"
          value={k.handed_over.toLocaleString()}
          sub={k.conversations ? `${pct(k.handover_rate)} of conversations` : 'No handovers yet'}
          subTone={k.conversations ? 'amber' : 'slate'}
        />
        <Stat
          label="First reply time"
          value={k.median_first_reply_ms == null ? '—' : `${(k.median_first_reply_ms / 1000).toFixed(1)} s`}
          sub={k.p90_first_reply_ms == null ? 'Median' : `Median · 90% under ${Math.ceil(k.p90_first_reply_ms / 1000)} s`}
        />
      </div>

      {k.conversations === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-5 flex flex-wrap items-center gap-4">
          <div className="flex-1 min-w-[240px]">
            <div className="text-[14px] font-semibold text-slate-800">No customer conversations yet</div>
            <p className="text-[13px] text-slate-500 mt-0.5">
              Add your help content, then try the agent yourself. Numbers here count real customer chats only; test chats are never included.
            </p>
          </div>
          <button onClick={() => goTo('knowledge')} className="rounded-lg border border-slate-200 px-3 py-2 text-[13px] font-semibold text-slate-700 hover:bg-slate-50">Add knowledge</button>
          <button onClick={() => ctx.openTest()} className="rounded-lg bg-[#3440a8] px-3 py-2 text-[13px] font-semibold text-white hover:bg-[#2a3490]">Test the agent</button>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[1.65fr_1fr] gap-6">
        <Card
          title="Resolutions by day"
          subtitle="Resolved by AI vs handed to team · last 14 days"
          action={
            <div className="flex gap-4 text-[12px] text-slate-600">
              <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-[#3440a8]" /> Resolved by AI</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-[#b8bdf0]" /> Handed over</span>
            </div>
          }
        >
          <ResolutionsChart rows={overview.by_day} days={14} />
        </Card>

        <Card title="Top topics" action={<span className="text-[12px] text-slate-500 pt-1">Resolved</span>}>
          {overview.topics.length === 0 ? (
            <p className="text-[13px] text-slate-500">Topics appear once customers start chatting.</p>
          ) : (
            <ul className="space-y-4">
              {overview.topics.map((t) => {
                const rate = t.resolution_rate ?? 0;
                const color = rate >= 0.8 ? 'bg-emerald-700' : rate >= 0.55 ? 'bg-amber-600' : 'bg-red-600';
                return (
                  <li key={t.topic} className="grid grid-cols-[minmax(0,1fr)_3rem_minmax(60px,9rem)_3rem] items-center gap-3 text-[13px]">
                    <span className="truncate text-slate-800" title={t.topic}>{t.topic}</span>
                    <span className="text-right text-slate-500 tabular-nums">{t.conversations}</span>
                    <span className="h-2 rounded-full bg-slate-100 overflow-hidden">
                      <span className={`block h-full rounded-full ${color}`} style={{ width: `${Math.round(rate * 100)}%` }} />
                    </span>
                    <span className="text-right font-semibold text-slate-800 tabular-nums">{pct(t.resolution_rate)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1.65fr_1fr] gap-6">
        <Card
          title="Recent handovers"
          action={<a href="/inbox" className="inline-flex items-center gap-1 text-[13px] font-semibold text-[#3440a8] hover:underline">View all in Inbox <ArrowRight className="w-3.5 h-3.5" /></a>}
          bodyClassName="p-0 pt-3"
        >
          {overview.recent_handovers.length === 0 ? (
            <p className="px-5 pb-5 text-[13px] text-slate-500">No handovers in the last 30 days.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    <th className="px-5 py-2.5">Customer</th>
                    <th className="px-3 py-2.5">Reason</th>
                    <th className="px-3 py-2.5">Topic</th>
                    <th className="px-3 py-2.5">Channel</th>
                    <th className="px-5 py-2.5">When</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.recent_handovers.map((h) => (
                    <tr key={h.run_id} className="border-t border-slate-100">
                      <td className="px-5 py-3 text-slate-800" title={h.question ?? undefined}>{h.user_id ? `Customer ${h.user_id}` : 'Visitor'}</td>
                      <td className="px-3 py-3 text-slate-600">{HANDOVER_REASON_LABELS[h.handover_reason ?? ''] ?? h.reason_label ?? '—'}</td>
                      <td className="px-3 py-3 text-slate-600">{h.topic ?? '—'}</td>
                      <td className="px-3 py-3 text-slate-600">{h.channel ? CHANNEL_LABEL[h.channel] ?? h.channel : '—'}</td>
                      <td className="px-5 py-3 text-slate-500 whitespace-nowrap">{timeAgo(h.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <NeedsAttention ctx={ctx} overview={overview} usage={usage} knowledge={knowledge} goTo={goTo} />
      </div>
    </div>
  );
}

function ResolutionsChart({ rows, days }: { rows: Overview['by_day']; days: number }) {
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const series = Array.from({ length: days }, (_, i) => {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() - (days - 1 - i));
    const key = d.toISOString().slice(0, 10);
    const r = byDay.get(key);
    return { key, label: String(d.getUTCDate()), resolved: r?.resolved ?? 0, handed: r?.handed_over ?? 0 };
  });
  const max = Math.max(4, ...series.map((s) => s.resolved + s.handed));
  const step = Math.ceil(max / 3 / 5) * 5 || 1;
  const top = step * 3;
  const W = 640, H = 240, L = 32, B = 22, T = 8;
  const plotH = H - B - T;
  const slot = (W - L) / series.length;
  const bw = Math.min(30, slot * 0.6);
  const y = (v: number) => T + plotH - (v / top) * plotH;

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[480px] h-auto" role="img" aria-label="Resolved by AI and handed over, per day">
        {[0, 1, 2, 3].map((i) => (
          <g key={i}>
            <line x1={L} x2={W} y1={y(i * step)} y2={y(i * step)} stroke="#eef0f5" />
            <text x={L - 8} y={y(i * step) + 4} textAnchor="end" fontSize="11" fill="#94a3b8">{i * step}</text>
          </g>
        ))}
        {series.map((s, i) => {
          const x = L + i * slot + (slot - bw) / 2;
          const rTop = y(s.resolved);
          const hTop = y(s.resolved + s.handed);
          return (
            <g key={s.key}>
              <title>{`${s.key}: ${s.resolved} resolved by AI, ${s.handed} handed over`}</title>
              {s.resolved > 0 && <rect x={x} y={rTop} width={bw} height={y(0) - rTop} rx={3} fill="#3440a8" />}
              {s.handed > 0 && <rect x={x} y={hTop} width={bw} height={rTop - hTop - (s.resolved > 0 ? 2 : 0)} rx={3} fill="#b8bdf0" />}
              <text x={x + bw / 2} y={H - 4} textAnchor="middle" fontSize="11" fill="#94a3b8">{s.label}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function NeedsAttention({ ctx, overview, usage, knowledge, goTo }: {
  ctx: AgentContext;
  overview: Overview;
  usage: Usage;
  knowledge: { sources: KnowledgeSource[]; stats: KnowledgeStats };
  goTo: (t: TabKey) => void;
}) {
  const items: { tone: 'amber' | 'red' | 'blue'; title: string; sub: string; tab?: TabKey }[] = [];
  if (!ctx.config.enabled) items.push({ tone: 'amber', title: 'The agent is paused', sub: 'Customers only reach your team', tab: 'overview' });
  if (knowledge.stats.sources === 0) items.push({ tone: 'red', title: 'No knowledge added yet', sub: 'Add FAQs, policies or your help site', tab: 'knowledge' });
  for (const s of knowledge.sources.filter((s) => !s.enabled).slice(0, 2)) {
    items.push({ tone: 'amber', title: `${s.title} is a draft`, sub: 'Review and switch on', tab: 'knowledge' });
  }
  if (knowledge.stats.errors > 0) items.push({ tone: 'red', title: `${knowledge.stats.errors} knowledge source${knowledge.stats.errors > 1 ? 's' : ''} failed`, sub: 'Check and sync again', tab: 'knowledge' });
  if (overview.low_confidence_7d > 0) items.push({ tone: 'red', title: `${overview.low_confidence_7d} low-confidence answer${overview.low_confidence_7d > 1 ? 's' : ''}`, sub: 'Last 7 days · check in Test set', tab: 'test-set' });
  const cap = usage.plan.includedResolutions;
  if (cap) {
    const share = usage.creditsUsed / cap;
    if (share >= 0.5) items.push({ tone: share >= 0.9 ? 'red' : 'blue', title: `${Math.round(share * 100)}% of AI resolutions used`, sub: `${usage.creditsUsed} of ${cap} this month`, tab: 'model' });
  }
  items.push({ tone: 'amber', title: 'Refunds and exchanges go to a person', sub: 'The agent collects details, your team approves', tab: 'guardrails' });

  const dot = { amber: 'bg-amber-600', red: 'bg-red-600', blue: 'bg-[#3440a8]' };
  return (
    <Card title="Needs attention">
      <ul className="space-y-4">
        {items.slice(0, 5).map((it) => (
          <li key={it.title}>
            <button onClick={() => it.tab && goTo(it.tab)} className="flex w-full items-start gap-3 text-left group">
              <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${dot[it.tone]}`} />
              <span>
                <span className="block text-[14px] font-semibold text-slate-800 group-hover:text-[#3440a8]">{it.title}</span>
                <span className="block text-[12px] text-slate-500">{it.sub}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {overview.window_days && <Pill tone="slate" className="mt-4">Real customer chats only</Pill>}
    </Card>
  );
}
