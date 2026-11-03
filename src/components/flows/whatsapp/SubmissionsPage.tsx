'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Inbox, X } from 'lucide-react';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { flowsApi, type FlowListItem, type FlowSubmission } from './wa-api';
import { Pagination, StatusBadge, formatDate, formatValue, iconBtn, inputCls } from './wa-ui';

const PAGE_SIZE = 25;

export function SubmissionsPage({ flowFilter, onOpenFlow }: { flowFilter?: number; onOpenFlow: (id: number) => void }) {
  const [flowId, setFlowId] = useState<number | ''>(flowFilter ?? '');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [flows, setFlows] = useState<FlowListItem[]>([]);
  const [data, setData] = useState<{ items: FlowSubmission[]; total: number } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [selected, setSelected] = useState<FlowSubmission | null>(null);

  useEffect(() => {
    flowsApi.list({ pageSize: 100 }).then((r) => setFlows(r.items)).catch(() => setFlows([]));
  }, []);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await flowsApi.submissions({ flowId: flowId || undefined, status: status || undefined, page, pageSize: PAGE_SIZE });
      setData({ items: res.items, total: res.total });
    } catch (err) {
      setError(err);
    }
  }, [flowId, status, page]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="p-5 space-y-4 max-w-[1300px] mx-auto">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-[16px] font-bold text-slate-800">Flow submissions</h1>
          <p className="text-[11px] text-slate-500">Responses customers submitted from WhatsApp Flows.</p>
        </div>
        <div className="flex-1" />
        <select value={flowId} onChange={(e) => { setFlowId(e.target.value ? Number(e.target.value) : ''); setPage(1); }} className={`${inputCls} w-auto max-w-[220px]`}>
          <option value="">All flows</option>
          {flows.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className={`${inputCls} w-auto`}>
          <option value="">All statuses</option>
          <option value="processed">Processed</option>
          <option value="received">Received</option>
          <option value="unmatched">Unmatched</option>
          <option value="failed">Failed</option>
        </select>
      </div>

      <div className="flex gap-4 items-start">
        <div className="flex-1 min-w-0 bg-white border border-slate-200 rounded-xl overflow-hidden">
          {error ? (
            <ErrorState error={error} title="Couldn't load submissions" onRetry={load} />
          ) : !data ? (
            <LoadingState label="Loading submissions…" />
          ) : data.items.length === 0 ? (
            <EmptyState icon={<Inbox className="w-9 h-9 text-slate-300" />} title="No submissions yet" description="Responses appear here as soon as customers complete a Flow." />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wider text-slate-400 border-b border-slate-100">
                      <th className="px-4 py-2.5 font-semibold">Customer</th>
                      <th className="px-3 py-2.5 font-semibold">Flow</th>
                      <th className="px-3 py-2.5 font-semibold">Submitted</th>
                      <th className="px-3 py-2.5 font-semibold">Status</th>
                      <th className="px-3 py-2.5 font-semibold">Answers</th>
                      <th className="px-3 py-2.5 font-semibold">Via</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((s) => (
                      <tr
                        key={s.id}
                        onClick={() => setSelected(s)}
                        className={`border-b border-slate-50 cursor-pointer ${selected?.id === s.id ? 'bg-[#3440a8]/[0.04]' : 'hover:bg-slate-50/60'}`}
                      >
                        <td className="px-4 py-2.5">
                          <div className="font-semibold text-slate-800">{s.customerName ?? 'Unknown'}</div>
                          <div className="text-[10px] text-slate-400">{s.customerPhone ? `+${s.customerPhone}` : ''}</div>
                        </td>
                        <td className="px-3 py-2.5">
                          {s.flowName ?? <span className="text-slate-400">Not matched</span>}
                          {s.versionNumber && <span className="text-[10px] text-slate-400"> · v{s.versionNumber}</span>}
                        </td>
                        <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap">{formatDate(s.submittedAt)}</td>
                        <td className="px-3 py-2.5"><StatusBadge status={s.processingStatus} /></td>
                        <td className="px-3 py-2.5 text-slate-500 max-w-[260px] truncate">
                          {Object.entries(s.response).slice(0, 3).map(([k, v]) => `${k}: ${formatValue(v)}`).join(' · ')}
                        </td>
                        <td className="px-3 py-2.5 text-[11px] text-slate-500">
                          {s.automationRunId ? 'Automation' : s.templateName ? `Template ${s.templateName}` : s.executionId ? 'Direct send' : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination page={page} pageSize={PAGE_SIZE} total={data.total} onPage={setPage} />
            </>
          )}
        </div>

        {selected && (
          <aside className="w-80 shrink-0 bg-white border border-slate-200 rounded-xl overflow-hidden hidden md:block">
            <header className="px-4 py-3 border-b border-slate-100 flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-bold text-slate-800 truncate">{selected.customerName ?? 'Unknown customer'}</p>
                <p className="text-[10px] text-slate-400">{formatDate(selected.submittedAt)}</p>
              </div>
              <button className={iconBtn} onClick={() => setSelected(null)}><X className="w-4 h-4" /></button>
            </header>
            <div className="px-4 py-3 space-y-3 text-[12px]">
              <dl className="space-y-2">
                {Object.entries(selected.response).length === 0 && <p className="text-slate-400">No answers in this response.</p>}
                {Object.entries(selected.response).map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-[10px] font-mono text-slate-400">{k}</dt>
                    <dd className="text-slate-800 break-words">{formatValue(v)}</dd>
                  </div>
                ))}
              </dl>
              <div className="border-t border-slate-100 pt-3 space-y-1 text-[11px] text-slate-500">
                <p>Status: <StatusBadge status={selected.processingStatus} /></p>
                {selected.flowId && (
                  <p>Flow: <button className="text-[#3440a8] hover:underline" onClick={() => onOpenFlow(selected.flowId!)}>{selected.flowName}</button> {selected.versionNumber ? `(v${selected.versionNumber})` : ''}</p>
                )}
                {selected.templateName && <p>Template: {selected.templateName}</p>}
                {selected.automationRunId && <p>Automation run #{selected.automationRunId}{selected.automationNodeId ? ` · step ${selected.automationNodeId}` : ''}</p>}
                {selected.lastError && <p className="text-red-500">{selected.lastError}</p>}
              </div>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
