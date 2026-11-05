'use client';

import React, { useEffect, useState } from 'react';
import {
  Plus, Pencil, Copy, Eye, Rocket, Info, Archive, Trash2, RotateCcw, Sparkles, FilePlus2,
  MessageSquareText, Upload, Workflow,
} from 'lucide-react';
import { gooeyToast } from '@/components/ui/goey-toaster';
import { EmptyState } from '@/components/ui/states';
import { DataTable, createColumnHelper, useServerTable, type FilterDef } from '@/components/ui/data-table';
import { notifyError } from '@/lib/api/notify';
import { createBlankFlow, createSampleFlow } from '@/lib/whatsapp-flows/wa-component-registry';
import type { WaFlow } from '@/lib/whatsapp-flows/wa-flow-types';
import { flowsApi, categoryLabel, type FlowListItem, type FlowStatus } from './wa-api';
import { useAuth } from '@/context/AuthContext';
import { Lock } from 'lucide-react';
import { forgetLocalDrafts, loadLocalDrafts } from './wa-flow-storage';
import { StatusBadge, formatDate, iconBtn, primaryBtn, secondaryBtn } from './wa-ui';

const col = createColumnHelper<FlowListItem>();

const FILTERS: FilterDef[] = [
  { type: 'search', key: 'q', placeholder: 'Search flows…' },
  {
    type: 'select',
    key: 'status',
    label: 'Status',
    allLabel: 'All (active)',
    options: [
      { value: 'draft', label: 'Draft' },
      { value: 'publishing', label: 'Publishing' },
      { value: 'published', label: 'Published' },
      { value: 'failed', label: 'Failed' },
      { value: 'deprecated', label: 'Deprecated' },
      { value: 'archived', label: 'Archived' },
    ],
  },
  { type: 'dateRange', key: 'createdAt', label: 'Created' },
];

