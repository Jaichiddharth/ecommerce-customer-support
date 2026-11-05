'use client';

import React, { useState } from 'react';
import { Plus, RefreshCw, Trash2, RotateCcw, FileText, MousePointerClick, FlaskConical } from 'lucide-react';
import { gooeyToast } from '@/components/ui/goey-toaster';
import { EmptyState } from '@/components/ui/states';
import { DataTable, createColumnHelper, useServerTable, type FilterDef } from '@/components/ui/data-table';
import { notifyError } from '@/lib/api/notify';
import { templatesApi, type WaTemplate } from './wa-api';
import { StatusBadge, formatDate, iconBtn, primaryBtn } from './wa-ui';
import { CreateFlowTemplateDialog } from './CreateFlowTemplateDialog';
import { TemplateDetailsDialog } from './TemplateDetailsDialog';
import { TestFlowDialog } from './TestFlowDialog';

const col = createColumnHelper<WaTemplate>();

const FILTERS: FilterDef[] = [
  {
    type: 'select',
    key: 'status',
    label: 'Status',
    allLabel: 'All',
    options: [
      { value: 'APPROVED', label: 'Approved' },
      { value: 'PENDING', label: 'Pending' },
      { value: 'REJECTED', label: 'Rejected' },
      { value: 'PAUSED', label: 'Paused' },
      { value: 'DISABLED', label: 'Disabled' },
      { value: 'SUBMISSION_FAILED', label: 'Submission failed' },
    ],
  },
  { type: 'dateRange', key: 'createdAt', label: 'Created' },
];

