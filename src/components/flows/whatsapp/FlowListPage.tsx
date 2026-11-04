'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  Plus, Search, Pencil, Copy, Eye, Rocket, Info, Archive, Trash2, RotateCcw, Sparkles, FilePlus2,
  MessageSquareText, Upload, Workflow,
} from 'lucide-react';
import { gooeyToast } from '@/components/ui/goey-toaster';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { notifyError } from '@/lib/api/notify';
import { createBlankFlow, createSampleFlow } from '@/lib/whatsapp-flows/wa-component-registry';
import type { WaFlow } from '@/lib/whatsapp-flows/wa-flow-types';
import { flowsApi, categoryLabel, type FlowListItem, type FlowStatus } from './wa-api';
import { forgetLocalDrafts, loadLocalDrafts } from './wa-flow-storage';
import { StatusBadge, Pagination, formatDate, iconBtn, inputCls, primaryBtn, secondaryBtn } from './wa-ui';

const PAGE_SIZE = 20;
const STATUS_FILTERS: { value: '' | FlowStatus; label: string }[] = [
  { value: '', label: 'All (active)' },
  { value: 'draft', label: 'Draft' },
  { value: 'publishing', label: 'Publishing' },
  { value: 'published', label: 'Published' },
  { value: 'failed', label: 'Failed' },
  { value: 'deprecated', label: 'Deprecated' },
  { value: 'archived', label: 'Archived' },
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
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [status, setStatus] = useState<'' | FlowStatus>('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ items: FlowListItem[]; total: number } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [localDrafts, setLocalDrafts] = useState<WaFlow[]>([]);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => { setDebouncedQ(q); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await flowsApi.list({ q: debouncedQ || undefined, status: status || undefined, page, pageSize: PAGE_SIZE });
      setData({ items: res.items, total: res.total });
    } catch (err) {
      setError(err);
    }
  }, [debouncedQ, status, page]);

  useEffect(() => { load(); }, [load]);
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

  return (
    <div className="p-5 space-y-4 max-w-[1400px] mx-auto">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-[16px] font-bold text-slate-800">WhatsApp Flows</h1>
          <p className="text-[11px] text-slate-500">Multi-screen forms customers complete inside WhatsApp. Publish a Flow, then attach it to templates or automations.</p>
        </div>
        <div className="flex-1" />
        <button className={secondaryBtn} onClick={() => onCreate(createSampleFlow())}>
          <Sparkles className="w-3.5 h-3.5" /> From example
        </button>
        <button className={primaryBtn} onClick={() => onCreate(createBlankFlow())}>
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

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search flows…" className={`${inputCls} pl-8`} />
        </div>
        <select
          value={status}
          onChange={(e) => { setStatus(e.target.value as '' | FlowStatus); setPage(1); }}
          className={`${inputCls} w-auto`}
        >
          {STATUS_FILTERS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {error ? (
          <ErrorState error={error} title="Couldn't load flows" onRetry={load} />
        ) : !data ? (
          <LoadingState label="Loading flows…" />
        ) : data.items.length === 0 ? (
          <EmptyState
            icon={<MessageSquareText className="w-9 h-9 text-slate-300" />}
            title={debouncedQ || status ? 'No flows match these filters' : 'No WhatsApp Flows yet'}
            description={debouncedQ || status ? 'Try a different search or status.' : 'Create a Flow to collect structured answers from customers without leaving WhatsApp.'}
            action={!debouncedQ && !status ? (
              <div className="flex gap-2">
                <button className={primaryBtn} onClick={() => onCreate(createSampleFlow())}><Sparkles className="w-3.5 h-3.5" /> Start from example</button>
                <button className={secondaryBtn} onClick={() => onCreate(createBlankFlow())}><FilePlus2 className="w-3.5 h-3.5" /> Blank flow</button>
              </div>
            ) : undefined}
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wider text-slate-400 border-b border-slate-100">
                    <th className="px-4 py-2.5 font-semibold">Flow</th>
                    <th className="px-3 py-2.5 font-semibold">Status</th>
                    <th className="px-3 py-2.5 font-semibold">Meta Flow ID</th>
                    <th className="px-3 py-2.5 font-semibold text-center">Screens</th>
                    <th className="px-3 py-2.5 font-semibold">Templates</th>
                    <th className="px-3 py-2.5 font-semibold">Automations</th>
                    <th className="px-3 py-2.5 font-semibold">Created</th>
                    <th className="px-3 py-2.5 font-semibold">Updated</th>
                    <th className="px-3 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((f) => {
                    const archived = f.status === 'archived';
                    const busy = busyId === f.id;
                    return (
                      <tr key={f.id} className={`border-b border-slate-50 hover:bg-slate-50/60 ${busy ? 'opacity-60' : ''}`}>
                        <td className="px-4 py-2.5">
                          <button className="font-semibold text-slate-800 hover:text-[#3440a8] text-left" onClick={() => onDetails(f.id)}>
                            {f.name}
                          </button>
                          <div className="text-[10px] text-slate-400">{f.categories.map(categoryLabel).join(', ')}</div>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex flex-col items-start gap-0.5">
                            <StatusBadge status={f.status} />
                            {f.publishedVersionNumber && (
                              <span className="text-[10px] text-slate-400">
                                v{f.publishedVersionNumber} live{f.hasUnpublishedChanges ? ' · edits pending' : ''}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 font-mono text-[10px] text-slate-500">{f.metaFlowId ?? '—'}</td>
                        <td className="px-3 py-2.5 text-center tabular-nums">{f.screensCount}</td>
                        <td className="px-3 py-2.5 tabular-nums">{f.templatesCount || '—'}</td>
                        <td className="px-3 py-2.5">
                          {f.automations.length ? (
                            <span className="inline-flex items-center gap-1 text-slate-600" title={f.automations.map((a) => a.name).join(', ')}>
                              <Workflow className="w-3 h-3 text-[#3440a8]" /> {f.automations.length}
                            </span>
                          ) : '—'}
                        </td>
                        <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap">{formatDate(f.createdAt)}</td>
                        <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap">{formatDate(f.updatedAt)}</td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center justify-end gap-0.5">
                            {!archived && <button className={iconBtn} title="Edit" onClick={() => onEdit(f.id)}><Pencil className="w-3.5 h-3.5" /></button>}
                            <button className={iconBtn} title="Preview" onClick={() => onPreview(f.id)}><Eye className="w-3.5 h-3.5" /></button>
                            {!archived && (
                              <button
                                className={iconBtn}
                                title={f.publishedVersionId && !f.hasUnpublishedChanges ? 'Already published' : 'Publish'}
                                disabled={busy || (!!f.publishedVersionId && !f.hasUnpublishedChanges)}
                                onClick={() => window.confirm(`Publish "${f.name}" to WhatsApp?`) && run(f.id, () => flowsApi.action(f.id, 'publish'), 'Flow published')}
                              >
                                <Rocket className="w-3.5 h-3.5" />
                              </button>
                            )}
                            <button className={iconBtn} title="Duplicate" disabled={busy} onClick={() => run(f.id, () => flowsApi.action(f.id, 'duplicate'), 'Flow duplicated')}>
                              <Copy className="w-3.5 h-3.5" />
                            </button>
                            <button className={iconBtn} title="Details" onClick={() => onDetails(f.id)}><Info className="w-3.5 h-3.5" /></button>
                            {archived ? (
                              <button className={iconBtn} title="Restore" disabled={busy} onClick={() => run(f.id, () => flowsApi.action(f.id, 'restore'), 'Flow restored')}>
                                <RotateCcw className="w-3.5 h-3.5" />
                              </button>
                            ) : (
                              <button className={`${iconBtn} hover:!text-red-500`} title="Archive / delete" disabled={busy} onClick={() => onRemove(f)}>
                                {f.publishedVersionId || f.latestVersionNumber || f.templatesCount ? <Archive className="w-3.5 h-3.5" /> : <Trash2 className="w-3.5 h-3.5" />}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={PAGE_SIZE} total={data.total} onPage={setPage} />
          </>
        )}
      </div>
    </div>
  );
}
