'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Inbox, X } from 'lucide-react';
import { EmptyState } from '@/components/ui/states';
import { DataTable, TableFilters, createColumnHelper, useServerTable, type FilterDef } from '@/components/ui/data-table';
import { flowsApi, type FlowOption, type FlowSubmission } from './wa-api';
import { StatusBadge, formatDate, iconBtn } from './wa-ui';

const col = createColumnHelper<FlowSubmission>();

const STATUS_OPTIONS = [
  { value: 'processed', label: 'Processed' },
  { value: 'received', label: 'Received' },
  { value: 'unmatched', label: 'Unmatched' },
  { value: 'failed', label: 'Failed' },
];

export function SubmissionsPage({ flowFilter, onOpenFlow }: { flowFilter?: number; onOpenFlow: (id: number) => void }) {
  const [flows, setFlows] = useState<FlowOption[]>([]);
  const [selected, setSelected] = useState<FlowSubmission | null>(null);

  useEffect(() => {
    flowsApi.options().then(setFlows).catch(() => setFlows([]));
  }, []);

  const filters = useMemo<FilterDef[]>(() => [
    {
      type: 'select',
      key: 'flowId',
      label: 'Flow',
      allLabel: 'All flows',
      options: flows.map((f) => ({ value: String(f.id), label: f.status === 'archived' ? `${f.name} (archived)` : f.name })),
    },
    { type: 'select', key: 'status', label: 'Status', allLabel: 'All', options: STATUS_OPTIONS },
    { type: 'dateRange', key: 'submittedAt', label: 'Submitted' },
  ], [flows]);

  const table = useServerTable<FlowSubmission>({
    fetcher: flowsApi.submissions,
    filters,
    initialFilters: flowFilter ? { flowId: String(flowFilter) } : undefined,
    defaultSort: { sortBy: 'submittedAt', sortOrder: 'desc' },
  });

  const columns = [
    col.accessor((r) => r.customerName ?? null, {
      id: 'customer',
      header: 'Customer',
      enableSorting: true,
      cell: ({ row: { original: r } }) => (
        <>
          <div className="font-semibold text-slate-800">{r.customerName ?? 'Unknown'}</div>
          <div className="text-[10px] text-slate-400">{r.customerPhone ? `+${r.customerPhone}` : ''}</div>
        </>
      ),
    }),
    col.accessor((r) => r.flowName ?? null, {
      id: 'flow',
      header: 'Flow',
      enableSorting: true,
      cell: ({ row: { original: r } }) => (
        <>
          {r.flowName ?? <span className="text-slate-400">Not matched</span>}
          {r.versionNumber && <span className="text-[10px] text-slate-400"> · v{r.versionNumber}</span>}
        </>
      ),
    }),
    col.accessor('submittedAt', {
      header: 'Submitted',
      enableSorting: true,
      sortDescFirst: true,
      meta: { className: 'text-slate-500 whitespace-nowrap' },
      cell: ({ getValue }) => formatDate(getValue()),
    }),
    col.accessor('processingStatus', {
      id: 'status',
      header: 'Status',
      enableSorting: true,
      cell: ({ getValue }) => <StatusBadge status={getValue()} />,
    }),
    col.display({
      id: 'answers',
      header: 'Answers',
      meta: { className: 'text-slate-500 max-w-[260px] truncate' },
      cell: ({ row: { original: r } }) => (r.answers ?? []).slice(0, 3).map((a) => `${a.label}: ${a.value}`).join(' · '),
    }),
    col.display({
      id: 'via',
      header: 'Via',
      meta: { className: 'text-[11px] text-slate-500' },
      cell: ({ row: { original: r } }) => (r.automationRunId ? 'Automation' : r.templateName ? `Template ${r.templateName}` : r.executionId ? 'Direct send' : '—'),
    }),
  ];

  return (
    <div className="p-5 space-y-4 max-w-[1300px] mx-auto">
      <div>
        <h1 className="text-[16px] font-bold text-slate-800">Flow submissions</h1>
        <p className="text-[11px] text-slate-500">Responses customers submitted from WhatsApp Flows.</p>
      </div>

      <TableFilters
        filters={filters}
        values={table.filterValues}
        hasActiveFilters={table.hasActiveFilters}
        onChange={table.setFilter}
        onClear={table.clearFilters}
      />

      <div className="flex gap-4 items-start">
        <DataTable
          {...table.tableProps}
          filters={[]}
          className="flex-1"
          columns={columns}
          getRowId={(s) => s.id}
          onRowClick={setSelected}
          rowClassName={(s) => (selected?.id === s.id ? 'bg-[#3440a8]/[0.04]' : 'hover:bg-slate-50/60')}
          errorTitle="Couldn't load submissions"
          loadingLabel="Loading submissions…"
          emptyState={(filtered) => (
            <EmptyState
              icon={<Inbox className="w-9 h-9 text-slate-300" />}
              title={filtered ? 'No submissions match these filters' : 'No submissions yet'}
              description={filtered ? 'Try a different Flow, status or date.' : 'Responses appear here as soon as customers complete a Flow.'}
            />
          )}
        />

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
              <dl className="space-y-2.5">
                {(selected.answers ?? []).length === 0 && <p className="text-slate-400">No answers in this response.</p>}
                {(selected.answers ?? []).map((a) => (
                  <div key={a.key}>
                    <dt className="text-[11px] text-slate-500" title={a.key}>{a.label}</dt>
                    <dd className="text-[13px] font-medium text-slate-800 break-words whitespace-pre-wrap">{a.value}</dd>
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
