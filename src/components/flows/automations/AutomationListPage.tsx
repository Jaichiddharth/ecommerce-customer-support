'use client';

import React, { useEffect, useState } from 'react';
import {
  Plus, Pencil, Copy, Power, PauseCircle, History, Archive, Trash2, RotateCcw, Sparkles, Workflow, Upload,
  MessageCircle, Hash, Bell, CircleSlash, Lock,
} from 'lucide-react';
import { gooeyToast } from '@/components/ui/goey-toaster';
import { EmptyState } from '@/components/ui/states';
import { DataTable, createColumnHelper, useServerTable, type FilterDef } from '@/components/ui/data-table';
import { notifyError } from '@/lib/api/notify';
import { StatusBadge, formatDate, iconBtn, primaryBtn, secondaryBtn } from '../whatsapp/wa-ui';
import { loadLegacyBrowserAutomation, forgetLegacyBrowserAutomation, toServerGraph } from '../FlowView';
import { automationsApi, TRIGGER_LABELS, type AutomationListItem, type TriggerType } from './automation-api';
import { AutomationRunsDrawer } from './AutomationRunsDrawer';
import { useAuth } from '@/context/AuthContext';

const TRIGGER_ICONS: Record<TriggerType, React.FC<{ className?: string }>> = {
  incoming_message: MessageCircle,
  keyword: Hash,
  conversation_event: Bell,
  none: CircleSlash,
};

const col = createColumnHelper<AutomationListItem>();

const STATUS_OPTIONS = [
  { value: 'draft', label: 'Draft' },
  { value: 'active', label: 'Active' },
  { value: 'paused', label: 'Paused' },
  { value: 'failed', label: 'Failed' },
  { value: 'archived', label: 'Archived' },
];

const EXECUTION_OPTIONS = [
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
  { value: 'waiting', label: 'Waiting' },
  { value: 'running', label: 'Running' },
  { value: 'timed_out', label: 'Timed out' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'never', label: 'Never run' },
];

const FILTERS: FilterDef[] = [
  { type: 'search', key: 'q', placeholder: 'Search automations…' },
  { type: 'select', key: 'status', label: 'Status', allLabel: 'All', options: STATUS_OPTIONS },
  {
    type: 'select',
    key: 'trigger',
    label: 'Trigger',
    allLabel: 'All',
    options: (Object.keys(TRIGGER_LABELS) as TriggerType[]).map((t) => ({ value: t, label: TRIGGER_LABELS[t] })),
  },
  { type: 'dateRange', key: 'modified', label: 'Modified' },
  { type: 'select', key: 'execution', label: 'Execution Status', allLabel: 'All', options: EXECUTION_OPTIONS },
];

