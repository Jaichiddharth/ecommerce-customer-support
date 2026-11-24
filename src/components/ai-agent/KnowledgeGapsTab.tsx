'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, ChevronDown, ClipboardCheck, EyeOff, Lightbulb, Loader2, MessageCircle, PenLine, RefreshCw, RotateCcw } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { notifyError } from '@/lib/api/notify';
import { gooeyToast } from '@/components/ui/goey-toaster';
import { aiAgentApi, type GapReason, type GapStatus, type KnowledgeGap, type KnowledgeGaps } from './api';
import { Pill, Skeleton, Stat, pct, timeAgo } from './ui';
import type { AgentContext } from './AiAgentView';

const REASON: Record<GapReason, { label: string; tone: 'red' | 'amber' | 'slate' }> = {
  unanswered: { label: 'No answer', tone: 'red' },
  low_confidence: { label: 'Low confidence', tone: 'amber' },
  thumbs_down: { label: 'Customer said unhelpful', tone: 'slate' },
};
const CHANNEL: Record<string, string> = { whatsapp: 'WhatsApp', instagram: 'Instagram', web: 'Website', test: 'Test chat' };
const STATUS_TABS: { key: GapStatus; label: string }[] = [
  { key: 'open', label: 'To fix' },
  { key: 'resolved', label: 'Fixed' },
  { key: 'ignored', label: 'Ignored' },
];

/** 0-1 score as a coloured bar: red below 40%, amber below the gap threshold, green above */
function Score({ value, threshold, label }: { value: number | null; threshold: number; label?: string }) {
  if (value == null) return <span className="text-[12px] text-slate-400">—</span>;
  const tone = value < 0.4 ? 'bg-red-500' : value < threshold ? 'bg-amber-500' : 'bg-emerald-500';
  const text = value < 0.4 ? 'text-red-600' : value < threshold ? 'text-amber-700' : 'text-emerald-700';
  return (
    <span className="inline-flex items-center gap-2" title={label}>
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-100">
        <span className={`block h-full ${tone}`} style={{ width: `${Math.max(4, Math.round(value * 100))}%` }} />
      </span>
      <b className={`text-[13px] tabular-nums ${text}`}>{pct(value)}</b>
    </span>
  );
}

/**
 * Knowledge gaps: help questions the agent couldn't answer, answered with low confidence, or that customers marked
 * unhelpful. Writing the answer adds it to the agent's Knowledge (so it can answer next time) and to the checks
 * (so it stays answered); the question is then asked again to show the new score.
 */
