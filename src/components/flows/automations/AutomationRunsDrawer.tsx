'use client';

import React, { useEffect, useState } from 'react';
import { X, ArrowLeft, RefreshCw, History, Hourglass, AlertTriangle, CheckCircle2, CircleDot } from 'lucide-react';
import { EmptyState } from '@/components/ui/states';
import { DataTable, createColumnHelper, useServerTable, type FilterDef } from '@/components/ui/data-table';
import { StatusBadge, formatDate, formatValue, iconBtn } from '../whatsapp/wa-ui';
import { automationsApi, NODE_TYPE_LABELS, type AutomationListItem, type AutomationRun } from './automation-api';

const col = createColumnHelper<AutomationRun>();

const FILTERS: FilterDef[] = [
  {
    type: 'select',
    key: 'status',
    label: 'Status',
    allLabel: 'All',
    options: [
      { value: 'completed', label: 'Completed' },
      { value: 'failed', label: 'Failed' },
      { value: 'waiting', label: 'Waiting' },
      { value: 'running', label: 'Running' },
      { value: 'timed_out', label: 'Timed out' },
      { value: 'cancelled', label: 'Cancelled' },
    ],
  },
  { type: 'dateRange', key: 'startedAt', label: 'Started' },
];

const COLUMNS = [
  col.accessor('id', {
    header: 'Execution',
    cell: ({ row: { original: r } }) => (
      <div className="min-w-0 max-w-[200px]">
        <span className="font-semibold text-slate-700">#{r.id}</span>
        <p className="text-[10px] text-slate-400 truncate">
          {r.context.log?.length ?? 0} steps{r.context.trigger?.text ? ` · “${r.context.trigger.text}”` : ''}
        </p>
        {r.lastError && <p className="text-[10px] text-red-500 truncate">{r.lastError}</p>}
      </div>
    ),
  }),
  col.accessor((r) => r.customerName ?? null, {
    id: 'customer',
    header: 'Contact',
    enableSorting: true,
    cell: ({ row: { original: r } }) => <span className="text-slate-600">{r.customerName ?? `Contact #${r.customerId}`}</span>,
  }),
  col.accessor('createdAt', {
    header: 'Started',
    enableSorting: true,
    sortDescFirst: true,
    meta: { className: 'text-slate-500 whitespace-nowrap' },
    cell: ({ getValue }) => formatDate(getValue()),
  }),
  col.accessor('status', {
    header: 'Status',
    enableSorting: true,
    meta: { align: 'right' },
    cell: ({ getValue }) => <StatusBadge status={getValue()} />,
  }),
];

/** Slide-over with an automation's execution history and the details of one execution. */
export function AutomationRunsDrawer({ automation, onClose }: { automation: AutomationListItem; onClose: () => void }) {
  const [selected, setSelected] = useState<AutomationRun | null>(null);
  const table = useServerTable<AutomationRun>({
    fetcher: (query) => automationsApi.runs(automation.id, query),
    filters: FILTERS,
    defaultSort: { sortBy: 'createdAt', sortOrder: 'desc' },
  });

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
      <aside className="relative w-full max-w-[640px] h-full bg-white shadow-2xl flex flex-col">
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
            <button className={iconBtn} onClick={table.reload} title="Refresh" disabled={table.loading}>
              <RefreshCw className={`w-3.5 h-3.5 ${table.loading ? 'animate-spin' : ''}`} />
            </button>
          )}
          <button className={iconBtn} onClick={onClose} title="Close"><X className="w-4 h-4" /></button>
        </header>

        {selected ? (
          <RunDetails run={selected} />
        ) : (
          <div className="flex-1 overflow-y-auto p-4 bg-[#f8fafc]">
            <DataTable
              {...table.tableProps}
              columns={COLUMNS}
              getRowId={(r) => r.id}
              onRowClick={openRun}
              errorTitle="Couldn't load executions"
              loadingLabel="Loading executions…"
              emptyState={(filtered) => (
                <EmptyState
                  compact
                  title={filtered ? 'No executions match these filters' : 'No executions yet'}
                  description="Executions appear when the trigger matches an incoming message while the automation is active."
                />
              )}
            />
          </div>
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