export function TemplatesPage({ flowFilter, onOpenFlow }: { flowFilter?: number; onOpenFlow: (id: number) => void }) {
  const [busyId, setBusyId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [detailsId, setDetailsId] = useState<number | null>(null);
  // Test Flow lists every template of the Flow, not just the ones on this page
  const [testing, setTesting] = useState<{ template: WaTemplate; flowTemplates: WaTemplate[] } | null>(null);

  const table = useServerTable<WaTemplate>({
    fetcher: templatesApi.listing,
    filters: FILTERS,
    defaultSort: { sortBy: 'updatedAt', sortOrder: 'desc' },
    baseParams: { flowId: flowFilter },
  });
  const load = table.reload;
  const details = table.rows.find((t) => t.id === detailsId) ?? null;

  const run = async (id: number, fn: () => Promise<unknown>, success: string) => {
    setBusyId(id);
    try {
      await fn();
      gooeyToast.success(success);
    } catch (err) {
      notifyError(err, { where: 'TemplatesPage' });
    } finally {
      setBusyId(null);
      load();
    }
  };

  const sync = (t: WaTemplate) => run(t.id, () => templatesApi.sync(t.id), 'Status synced');
  const retry = (t: WaTemplate) => run(t.id, () => templatesApi.retry(t.id), 'Template submitted');
  const remove = (t: WaTemplate) => {
    if (!window.confirm(`Delete template "${t.name}" from WhatsApp? Automations using it will stop sending.`)) return;
    setDetailsId(null);
    run(t.id, () => templatesApi.remove(t.id), 'Template deleted');
  };
  const canTest = (t: WaTemplate) => t.status === 'APPROVED' && !!t.flowId;
  const openTest = async (t: WaTemplate) => {
    setBusyId(t.id);
    try {
      setTesting({ template: t, flowTemplates: await templatesApi.list({ flowId: t.flowId! }) });
    } catch {
      setTesting({ template: t, flowTemplates: [t] });
    } finally {
      setBusyId(null);
    }
  };

  const columns = [
    col.accessor('name', {
      header: 'Template',
      enableSorting: true,
      cell: ({ row: { original: t } }) => (
        <button className="font-semibold text-slate-800 hover:text-[#3440a8] hover:underline text-left" onClick={() => setDetailsId(t.id)}>
          {t.name}
        </button>
      ),
    }),
    col.accessor('status', {
      header: 'Review status',
      enableSorting: true,
      cell: ({ row: { original: t } }) => (
        <>
          <StatusBadge status={t.status} />
          {t.rejectionReason && <p className="text-[10px] text-red-500 mt-1 max-w-[220px]">{t.rejectionReason}</p>}
          {t.lastError && <p className="text-[10px] text-amber-600 mt-1 max-w-[220px]">{t.lastError}</p>}
        </>
      ),
    }),
    col.accessor((t) => t.flowName ?? null, {
      id: 'flow',
      header: 'Flow',
      enableSorting: true,
      cell: ({ row: { original: t } }) => (
        <>
          {t.flowId ? (
            <button className="text-left text-[#3440a8] hover:underline" onClick={() => onOpenFlow(t.flowId!)}>
              {t.flowName ?? `Flow #${t.flowId}`}
            </button>
          ) : '—'}
          {t.versionNumber && (
            <div className="text-[10px] text-slate-400">
              v{t.versionNumber}{t.versionStatus && t.versionStatus !== 'published' ? ` · ${t.versionStatus}` : ''}
            </div>
          )}
        </>
      ),
    }),
    col.accessor((t) => t.flowButton?.text ?? null, {
      id: 'button',
      header: 'Button',
      enableSorting: true,
      cell: ({ getValue }) => {
        const text = getValue();
        return text ? (
          <span className="inline-flex items-center gap-1 text-slate-600">
            <MousePointerClick className="w-3 h-3" /> {text}
          </span>
        ) : '—';
      },
    }),
    col.accessor('updatedAt', {
      header: 'Updated',
      enableSorting: true,
      sortDescFirst: true,
      meta: { className: 'text-slate-500 whitespace-nowrap' },
      cell: ({ getValue }) => formatDate(getValue()),
    }),
    col.display({
      id: 'actions',
      header: () => <span className="sr-only">Actions</span>,
      cell: ({ row: { original: t } }) => (
        <div className="flex items-center justify-end gap-0.5">
          {canTest(t) && (
            <button className={`${iconBtn} hover:!text-[#3440a8]`} title="Test Flow: send to a WhatsApp number" disabled={busyId === t.id} onClick={() => openTest(t)}>
              <FlaskConical className="w-3.5 h-3.5" />
            </button>
          )}
          {t.status === 'SUBMISSION_FAILED' ? (
            <button className={iconBtn} title="Retry submission" disabled={busyId === t.id} onClick={() => retry(t)}>
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button className={iconBtn} title="Sync review status" disabled={busyId === t.id || !t.metaTemplateId} onClick={() => sync(t)}>
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          )}
          <button className={`${iconBtn} hover:!text-red-500`} title="Delete template" disabled={busyId === t.id} onClick={() => remove(t)}>
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      ),
    }),
  ];

  return (
    <div className="p-5 space-y-4 max-w-[1300px] mx-auto">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-[16px] font-bold text-slate-800">Flow templates</h1>
          <p className="text-[11px] text-slate-500">
            Message templates with a WhatsApp Flow button. Each template is reviewed by Meta separately from the Flow’s publication.
          </p>
        </div>
        <div className="flex-1" />
        <button className={primaryBtn} onClick={() => setCreating(true)}><Plus className="w-3.5 h-3.5" /> Create template</button>
      </div>

      <DataTable
        {...table.tableProps}
        columns={columns}
        getRowId={(t) => t.id}
        rowClassName={(t) => `hover:bg-slate-50/60 align-top ${busyId === t.id ? 'opacity-60' : ''}`}
        errorTitle="Couldn't load templates"
        loadingLabel="Loading templates…"
        emptyState={(filtered) => (
          <EmptyState
            icon={<FileText className="w-9 h-9 text-slate-300" />}
            title={filtered ? 'No templates match these filters' : 'No Flow templates yet'}
            description={filtered ? 'Try a different status or date.' : 'Create a template with a WhatsApp Flow button to send a published Flow to customers at any time.'}
            action={!filtered ? <button className={primaryBtn} onClick={() => setCreating(true)}><Plus className="w-3.5 h-3.5" /> Create template</button> : undefined}
          />
        )}
      />

      {creating && (
        <CreateFlowTemplateDialog
          defaultFlowId={flowFilter}
          onClose={() => setCreating(false)}
          onCreated={() => { setCreating(false); gooeyToast.success('Template submitted for review'); load(); }}
        />
      )}

      {details && !testing && (
        <TemplateDetailsDialog
          template={details}
          busy={busyId === details.id}
          onClose={() => setDetailsId(null)}
          onOpenFlow={onOpenFlow}
          onTest={() => openTest(details)}
          onSync={() => sync(details)}
          onRetry={() => retry(details)}
          onDelete={() => remove(details)}
        />
      )}

      {testing && (
        <TestFlowDialog
          flowId={testing.template.flowId!}
          flowName={testing.template.flowName ?? testing.template.name}
          templates={testing.flowTemplates}
          defaultTemplateId={testing.template.id}
          onClose={() => setTesting(null)}
        />
      )}
    </div>
  );
}