export function KnowledgeGapsTab({ ctx, goTo }: { ctx: AgentContext; goTo: (tab: 'test-set' | 'knowledge') => void }) {
  const [status, setStatus] = useState<GapStatus>('open');
  const [data, setData] = useState<KnowledgeGaps | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [answering, setAnswering] = useState<KnowledgeGap | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (s: GapStatus = status) => {
    try {
      setData(await aiAgentApi.gaps(s));
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, [status]);
  useEffect(() => { setData(null); void load(status); }, [status, load]);

  // While a re-test runs in the background (after an answer is saved), refresh until it's done
  const pending = data?.gaps.some((g) => g.retest_status === 'pending');
  useEffect(() => {
    if (!pending) return;
    pollRef.current = setTimeout(() => { void load(); }, 3000);
    return () => { if (pollRef.current) clearTimeout(pollRef.current); };
  }, [pending, data, load]);

  const replace = (g: KnowledgeGap) => {
    setData((d) => d && ({ ...d, gaps: d.gaps.map((x) => (x.id === g.id ? g : x)) }));
  };

  const act = async (g: KnowledgeGap, what: 'ignore' | 'reopen' | 'check' | 'retest') => {
    setBusy(`${g.id}:${what}`);
    try {
      if (what === 'ignore' || what === 'reopen') {
        await aiAgentApi.setGapStatus(g.id, what === 'ignore' ? 'ignored' : 'open');
        gooeyToast.success(what === 'ignore' ? 'Gap ignored' : 'Back on the list to fix');
        await load();
      } else if (what === 'check') {
        replace(await aiAgentApi.gapToCheck(g.id));
        gooeyToast.success('Added to your checks', { description: 'It runs with the others under Test data › Checks.' });
      } else {
        const r = await aiAgentApi.retestGap(g.id);
        const conf = r.retest_confidence ?? 0;
        if (r.status !== g.status) await load(); else replace(r);
        if (r.retest_status === 'error') gooeyToast.warning("Couldn't re-test right now", { description: 'Try again in a moment.' });
        else if (conf >= (data?.threshold ?? 0.7)) gooeyToast.success(`Now answered with ${pct(conf)} confidence`, r.status === 'resolved' && g.status === 'open' ? { description: 'Moved to Fixed.' } : undefined);
        else gooeyToast.warning(`Still ${pct(conf)} confidence`, { description: 'Write the answer so the agent has it in its Knowledge.' });
      }
    } catch (err) {
      notifyError(err, { where: `KnowledgeGapsTab.${what}`, title: "Couldn't update the knowledge gap" });
    } finally {
      setBusy(null);
    }
  };

  if (error) return <ErrorState error={error} title="Couldn't load the knowledge gaps" onRetry={() => load()} />;
  const threshold = data?.threshold ?? 0.7;
  const sum = data?.summary;
  const help = sum?.help;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {!sum ? [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[104px] rounded-2xl" />) : (
          <>
            <Stat
              label="Help questions answered confidently"
              value={help?.asked ? pct(help.confident / help.asked) : '—'}
              sub={help?.asked ? `${help.confident} of ${help.asked} in the last 30 days` : 'No help questions in the last 30 days'}
            />
            <Stat label="Gaps to fix" value={sum.open} sub={sum.open ? `Asked ${sum.open_asks} time${sum.open_asks === 1 ? '' : 's'} in total` : 'Nothing waiting'} subTone={sum.open ? 'amber' : 'green'} />
            <Stat label="Fixed" value={sum.resolved} sub={`${sum.verified} confirmed at ${pct(threshold)}+ when asked again`} subTone="green" />
            <Stat
              label="Average improvement"
              value={sum.avg_gain != null ? `${sum.avg_gain >= 0 ? '+' : ''}${Math.round(sum.avg_gain * 100)} pts` : '—'}
              sub="Confidence after the fix vs. before"
              subTone={sum.avg_gain != null && sum.avg_gain > 0 ? 'green' : 'slate'}
            />
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-3xl text-[13px] text-slate-500">
          A question lands here when the agent couldn&apos;t answer it, answered with less than <b>{pct(threshold)}</b> confidence, or a customer said the answer didn&apos;t help.
          Similar wordings are grouped. Write the answer once: it&apos;s added to your Knowledge so the agent can answer it, and to your checks so it stays answered.
        </p>
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5" role="tablist" aria-label="Gap status">
          {STATUS_TABS.map((t) => {
            const n = sum ? sum[t.key === 'resolved' ? 'resolved' : t.key] : null;
            return (
              <button key={t.key} role="tab" aria-selected={status === t.key} onClick={() => setStatus(t.key)}
                className={`rounded-md px-3 py-1.5 text-[13px] font-semibold ${status === t.key ? 'bg-[#3440a8] text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
                {t.label}{n != null ? <span className={`ml-1.5 tabular-nums ${status === t.key ? 'text-white/80' : 'text-slate-400'}`}>{n}</span> : null}
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white">
        {!data ? (
          <div className="space-y-3 p-5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16" />)}</div>
        ) : !data.gaps.length ? (
          <EmptyState
            icon={status === 'open' ? <CheckCircle2 className="w-5 h-5" /> : <Lightbulb className="w-5 h-5" />}
            title={status === 'open' ? 'No knowledge gaps to fix' : status === 'resolved' ? 'Nothing fixed yet' : 'Nothing ignored'}
            description={status === 'open' ? 'Questions the agent can’t answer well will show up here as customers ask them.' : undefined}
          />
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.gaps.map((g) => {
              const expanded = open === g.id;
              const others = g.examples.filter((e) => e.toLowerCase() !== g.question.toLowerCase());
              const before = g.min_confidence ?? g.confidence;
              return (
                <li key={g.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
                    <button type="button" onClick={() => setOpen(expanded ? null : g.id)} className="min-w-0 flex-1 basis-[320px] text-left" aria-expanded={expanded}>
                      <div className="flex items-start gap-2">
                        <ChevronDown className={`mt-0.5 h-4 w-4 shrink-0 text-slate-400 transition-transform ${expanded ? '' : '-rotate-90'}`} />
                        <div className="min-w-0">
                          <p className="text-[14px] font-semibold text-slate-900">{g.question}</p>
                          {others.length > 0 && <p className="mt-0.5 truncate text-[12px] text-slate-500">Also asked as: {others.map((e) => `“${e}”`).join(', ')}</p>}
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[12px] text-slate-500">
                            {g.reasons.map((r) => <Pill key={r} tone={REASON[r]?.tone ?? 'slate'}>{REASON[r]?.label ?? r}</Pill>)}
                            {g.reopened && <Pill tone="red">Came back after a fix</Pill>}
                            {g.in_checks && <Pill tone="blue">In checks</Pill>}
                            <span>Asked {g.times}× · last {timeAgo(g.last_asked)}{g.last_channel ? ` · ${CHANNEL[g.last_channel] ?? g.last_channel}` : ''}</span>
                          </div>
                        </div>
                      </div>
                    </button>

                    <div className="w-[190px] shrink-0">
                      {g.status === 'resolved' ? (
                        <>
                          <div className="text-[11px] text-slate-500">Confidence before → after</div>
                          <div className="mt-1 flex items-center gap-1.5">
                            <Score value={before} threshold={threshold} label="Lowest score before the fix" />
                            <span className="text-slate-300">→</span>
                            {g.retest_status === 'pending'
                              ? <span className="inline-flex items-center gap-1 text-[12px] text-slate-500"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Testing</span>
                              : <b className={`text-[13px] tabular-nums ${g.retest_confidence == null ? 'text-slate-400' : g.retest_confidence >= threshold ? 'text-emerald-700' : 'text-amber-700'}`}>{pct(g.retest_confidence)}</b>}
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="text-[11px] text-slate-500">Answer confidence</div>
                          <div className="mt-1"><Score value={g.confidence} threshold={threshold} /></div>
                          {g.retest_status === 'done' && g.retested_at && <div className="mt-0.5 text-[11px] text-slate-500">Re-tested {timeAgo(g.retested_at)}: {pct(g.retest_confidence)}</div>}
                        </>
                      )}
                    </div>

                    <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                      {g.status !== 'ignored' && (
                        <button type="button" onClick={() => setAnswering(g)} disabled={!ctx.canEdit}
                          className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-semibold disabled:opacity-50 ${g.status === 'open' ? 'bg-[#3440a8] text-white hover:bg-[#2a3490]' : 'border border-slate-200 text-slate-700 hover:bg-slate-50'}`}>
                          <PenLine className="w-3.5 h-3.5" /> {g.answer ? 'Edit answer' : 'Write answer'}
                        </button>
                      )}
                      <button type="button" title="Ask it again now and score the answer" onClick={() => act(g, 'retest')} disabled={!ctx.canEdit || busy !== null || g.retest_status === 'pending'}
                        className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-50" aria-label="Re-test">
                        {busy === `${g.id}:retest` ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                      </button>
                      <button type="button" title="Try it in the test chat" onClick={() => ctx.openTest(g.question)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Try in the test chat">
                        <MessageCircle className="w-4 h-4" />
                      </button>
                      {!g.in_checks && g.status !== 'ignored' && (
                        <button type="button" title="Add this question to your checks as it is" onClick={() => act(g, 'check')} disabled={!ctx.canEdit || busy !== null}
                          className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-50" aria-label="Add to checks">
                          {busy === `${g.id}:check` ? <Loader2 className="w-4 h-4 animate-spin" /> : <ClipboardCheck className="w-4 h-4" />}
                        </button>
                      )}
                      {g.status === 'open' ? (
                        <button type="button" title="Not something the agent should answer" onClick={() => act(g, 'ignore')} disabled={!ctx.canEdit || busy !== null}
                          className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-50" aria-label="Ignore">
                          <EyeOff className="w-4 h-4" />
                        </button>
                      ) : (
                        <button type="button" title="Put back on the list to fix" onClick={() => act(g, 'reopen')} disabled={!ctx.canEdit || busy !== null}
                          className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-50" aria-label="Reopen">
                          <RotateCcw className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  {expanded && (
                    <div className="mt-3 ml-6 grid grid-cols-1 gap-3 lg:grid-cols-2">
                      <div className="rounded-xl bg-slate-50 px-4 py-3">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">What the agent said</div>
                        <p className="mt-1 whitespace-pre-wrap text-[13px] text-slate-700">{g.last_reply || '—'}</p>
                      </div>
                      {(g.answer || g.retest_reply) && (
                        <div className="rounded-xl bg-emerald-50/60 px-4 py-3">
                          {g.answer && (
                            <>
                              <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-800">Your answer</div>
                              <p className="mt-1 whitespace-pre-wrap text-[13px] text-slate-700">{g.answer}</p>
                            </>
                          )}
                          {g.retest_reply && (
                            <>
                              <div className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-emerald-800">
                                Agent&apos;s answer when asked again{g.retested_at ? ` · ${timeAgo(g.retested_at)}` : ''}
                              </div>
                              <p className="mt-1 whitespace-pre-wrap text-[13px] text-slate-700">{g.retest_reply}</p>
                            </>
                          )}
                          <div className="mt-2 flex flex-wrap gap-3 text-[12px]">
                            {g.knowledge_source_id && <button type="button" onClick={() => goTo('knowledge')} className="font-semibold text-[#3440a8] hover:underline">In Knowledge</button>}
                            {g.in_checks && <button type="button" onClick={() => goTo('test-set')} className="font-semibold text-[#3440a8] hover:underline">In Test data › Checks</button>}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {answering && (
        <AnswerModal
          gap={answering}
          onClose={() => setAnswering(null)}
          onSaved={async () => {
            setAnswering(null);
            gooeyToast.success('Answer saved', { description: 'Added to your Knowledge and checks. Asking the question again to check the new score…' });
            setStatus('resolved');
            await load('resolved');
          }}
        />
      )}
    </div>
  );
}

function AnswerModal({ gap, onClose, onSaved }: { gap: KnowledgeGap; onClose: () => void; onSaved: () => void }) {
  const [question, setQuestion] = useState(gap.question);
  const [answer, setAnswer] = useState(gap.answer ?? '');
  const [addToKnowledge, setAddToKnowledge] = useState(true);
  const [addCheck, setAddCheck] = useState(true);
  const [saving, setSaving] = useState(false);
  const input = 'mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#3440a8]/20';

  const save = async () => {
    setSaving(true);
    try {
      await aiAgentApi.resolveGap(gap.id, { answer, question: question.trim() !== gap.question ? question : undefined, addToKnowledge, addCheck });
      onSaved();
    } catch (err) {
      notifyError(err, { where: 'KnowledgeGapsTab.resolve', title: "Couldn't save the answer" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={gap.answer ? 'Edit answer' : 'Write the answer'} maxWidth="2xl">
      <div className="space-y-4">
        <label className="block">
          <span className="text-[12px] font-semibold text-slate-700">Question</span>
          <input value={question} onChange={(e) => setQuestion(e.target.value.slice(0, 500))} className={input} />
          <span className="text-[11px] text-slate-500">As it should read in your FAQ. Customers can word it differently; the agent matches by meaning.</span>
        </label>
        {gap.last_reply && (
          <div className="rounded-lg bg-slate-50 px-3 py-2 text-[12px] text-slate-600">
            <b className="text-slate-700">The agent said:</b> {gap.last_reply}
          </div>
        )}
        <label className="block">
          <span className="text-[12px] font-semibold text-slate-700">Answer</span>
          <textarea value={answer} onChange={(e) => setAnswer(e.target.value.slice(0, 4000))} rows={6} autoFocus
            placeholder="Write it the way you'd answer a customer: the facts, any limits or costs, and what to do next."
            className={input} />
          <span className="text-[11px] text-slate-500">The agent uses this as a source and words the reply itself, in the customer&apos;s language.</span>
        </label>
        <div className="space-y-2 rounded-xl border border-slate-200 px-4 py-3">
          <label className="flex items-start gap-2.5 text-[13px] text-slate-700">
            <input type="checkbox" checked={addToKnowledge} onChange={(e) => setAddToKnowledge(e.target.checked)} className="mt-0.5" />
            <span><b>Add to Knowledge</b> <span className="text-slate-500">(FAQ &ldquo;Answers from knowledge gaps&rdquo;): this is what lets the agent answer it next time.</span></span>
          </label>
          <label className="flex items-start gap-2.5 text-[13px] text-slate-700">
            <input type="checkbox" checked={addCheck} onChange={(e) => setAddCheck(e.target.checked)} className="mt-0.5" />
            <span><b>Add to checks</b> <span className="text-slate-500">(Test data): every test run makes sure it&apos;s still answered like this.</span></span>
          </label>
          {!addToKnowledge && addCheck && <p className="text-[12px] text-amber-700">Without adding it to Knowledge, customers still won&apos;t get this answer unless another source has it.</p>}
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-[13px] font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
          <button type="button" onClick={save} disabled={saving || !answer.trim() || !question.trim() || (!addToKnowledge && !addCheck)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#3440a8] px-4 py-2 text-[13px] font-semibold text-white hover:bg-[#2a3490] disabled:opacity-50">
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Save and re-test
          </button>
        </div>
      </div>
    </Modal>
  );
}
