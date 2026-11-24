'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Play, Plus, Trash2 } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { ErrorState } from '@/components/ui/states';
import { notifyError } from '@/lib/api/notify';
import { gooeyToast } from '@/components/ui/goey-toaster';
import { TEST_CASE_CSV_HEADER } from '@/lib/ai-agent/csv';
import { aiAgentApi, type KnowledgeStats, type SampleData, type TestCase, type TestCategory, type TestRun } from './api';
import { SampleDataPanel } from './SampleDataPanel';
import { Card, Pill, Select, Skeleton } from './ui';
import { UploadMenu, readTextFile, type UploadFormat } from './UploadMenu';
import type { AgentContext } from './AiAgentView';

const CATEGORIES: TestCategory[] = ['Policy & FAQ', 'Order status', 'Shopping', 'Safety', 'Handover', 'Languages'];
const PASS_MARK = 0.85;

const SOURCE_LABEL: Record<string, string> = { sample_orders: 'From sample orders', sample_products: 'From sample products', knowledge_gap: 'From knowledge gaps' };

/**
 * Test data: sample orders and products (plus the agent's Knowledge for help and FAQ) to try the agent without real
 * customers or a live store, and the checks made from them that score the agent after every change.
 */
export function TestSetTab({ ctx, goTo }: { ctx: AgentContext; goTo: (tab: 'knowledge') => void }) {
  const [sample, setSample] = useState<SampleData | null>(null);
  const [knowledge, setKnowledge] = useState<KnowledgeStats | null>(null);
  const [cases, setCases] = useState<TestCase[] | null>(null);
  const [run, setRun] = useState<TestRun | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [filter, setFilter] = useState<TestCategory | 'all'>('all');
  const [starting, setStarting] = useState(false);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);

  const load = useCallback(async () => {
    try {
      const [c, r] = await Promise.all([aiAgentApi.testCases(), aiAgentApi.latestRun()]);
      setCases(c);
      setRun(r);
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    aiAgentApi.sampleData().then(setSample, (err) => notifyError(err, { where: 'TestSetTab.sample', title: "Couldn't load the sample data" }));
    aiAgentApi.knowledge().then((k) => setKnowledge(k.stats), () => undefined);
  }, []);

  const running = run?.status === 'running';
  useEffect(() => {
    if (!running) return;
    const t = setInterval(async () => {
      try {
        const r = await aiAgentApi.latestRun();
        setRun(r);
        if (r?.status === 'done') gooeyToast.success('Test run finished', { description: `${r.passed} of ${r.total} passed.` });
      } catch { /* keep polling */ }
    }, 2500);
    return () => clearInterval(t);
  }, [running]);

  const results = useMemo(() => new Map((run?.results ?? []).map((r) => [r.case_id, r])), [run]);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of cases ?? []) m.set(c.category, (m.get(c.category) ?? 0) + 1);
    return m;
  }, [cases]);
  const shown = (cases ?? []).filter((c) => filter === 'all' || c.category === filter);
  const failed = (cases ?? []).filter((c) => results.get(c.id) && !results.get(c.id)!.passed);

  const start = async () => {
    setStarting(true);
    try {
      await aiAgentApi.startRun();
      setRun(await aiAgentApi.latestRun());
    } catch (err) {
      notifyError(err, { where: 'TestSetTab.start', title: "Couldn't start the test run" });
    } finally {
      setStarting(false);
    }
  };

  const importFile = async (file: File, format: UploadFormat) => {
    setImporting(true);
    try {
      const text = await readTextFile(file);
      const r = await aiAgentApi.addTestCases(format === 'json' ? { json: text } : { csv: text });
      const n = r.created.length;
      gooeyToast.success(
        r.kind === 'orders' ? `${n} order-status test${n === 1 ? '' : 's'} created from your orders` : `${n} test case${n === 1 ? '' : 's'} imported`,
        r.skipped ? { description: `${r.skipped} row${r.skipped === 1 ? '' : 's'} skipped (no question or order number).` } : undefined,
      );
      await load();
    } catch (err) {
      notifyError(err, { where: 'TestSetTab.import', title: `Couldn't import the ${format.toUpperCase()} file` });
    } finally {
      setImporting(false);
    }
  };

  const remove = async (c: TestCase) => {
    try {
      await aiAgentApi.deleteTestCase(c.id);
      setCases((list) => (list ?? []).filter((x) => x.id !== c.id));
    } catch (err) {
      notifyError(err, { where: 'TestSetTab.remove', title: "Couldn't delete the check" });
    }
  };

  if (error) return <ErrorState error={error} title="Couldn't load the test data" onRetry={load} />;

  const rate = run && run.total ? run.passed / run.total : null;
  const done = run ? run.passed + run.failed : 0;

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div>
          <h2 className="text-[17px] font-bold text-slate-900">Sample data</h2>
          <p className="text-[13px] text-slate-500">Try the agent without real customers or a live store. The test chat and the widget preview can answer from this data.</p>
        </div>
        <SampleDataPanel
          sample={sample}
          knowledge={knowledge}
          canEdit={ctx.canEdit}
          onChange={setSample}
          onChecksChanged={load}
          onTry={(ref) => ctx.openTest(undefined, ref)}
          onOpenKnowledge={() => goTo('knowledge')}
        />
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-[17px] font-bold text-slate-900">Checks</h2>
          <p className="text-[13px] text-slate-500">
            Questions the agent must answer well, made automatically from your sample data. Run them after every change to see whether the agent got better or worse.
          </p>
        </div>
      <div className="bg-white rounded-2xl border border-slate-200 px-6 py-5 flex flex-wrap items-center gap-x-10 gap-y-4">
        <Summary label="Last run" value={run ? new Date(run.started_at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : 'Never'} />
        <Summary label="Checks" value={String(cases?.length ?? '—')} />
        <Summary
          label={<>Passed <span className="text-slate-400">(pass mark {Math.round(PASS_MARK * 100)}%)</span></>}
          value={run ? `${run.passed} · ${rate == null ? '—' : `${Math.round(rate * 100)}%`}` : '—'}
          tone={rate == null ? 'slate' : rate >= PASS_MARK ? 'green' : 'amber'}
        />
        <Summary label="Failed" value={run ? String(run.failed) : '—'} tone={run && run.failed ? 'red' : 'slate'} />
        <Summary label="Handover correct" value={run && run.handover_total ? `${run.handover_correct} / ${run.handover_total}` : '—'} tone={run && run.handover_total && run.handover_correct === run.handover_total ? 'green' : 'slate'} />
        <button
          onClick={start}
          disabled={!ctx.canEdit || starting || running || !cases?.length}
          className="ml-auto inline-flex items-center gap-2 rounded-xl bg-[#3440a8] hover:bg-[#2a3490] px-5 py-3 text-[14px] font-semibold text-white disabled:opacity-50"
        >
          {running ? <><Loader2 className="w-4 h-4 animate-spin" /> Running {done} / {run?.total}</> : <><Play className="w-4 h-4" /> Run all {cases?.length ?? ''} checks</>}
        </button>
      </div>
      {run?.status === 'error' && <p className="text-[13px] text-red-600">The last run stopped early: {run.error}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <Chip active={filter === 'all'} onClick={() => setFilter('all')}>All {cases?.length ?? 0}</Chip>
        {CATEGORIES.filter((c) => counts.get(c)).map((c) => (
          <Chip key={c} active={filter === c} onClick={() => setFilter(c)}>{c} {counts.get(c)}</Chip>
        ))}
        <div className="ml-auto flex gap-2">
          <UploadMenu label="Upload checks" disabled={!ctx.canEdit} busy={importing} onFile={importFile} />
          <button onClick={() => setAdding(true)} disabled={!ctx.canEdit} className="inline-flex items-center gap-1.5 rounded-xl bg-[#3440a8] hover:bg-[#2a3490] px-4 py-2.5 text-[13px] font-semibold text-white disabled:opacity-50">
            <Plus className="w-4 h-4" /> Add check
          </button>
        </div>
      </div>

      <Card bodyClassName="p-0">
        {!cases ? <div className="p-5 space-y-3">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-10" />)}</div> : cases.length === 0 ? (
          <div className="p-6 text-[13px] text-slate-500">
            No checks yet. Upload sample orders or products above and checks are created from them automatically.
            You can also add your own (<b>Add check</b>), or <b>Upload checks</b> as CSV or JSON: a{' '}
            <code className="text-[12px] bg-slate-100 px-1 rounded">question</code> column is enough (all columns:{' '}
            <code className="text-[12px] bg-slate-100 px-1 rounded">{TEST_CASE_CSV_HEADER}</code>).
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <th className="px-5 py-3 w-[22%]">Question</th>
                  <th className="px-3 py-3 w-[22%]">Expected</th>
                  <th className="px-3 py-3">Agent answer</th>
                  <th className="px-3 py-3">Category</th>
                  <th className="px-3 py-3">Result</th>
                  <th className="px-3 py-3 w-10" />
                </tr>
              </thead>
              <tbody>
                {shown.map((c) => {
                  const r = results.get(c.id);
                  return (
                    <tr key={c.id} className="border-t border-slate-100 align-top">
                      <td className="px-5 py-3 text-slate-800"><div className="line-clamp-2" title={c.question}>{c.question}</div></td>
                      <td className="px-3 py-3 text-slate-600"><div className="line-clamp-2" title={expectedText(c)}>{expectedText(c)}</div></td>
                      <td className="px-3 py-3">
                        {!r ? <span className="text-slate-400">{running ? 'Waiting…' : 'Not run yet'}</span> : (
                          <>
                            <div className={`line-clamp-2 ${r.passed ? 'text-slate-700' : 'text-red-600'}`} title={r.reply}>
                              {r.outcome === 'handover' ? `Handed over${r.handover_reason ? ` · ${r.handover_reason.replace(/_/g, ' ')}` : ''}` : `"${r.reply}"`}
                            </div>
                            {!r.passed && r.reasons.length > 0 && <div className="text-[12px] italic text-slate-500">{r.reasons.join('; ')}</div>}
                          </>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap gap-1">
                          <Pill tone="slate">{c.category}</Pill>
                          {c.source && SOURCE_LABEL[c.source] ? <Pill tone="blue">{SOURCE_LABEL[c.source]}</Pill> : c.commerce ? <Pill tone="blue">Uploaded orders</Pill> : null}
                        </div>
                      </td>
                      <td className="px-3 py-3">{!r ? <Pill tone="slate">—</Pill> : r.passed ? <Pill tone="green" dot>Pass</Pill> : <Pill tone="red" dot>Fail</Pill>}</td>
                      <td className="px-3 py-3">
                        {ctx.canEdit && (
                          <button aria-label="Delete test case" onClick={() => remove(c)} className="p-1.5 rounded-lg text-slate-300 hover:text-red-600 hover:bg-red-50"><Trash2 className="w-4 h-4" /></button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {!!cases?.length && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-5 py-3 text-[13px]">
            <span className="text-slate-500">Showing {shown.length} of {cases.length}</span>
            {failed.length > 0 && (
              <button onClick={() => ctx.openTest(failed[0].question)} className="font-semibold text-[#3440a8] hover:underline">
                Try the first failed question in the test chat →
              </button>
            )}
          </div>
        )}
      </Card>
      </section>

      {adding && <AddCaseModal onClose={() => setAdding(false)} onSaved={async () => { setAdding(false); await load(); }} />}
    </div>
  );
}

function expectedText(c: TestCase) {
  const parts = [c.expected];
  if (!c.expected) {
    if (c.expect_outcome === 'handover') parts.push('Hand over');
    if (c.expect_outcome === 'refuse') parts.push('Refuse politely');
    if (c.must_include.length) parts.push(`Mentions ${c.must_include.join(', ')}`);
  }
  if (c.language) parts.push(`Reply in ${c.language}`);
  return parts.filter(Boolean).join('; ') || 'Any answer';
}

function Summary({ label, value, tone = 'slate' }: { label: React.ReactNode; value: string; tone?: 'green' | 'red' | 'amber' | 'slate' }) {
  const cls = { green: 'text-emerald-700', red: 'text-red-600', amber: 'text-amber-700', slate: 'text-slate-900' }[tone];
  return (
    <div>
      <div className="text-[12px] text-slate-500">{label}</div>
      <div className={`text-[24px] font-bold tabular-nums ${cls}`}>{value}</div>
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`rounded-full px-4 py-2 text-[13px] font-medium transition-colors ${active ? 'bg-[#3440a8] text-white' : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'}`}>
      {children}
    </button>
  );
}

function AddCaseModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState({
    question: '', expected: '', category: 'Policy & FAQ' as TestCategory, expectOutcome: 'answered',
    mustInclude: '', mustNotInclude: '', language: '', customerId: '', customerPhone: '',
  });
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const input = 'mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#3440a8]/20';

  const save = async () => {
    setSaving(true);
    try {
      await aiAgentApi.addTestCases({
        cases: [{
          question: form.question,
          expected: form.expected,
          category: form.category,
          expectOutcome: form.expectOutcome,
          mustInclude: form.mustInclude,
          mustNotInclude: form.mustNotInclude,
          language: form.language,
          asUser: { id: form.customerId, phone: form.customerPhone },
        }],
      });
      gooeyToast.success('Check added');
      await onSaved();
    } catch (err) {
      notifyError(err, { where: 'TestSetTab.add', title: "Couldn't add the test case" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title="Add check" maxWidth="2xl">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label className="sm:col-span-2 block">
          <span className="text-[12px] font-semibold text-slate-700">Customer question</span>
          <input value={form.question} onChange={(e) => set({ question: e.target.value })} placeholder="What is your return policy?" className={input} />
        </label>
        <label className="sm:col-span-2 block">
          <span className="text-[12px] font-semibold text-slate-700">What a good answer does</span>
          <input value={form.expected} onChange={(e) => set({ expected: e.target.value })} placeholder="Mentions 7-day exchange; no refunds on sale items" className={input} />
          <span className="text-[11px] text-slate-500">Checked by an AI grader when no required phrases are given.</span>
        </label>
        <label className="block">
          <span className="text-[12px] font-semibold text-slate-700">Category</span>
          <Select label="Category" className="mt-1" value={form.category} onChange={(v) => set({ category: v, expectOutcome: v === 'Handover' ? 'handover' : v === 'Safety' ? 'refuse' : form.expectOutcome })}
            options={CATEGORIES.map((c) => ({ value: c, label: c }))} />
        </label>
        <label className="block">
          <span className="text-[12px] font-semibold text-slate-700">Expected outcome</span>
          <Select label="Expected outcome" className="mt-1" value={form.expectOutcome} onChange={(v) => set({ expectOutcome: v })}
            options={[{ value: 'answered', label: 'Answers' }, { value: 'handover', label: 'Hands over' }, { value: 'refuse', label: 'Refuses politely' }, { value: 'any', label: 'Any' }]} />
        </label>
        <label className="block">
          <span className="text-[12px] font-semibold text-slate-700">Must include <span className="font-normal text-slate-400">(; separated, | for either)</span></span>
          <input value={form.mustInclude} onChange={(e) => set({ mustInclude: e.target.value })} placeholder="7 days|seven days; exchange" className={input} />
        </label>
        <label className="block">
          <span className="text-[12px] font-semibold text-slate-700">Must not include</span>
          <input value={form.mustNotInclude} onChange={(e) => set({ mustNotInclude: e.target.value })} placeholder="refund" className={input} />
        </label>
        <label className="block">
          <span className="text-[12px] font-semibold text-slate-700">Reply language <span className="font-normal text-slate-400">(optional)</span></span>
          <input value={form.language} onChange={(e) => set({ language: e.target.value })} placeholder="Tamil" className={input} />
        </label>
        <label className="block">
          <span className="text-[12px] font-semibold text-slate-700">Test as customer <span className="font-normal text-slate-400">(id or phone, for orders)</span></span>
          <div className="flex gap-2">
            <input value={form.customerId} onChange={(e) => set({ customerId: e.target.value })} placeholder="Customer id" className={input} />
            <input value={form.customerPhone} onChange={(e) => set({ customerPhone: e.target.value })} placeholder="+91…" className={input} />
          </div>
        </label>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-2 text-[13px] font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
        <button onClick={save} disabled={saving || !form.question.trim()} className="inline-flex items-center gap-1.5 rounded-lg bg-[#3440a8] px-4 py-2 text-[13px] font-semibold text-white hover:bg-[#2a3490] disabled:opacity-50">
          {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Add check
        </button>
      </div>
    </Modal>
  );
}