export function AutomationListPage({
  onCreate,
  onEdit,
}: {
  onCreate: (startFrom: 'blank' | 'example') => void;
  onEdit: (id: number) => void;
}) {
  const [busyId, setBusyId] = useState<number | null>(null);
  const [history, setHistory] = useState<AutomationListItem | null>(null);
  const [legacy, setLegacy] = useState<ReturnType<typeof loadLegacyBrowserAutomation>>(null);
  const [importing, setImporting] = useState(false);

  const { can } = useAuth();
  const canCreate = can('flows', 'create');
  const canUpdate = can('flows', 'update');
  const canDelete = can('flows', 'delete');

  const table = useServerTable<AutomationListItem>({
    fetcher: automationsApi.list,
    filters: FILTERS,
    defaultSort: { sortBy: 'updatedAt', sortOrder: 'desc' },
  });
  const load = table.reload;

  useEffect(() => { setLegacy(loadLegacyBrowserAutomation()); }, []);

  const run = async (id: number, fn: () => Promise<unknown>, success?: string) => {
    setBusyId(id);
    try {
      await fn();
      if (success) gooeyToast.success(success);
    } catch (err) {
      notifyError(err, { where: 'AutomationListPage' });
    } finally {
      setBusyId(null);
      load();
    }
  };

  const toggleActive = (a: AutomationListItem) =>
    run(a.id, () => automationsApi.setActive(a.id, !a.isActive), a.isActive ? 'Automation paused' : 'Automation activated');

  const onRemove = (a: AutomationListItem) => {
    const archive = a.totalRuns > 0;
    const msg = archive
      ? `Archive "${a.name}"? It stops running and any waiting executions are cancelled. Its execution history is kept and it can be restored.`
      : `Delete "${a.name}"? It has never run. This cannot be undone.`;
    if (!window.confirm(msg)) return;
    run(a.id, () => automationsApi.remove(a.id), archive ? 'Automation archived' : 'Automation deleted');
  };

  const importLegacy = async () => {
    if (!legacy) return;
    setImporting(true);
    try {
      const created = await automationsApi.create({ name: 'Imported automation', graph: toServerGraph(legacy.nodes, legacy.edges) });
      forgetLegacyBrowserAutomation();
      setLegacy(null);
      gooeyToast.success('Automation imported', { description: 'Review it, then activate it when ready.' });
      onEdit(created.id);
    } catch (err) {
      notifyError(err, { where: 'AutomationListPage.import', title: "Couldn't import automation" });
    } finally {
      setImporting(false);
    }
  };

  const columns = [
    col.accessor('name', {
      header: 'Automation',
      enableSorting: true,
      meta: { className: 'max-w-[320px] align-top' },
      cell: ({ row: { original: a } }: { row: { original: AutomationListItem } }) => (
        <>
          <button
            className="font-semibold text-slate-800 hover:text-[#3440a8] text-left disabled:hover:text-slate-800"
            onClick={() => onEdit(a.id)}
            disabled={a.status === 'archived'}
            title={a.status === 'archived' ? 'Restore to edit' : 'Open in builder'}
          >
            {a.name}
          </button>
          {a.description && <div className="text-[11px] text-slate-500 line-clamp-2">{a.description}</div>}
        </>
      ),
    }),
    col.accessor('status', {
      header: 'Status',
      enableSorting: true,
      meta: { className: 'align-top' },
      cell: ({ getValue }: { getValue: () => any }) => <StatusBadge status={getValue()} />,
    }),
    col.accessor('triggerType', {
      id: 'trigger',
      header: 'Trigger',
      enableSorting: true,
      meta: { className: 'align-top' },
      cell: ({ getValue }: { getValue: () => TriggerType }) => {
        const type = (getValue() || 'none') as TriggerType;
        const TriggerIcon = TRIGGER_ICONS[type] || CircleSlash;
        return (
          <span className={`inline-flex items-center gap-1.5 ${type === 'none' ? 'text-amber-600' : 'text-slate-600'}`}>
            <TriggerIcon className="w-3.5 h-3.5" /> {TRIGGER_LABELS[type] || 'None'}
          </span>
        );
      },
    }),
    col.accessor('nodeCount', {
      id: 'nodes',
      header: 'Nodes',
      enableSorting: true,
      sortDescFirst: true,
      meta: { align: 'center', className: 'tabular-nums align-top' },
    }),
    col.accessor('updatedAt', {
      header: 'Last modified',
      enableSorting: true,
      sortDescFirst: true,
      meta: { className: 'text-slate-500 whitespace-nowrap align-top' },
      cell: ({ getValue }: { getValue: () => string | null }) => formatDate(getValue()),
    }),
    col.accessor('lastRunAt', {
      header: 'Last execution',
      enableSorting: true,
      sortDescFirst: true,
      meta: { className: 'align-top' },
      cell: ({ row: { original: a } }: { row: { original: AutomationListItem } }) =>
        a.lastRunStatus ? (
          <div className="flex flex-col items-start gap-0.5">
            <StatusBadge status={a.lastRunStatus} />
            <span className="text-[10px] text-slate-400 whitespace-nowrap">{formatDate(a.lastRunAt)}</span>
          </div>
        ) : <span className="text-slate-400">Never run</span>,
    }),
    col.accessor('totalRuns', {
      header: 'Executions',
      enableSorting: true,
      sortDescFirst: true,
      meta: { align: 'right', className: 'tabular-nums align-top' },
      cell: ({ row: { original: a } }: { row: { original: AutomationListItem } }) =>
        a.totalRuns > 0 ? <button className="text-[#3440a8] hover:underline" onClick={() => setHistory(a)}>{a.totalRuns}</button> : '0',
    }),
    col.display({
      id: 'actions',
      header: () => <span className="sr-only">Actions</span>,
      meta: { className: 'align-top' },
      cell: ({ row: { original: a } }: { row: { original: AutomationListItem } }) => {
        const archived = a.status === 'archived';
        const busy = busyId === a.id;
        return (
          <div className="flex items-center justify-end gap-0.5">
            {!archived && (
              <button
                className={`${iconBtn} ${a.isActive ? '!text-emerald-600' : ''} ${!canUpdate ? 'opacity-40 cursor-not-allowed' : ''}`}
                title={!canUpdate ? 'You do not have permission to update automations' : a.isActive ? 'Pause' : 'Activate'}
                disabled={busy || !canUpdate}
                onClick={canUpdate ? () => toggleActive(a) : undefined}
              >
                {a.isActive ? <PauseCircle className="w-3.5 h-3.5" /> : <Power className="w-3.5 h-3.5" />}
              </button>
            )}
            {!archived && (
              <button
                className={`${iconBtn} ${!canUpdate ? 'opacity-40 cursor-not-allowed' : ''}`}
                title={!canUpdate ? 'You do not have permission to update automations' : 'Edit'}
                disabled={!canUpdate}
                onClick={canUpdate ? () => onEdit(a.id) : undefined}
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
            )}
            <button className={iconBtn} title="Execution history" onClick={() => setHistory(a)}>
              <History className="w-3.5 h-3.5" />
            </button>
            <button
              className={`${iconBtn} ${!canCreate ? 'opacity-40 cursor-not-allowed' : ''}`}
              title={!canCreate ? 'You do not have permission to create automations' : 'Duplicate'}
              disabled={busy || !canCreate}
              onClick={canCreate ? () => run(a.id, () => automationsApi.duplicate(a.id), 'Automation duplicated as a draft') : undefined}
            >
              <Copy className="w-3.5 h-3.5" />
            </button>
            {archived ? (
              <button
                className={`${iconBtn} ${!canUpdate ? 'opacity-40 cursor-not-allowed' : ''}`}
                title={!canUpdate ? 'You do not have permission to update automations' : 'Restore'}
                disabled={busy || !canUpdate}
                onClick={canUpdate ? () => run(a.id, () => automationsApi.restore(a.id), 'Automation restored (paused)') : undefined}
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            ) : (
              <button
                className={`${iconBtn} ${canDelete ? 'hover:!text-red-500' : 'opacity-40 cursor-not-allowed'}`}
                title={!canDelete ? 'You do not have permission to delete automations' : (a.totalRuns > 0 ? 'Archive' : 'Delete')}
                disabled={busy || !canDelete}
                onClick={canDelete ? () => onRemove(a) : undefined}
              >
                {a.totalRuns > 0 ? <Archive className="w-3.5 h-3.5" /> : <Trash2 className="w-3.5 h-3.5" />}
              </button>
            )}
          </div>
        );
      },
    }),
  ];

  return (
    <div className="p-5 space-y-4 max-w-[1400px] mx-auto">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-[16px] font-bold text-slate-800">Automations</h1>
          <p className="text-[11px] text-slate-500">Event-driven workflows that run on incoming WhatsApp messages. Activate one to start running it.</p>
        </div>
        <div className="flex-1" />
        <button
          className={`${secondaryBtn} ${!canCreate ? 'opacity-50 cursor-not-allowed' : ''}`}
          disabled={!canCreate}
          title={!canCreate ? 'You do not have permission to create automations' : undefined}
          onClick={canCreate ? () => onCreate('example') : undefined}
        >
          {!canCreate ? <Lock className="w-3.5 h-3.5" /> : <Sparkles className="w-3.5 h-3.5" />}
          From example
        </button>
        <button
          className={`${primaryBtn} ${!canCreate ? 'opacity-50 cursor-not-allowed' : ''}`}
          disabled={!canCreate}
          title={!canCreate ? 'You do not have permission to create automations' : undefined}
          onClick={canCreate ? () => onCreate('blank') : undefined}
        >
          {!canCreate ? <Lock className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
          Create Automation
        </button>
      </div>

      {legacy && (
        <div className="flex flex-wrap items-center gap-3 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3">
          <Upload className="w-4 h-4 text-blue-600" />
          <p className="flex-1 text-[12px] text-blue-800">
            An automation ({legacy.nodes.length} steps) is saved only in this browser from the earlier builder. Import it into your workspace to keep it.
          </p>
          <button className={primaryBtn} onClick={importLegacy} disabled={importing}>
            {importing ? 'Importing…' : 'Import automation'}
          </button>
        </div>
      )}

      <DataTable
        {...table.tableProps}
        columns={columns}
        getRowId={(a) => a.id}
        rowClassName={(a) => `hover:bg-slate-50/60 ${busyId === a.id ? 'opacity-60' : ''}`}
        errorTitle="Couldn't load automations"
        loadingLabel="Loading automations…"
        emptyState={(filtered) => (
          <EmptyState
            icon={<Workflow className="w-9 h-9 text-slate-300" />}
            title={filtered ? 'No automations match these filters' : 'No automations yet'}
            description={filtered ? 'Try a different search or filter.' : 'Create an automation to reply, tag contacts or send WhatsApp Flows automatically.'}
            action={!filtered ? (
              <div className="flex gap-2">
                <button
                  className={`${primaryBtn} ${!canCreate ? 'opacity-50 cursor-not-allowed' : ''}`}
                  disabled={!canCreate}
                  title={!canCreate ? 'You do not have permission to create automations' : undefined}
                  onClick={canCreate ? () => onCreate('blank') : undefined}
                >
                  <Plus className="w-3.5 h-3.5" /> Create Automation
                </button>
                <button
                  className={`${secondaryBtn} ${!canCreate ? 'opacity-50 cursor-not-allowed' : ''}`}
                  disabled={!canCreate}
                  title={!canCreate ? 'You do not have permission to create automations' : undefined}
                  onClick={canCreate ? () => onCreate('example') : undefined}
                >
                  <Sparkles className="w-3.5 h-3.5" /> From example
                </button>
              </div>
            ) : undefined}
          />
        )}
      />

      {history && <AutomationRunsDrawer automation={history} onClose={() => setHistory(null)} />}
    </div>
  );
}
