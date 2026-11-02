'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { X, ArrowLeft, RefreshCw, History, Hourglass, AlertTriangle, CheckCircle2, CircleDot } from 'lucide-react';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { StatusBadge, Pagination, formatDate, formatValue, iconBtn, inputCls } from '../whatsapp/wa-ui';
import { automationsApi, NODE_TYPE_LABELS, type AutomationListItem, type AutomationRun } from './automation-api';

const PAGE_SIZE = 20;

/** Slide-over with an automation's execution history and the details of one execution. */
export function AutomationRunsDrawer({ automation, onClose }: { automation: AutomationListItem; onClose: () => void }) {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ items: AutomationRun[]; total: number } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [selected, setSelected] = useState<AutomationRun | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    setRefreshing(true);
    try {
      const res = await automationsApi.runs(automation.id, { status: status || undefined, page, pageSize: PAGE_SIZE });
      setData({ items: res.items, total: res.total });
    } catch (err) {
      setError(err);
    } finally {
      setRefreshing(false);
    }
  }, [automation.id, status, page]);

  useEffect(() => { load(); }, [load]);

  // Details are re-fetched so a waiting run shows its latest state
  const openRun = async (r: AutomationRun) => {
    setSelected(r);
    try {
      setSelected(await automationsApi.run(automation.id, r.id));
    } catch { /* keep the list copy */ }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-slate-900/20" onClick={onClose} />
      <aside className="relative w-full max-w-[560px] h-full bg-white shadow-2xl flex flex-col">
        <header className="px-4 py-3 border-b border-slate-100 flex items-center gap-2 shrink-0">
          {selected ? (
            <button className={iconBtn} onClick={() => setSelected(null)} title="Back to history"><ArrowLeft className="w-4 h-4" /></button>
          ) : (
            <History className="w-4 h-4 text-[#3440a8]" />
          )}
          <div className="flex-1 min-w-0">
            <h2 className="text-[13px] font-bold text-slate-800 truncate">
              {selected ? `Execution #${selected.id}` : 'Execution history'}
            </h2>
            <p className="text-[10px] text-slate-400 truncate">{automation.name}</p>
          </div>
          {!selected && (
            <button className={iconBtn} onClick={load} title="Refresh" disabled={refreshing}>
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            </button>
          )}
          <button className={iconBtn} onClick={onClose} title="Close"><X className="w-4 h-4" /></button>
        </header>

        {selected ? (
          <RunDetails run={selected} />
        ) : (
          <>
            <div className="px-4 py-2.5 border-b border-slate-100 shrink-0">
              <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className={`${inputCls} w-auto`}>
                <option value="">All executions</option>
                <option value="completed">Completed</option>
                <option value="failed">Failed</option>
                <option value="waiting">Waiting</option>
                <option value="running">Running</option>
                <option value="timed_out">Timed out</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
            <div className="flex-1 overflow-y-auto">
              {error ? (
                <ErrorState error={error} title="Couldn't load executions" onRetry={load} compact />
              ) : !data ? (
                <LoadingState label="Loading executions…" />
              ) : data.items.length === 0 ? (
                <EmptyState compact title={status ? 'No executions with this status' : 'No executions yet'} description="Executions appear when the trigger matches an incoming message while the automation is active." />
              ) : (
                <ul className="divide-y divide-slate-50">
                  {data.items.map((r) => (
                    <li key={r.id}>
                      <button className="w-full text-left px-4 py-2.5 hover:bg-slate-50 flex items-start gap-3" onClick={() => openRun(r)}>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-[12px] font-semibold text-slate-700">#{r.id}</span>
                            <span className="text-[12px] text-slate-600 truncate">{r.customerName ?? `Contact #${r.customerId}`}</span>
                          </div>
                          <p className="text-[10px] text-slate-400 truncate">
                            {formatDate(r.createdAt)} · {r.context.log?.length ?? 0} steps
                            {r.context.trigger?.text ? ` · “${r.context.trigger.text}”` : ''}
                          </p>
                          {r.lastError && <p className="text-[10px] text-red-500 truncate">{r.lastError}</p>}
                        </div>
                        <StatusBadge status={r.status} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {data && <Pagination page={page} pageSize={PAGE_SIZE} total={data.total} onPage={setPage} />}
          </>
        )}
      </aside>
    </div>
  );
}

function RunDetails({ run }: { run: AutomationRun }) {
  const steps = run.context.log ?? [];
  const flowAnswers = run.context.flow ? Object.entries(run.context.flow) : [];

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5 text-[12px]">
      <div className="grid grid-cols-2 gap-3">
        {[
          ['Status', <StatusBadge key="s" status={run.status} />],
          ['Contact', `${run.customerName ?? `#${run.customerId}`}${run.customerPhone ? ` (+${run.customerPhone})` : ''}`],
          ['Started', formatDate(run.createdAt)],
          ['Finished', formatDate(run.completedAt)],
          ['Trigger', NODE_TYPE_LABELS[run.context.trigger?.type] ?? run.context.trigger?.type ?? '—'],
          ['Steps executed', String(run.stepCount)],
        ].map(([label, value]) => (
          <div key={String(label)}>
            <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-400">{label}</p>
            <div className="text-slate-700 break-words">{value}</div>
          </div>
        ))}
      </div>

      {run.context.trigger?.text && (
        <div>
          <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-400 mb-1">Triggering message</p>
          <p className="bg-slate-50 border border-slate-100 rounded-lg px-3 py-2 text-slate-700">{run.context.trigger.text}</p>
        </div>
      )}

      {run.status === 'waiting' && run.waitingFor && (
        <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-blue-800">
          <Hourglass className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>
            {run.waitingFor.kind === 'flow_submission' ? 'Waiting for the customer to submit the WhatsApp Flow' : 'Waiting for a delay to end'}
            {run.wakeAt ? ` — until ${formatDate(run.wakeAt)}` : ''}.
          </span>
        </div>
      )}

      {run.lastError && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-red-700">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>{run.lastError}{run.currentNodeId ? ` (at step ${run.currentNodeId})` : ''}</span>
        </div>
      )}

      <div>
        <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-400 mb-2">Steps</p>
        {steps.length === 0 ? (
          <p className="text-slate-400">No steps recorded.</p>
        ) : (
          <ol className="space-y-1.5">
            {steps.map((s, i) => {
              const failed = run.status === 'failed' && i === steps.length - 1 && s.outcome !== 'done';
              const Icon = s.outcome === 'waiting' ? Hourglass : failed ? AlertTriangle : s.outcome === 'done' ? CheckCircle2 : CircleDot;
              return (
                <li key={`${s.nodeId}-${i}`} className="flex items-start gap-2">
                  <Icon className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${s.outcome === 'waiting' ? 'text-blue-500' : s.outcome === 'done' ? 'text-emerald-500' : 'text-slate-400'}`} />
                  <div className="flex-1 min-w-0">
                    <span className="font-medium text-slate-700">{NODE_TYPE_LABELS[s.type] ?? s.type}</span>
                    <span className="text-slate-400"> · {s.outcome}</span>
                  </div>
                  <span className="text-[10px] text-slate-400 whitespace-nowrap">{new Date(s.at).toLocaleTimeString()}</span>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      {flowAnswers.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-400 mb-2">WhatsApp Flow answers</p>
          <dl className="bg-slate-50 border border-slate-100 rounded-lg px-3 py-2 space-y-1.5">
            {flowAnswers.map(([k, v]) => (
              <div key={k} className="flex gap-2">
                <dt className="font-mono text-[10px] text-slate-400 w-32 shrink-0 truncate">{k}</dt>
                <dd className="text-slate-700 break-words">{formatValue(v)}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}