export function FlowListPage({
  onCreate,
  onEdit,
  onPreview,
  onDetails,
}: {
  onCreate: (draft: WaFlow) => void;
  onEdit: (id: number) => void;
  onPreview: (id: number) => void;
  onDetails: (id: number) => void;
}) {
  const [busyId, setBusyId] = useState<number | null>(null);
  const [localDrafts, setLocalDrafts] = useState<WaFlow[]>([]);
  const [importing, setImporting] = useState(false);
  const { can } = useAuth();
  const canCreate = can('flows', 'create');
  const canUpdate = can('flows', 'update');
  const canDelete = can('flows', 'delete');

  const table = useServerTable<FlowListItem>({
    fetcher: flowsApi.list,
    filters: FILTERS,
    defaultSort: { sortBy: 'updatedAt', sortOrder: 'desc' },
  });
  const load = table.reload;

  useEffect(() => { setLocalDrafts(loadLocalDrafts()); }, []);

  const run = async (id: number, fn: () => Promise<unknown>, success: string) => {
    setBusyId(id);
    try {
      await fn();
      gooeyToast.success(success);
      await load();
    } catch (err) {
      notifyError(err, { where: 'FlowListPage' });
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const onRemove = (f: FlowListItem) => {
    const willArchive = f.publishedVersionId || f.templatesCount > 0 || f.latestVersionNumber;
    const msg = willArchive
      ? `Archive "${f.name}"? Its published versions, templates and submissions are kept; it can be restored later.`
      : `Delete draft "${f.name}"? This cannot be undone.`;
    if (!window.confirm(msg)) return;
    run(f.id, async () => {
      const res = await flowsApi.remove(f.id);
      if (res.archived) gooeyToast.info('Flow archived', { description: 'It was published or used, so it was archived instead of deleted.' });
    }, willArchive ? 'Flow archived' : 'Flow deleted');
  };

  const importDrafts = async () => {
    setImporting(true);
    const imported: string[] = [];
    for (const draft of localDrafts) {
      try {
        await flowsApi.create({ name: draft.name || 'Imported flow', draft });
        imported.push(draft.id);
      } catch (err) {
        notifyError(err, { where: 'FlowListPage.import', title: `Couldn't import "${draft.name}"` });
      }
    }
    forgetLocalDrafts(imported);
    setLocalDrafts(loadLocalDrafts());
    setImporting(false);
    if (imported.length) gooeyToast.success(`Imported ${imported.length} draft${imported.length > 1 ? 's' : ''}`);
    load();
  };

  const columns = [
    col.accessor('name', {
      header: 'Flow',
      enableSorting: true,
      cell: ({ row: { original: f } }: { row: { original: FlowListItem } }) => (
        <>
          <button className="font-semibold text-slate-800 hover:text-[#3440a8] text-left" onClick={() => onDetails(f.id)}>
            {f.name}
          </button>
          <div className="text-[10px] text-slate-400">{f.categories.map(categoryLabel).join(', ')}</div>
        </>
      ),
    }),
    col.accessor('status', {
      header: 'Status',
      enableSorting: true,
      cell: ({ row: { original: f } }: { row: { original: FlowListItem } }) => (
        <div className="flex flex-col items-start gap-0.5">
          <StatusBadge status={f.status} />
          {f.publishedVersionNumber && (
            <span className="text-[10px] text-slate-400">
              v{f.publishedVersionNumber} live{f.hasUnpublishedChanges ? ' · edits pending' : ''}
            </span>
          )}
        </div>
      ),
    }),
    col.accessor('metaFlowId', {
      header: 'Meta Flow ID',
      meta: { className: 'font-mono text-[10px] text-slate-500' },
      cell: ({ getValue }: { getValue: () => string | null }) => getValue() ?? '—',
    }),
    col.accessor('screensCount', {
      id: 'screens',
      header: 'Screens',
      enableSorting: true,
      sortDescFirst: true,
      meta: { align: 'center', className: 'tabular-nums' },
    }),
    col.accessor('templatesCount', {
      id: 'templates',
      header: 'Templates',
      enableSorting: true,
      sortDescFirst: true,
      meta: { className: 'tabular-nums' },
      cell: ({ getValue }: { getValue: () => number }) => getValue() || '—',
    }),
    col.display({
      id: 'automations',
      header: 'Automations',
      cell: ({ row: { original: f } }: { row: { original: FlowListItem } }) =>
        f.automations.length ? (
          <span className="inline-flex items-center gap-1 text-slate-600" title={f.automations.map((a: any) => a.name).join(', ')}>
            <Workflow className="w-3 h-3 text-[#3440a8]" /> {f.automations.length}
          </span>
        ) : '—',
    }),
    col.accessor('createdAt', {
      header: 'Created',
      enableSorting: true,
      sortDescFirst: true,
      meta: { className: 'text-slate-500 whitespace-nowrap' },
      cell: ({ getValue }: { getValue: () => string }) => formatDate(getValue()),
    }),
    col.accessor('updatedAt', {
      header: 'Updated',
      enableSorting: true,
      sortDescFirst: true,
      meta: { className: 'text-slate-500 whitespace-nowrap' },
      cell: ({ getValue }: { getValue: () => string }) => formatDate(getValue()),
    }),
    col.display({
      id: 'actions',
      header: () => <span className="sr-only">Actions</span>,
      cell: ({ row: { original: f } }: { row: { original: FlowListItem } }) => {
        const archived = f.status === 'archived';
        const busy = busyId === f.id;
        return (
          <div className="flex items-center justify-end gap-0.5">
            {!archived && <button className={`${iconBtn} ${!canUpdate ? 'opacity-40 cursor-not-allowed' : ''}`} disabled={!canUpdate} title={!canUpdate ? 'You do not have permission to update flows' : 'Edit'} onClick={canUpdate ? () => onEdit(f.id) : undefined}><Pencil className="w-3.5 h-3.5" /></button>}
            <button className={iconBtn} title="Preview" onClick={() => onPreview(f.id)}><Eye className="w-3.5 h-3.5" /></button>
            {!archived && (
              <button
                className={`${iconBtn} ${!canUpdate ? 'opacity-40 cursor-not-allowed' : ''}`}
                title={!canUpdate ? 'You do not have permission to update flows' : f.publishedVersionId && !f.hasUnpublishedChanges ? 'Already published' : 'Publish'}
                disabled={busy || !canUpdate || (!!f.publishedVersionId && !f.hasUnpublishedChanges)}
                onClick={canUpdate ? () => window.confirm(`Publish "${f.name}" to WhatsApp?`) && run(f.id, () => flowsApi.action(f.id, 'publish'), 'Flow published') : undefined}
              >
                <Rocket className="w-3.5 h-3.5" />
              </button>
            )}
            <button className={`${iconBtn} ${!canCreate ? 'opacity-40 cursor-not-allowed' : ''}`} disabled={busy || !canCreate} title={!canCreate ? 'You do not have permission to create flows' : 'Duplicate'} onClick={canCreate ? () => run(f.id, () => flowsApi.action(f.id, 'duplicate'), 'Flow duplicated') : undefined}>
              <Copy className="w-3.5 h-3.5" />
            </button>
            <button className={iconBtn} title="Details" onClick={() => onDetails(f.id)}><Info className="w-3.5 h-3.5" /></button>
            {archived ? (
              <button className={iconBtn} title="Restore" disabled={busy} onClick={() => run(f.id, () => flowsApi.action(f.id, 'restore'), 'Flow restored')}>
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            ) : (
              <button className={`${iconBtn} ${canDelete ? 'hover:!text-red-500' : 'opacity-40 cursor-not-allowed'}`} title={!canDelete ? 'You do not have permission to delete flows' : 'Archive / delete'} disabled={busy || !canDelete} onClick={canDelete ? () => onRemove(f) : undefined}>
                {f.publishedVersionId || f.latestVersionNumber || f.templatesCount ? <Archive className="w-3.5 h-3.5" /> : <Trash2 className="w-3.5 h-3.5" />}
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
          <h1 className="text-[16px] font-bold text-slate-800">WhatsApp Flows</h1>
          <p className="text-[11px] text-slate-500">Multi-screen forms customers complete inside WhatsApp. Publish a Flow, then attach it to templates or automations.</p>
        </div>
        <div className="flex-1" />
        <button className={`${secondaryBtn} ${!canCreate ? 'opacity-50 cursor-not-allowed' : ''}`} disabled={!canCreate} title={!canCreate ? 'You do not have permission to create flows' : undefined} onClick={canCreate ? () => onCreate(createSampleFlow()) : undefined}>
          <Sparkles className="w-3.5 h-3.5" /> From example
        </button>
        <button className={`${primaryBtn} ${!canCreate ? 'opacity-50 cursor-not-allowed' : ''}`} disabled={!canCreate} title={!canCreate ? 'You do not have permission to create flows' : undefined} onClick={canCreate ? () => onCreate(createBlankFlow()) : undefined}>
          <Plus className="w-3.5 h-3.5" /> Create Flow
        </button>
      </div>

      {localDrafts.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3">
          <Upload className="w-4 h-4 text-blue-600" />
          <p className="flex-1 text-[12px] text-blue-800">
            {localDrafts.length} draft{localDrafts.length > 1 ? 's' : ''} saved in this browser before Flows were stored in your workspace.
            Import them to keep editing and publish them.
          </p>
          <button className={primaryBtn} onClick={importDrafts} disabled={importing}>
            {importing ? 'Importing…' : 'Import drafts'}
          </button>
        </div>
      )}

      <DataTable
        {...table.tableProps}
        columns={columns}
        getRowId={(f) => f.id}
        rowClassName={(f) => `hover:bg-slate-50/60 ${busyId === f.id ? 'opacity-60' : ''}`}
        errorTitle="Couldn't load flows"
        loadingLabel="Loading flows…"
        emptyState={(filtered) => (
          <EmptyState
            icon={<MessageSquareText className="w-9 h-9 text-slate-300" />}
            title={filtered ? 'No flows match these filters' : 'No WhatsApp Flows yet'}
            description={filtered ? 'Try a different search, status or date.' : 'Create a Flow to collect structured answers from customers without leaving WhatsApp.'}
            action={!filtered ? (
              <div className="flex gap-2">
                <button className={primaryBtn} onClick={() => onCreate(createSampleFlow())}><Sparkles className="w-3.5 h-3.5" /> Start from example</button>
                <button className={secondaryBtn} onClick={() => onCreate(createBlankFlow())}><FilePlus2 className="w-3.5 h-3.5" /> Blank flow</button>
              </div>
            ) : undefined}
          />
       
        )}
      />
    </div>
  );
}
