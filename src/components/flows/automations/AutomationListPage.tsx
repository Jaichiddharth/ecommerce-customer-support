'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  Plus, Search, Pencil, Copy, Power, PauseCircle, History, Archive, Trash2, RotateCcw, Sparkles, Workflow, Upload,
  MessageCircle, Hash, Bell, CircleSlash,
} from 'lucide-react';
import { gooeyToast } from '@/components/ui/goey-toaster';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { notifyError } from '@/lib/api/notify';
import { StatusBadge, Pagination, formatDate, iconBtn, inputCls, primaryBtn, secondaryBtn } from '../whatsapp/wa-ui';
import { loadLegacyBrowserAutomation, forgetLegacyBrowserAutomation, toServerGraph } from '../FlowView';
import { automationsApi, TRIGGER_LABELS, type AutomationListItem, type TriggerType } from './automation-api';
import { AutomationRunsDrawer } from './AutomationRunsDrawer';
import { useAuth } from '@/context/AuthContext';
import { Lock } from 'lucide-react';

const PAGE_SIZE = 20;

const TRIGGER_ICONS: Record<TriggerType, React.FC<{ className?: string }>> = {
  incoming_message: MessageCircle,
  keyword: Hash,
  conversation_event: Bell,
  none: CircleSlash,
};

export function AutomationListPage({
  onCreate,
  onEdit,
}: {
  onCreate: (startFrom: 'blank' | 'example') => void;
  onEdit: (id: number) => void;
}) {
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [status, setStatus] = useState('');
  const [trigger, setTrigger] = useState('');
  const [modified, setModified] = useState('');
  const [execution, setExecution] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ items: AutomationListItem[]; total: number } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [history, setHistory] = useState<AutomationListItem | null>(null);
  const [legacy, setLegacy] = useState<ReturnType<typeof loadLegacyBrowserAutomation>>(null);
  const [importing, setImporting] = useState(false);

  const { can } = useAuth();
  const canCreate = can('flows', 'create');
  const canUpdate = can('flows', 'update');
  const canDelete = can('flows', 'delete');

  useEffect(() => {
    const t = setTimeout(() => { setDebouncedQ(q); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await automationsApi.list({
        q: debouncedQ || undefined,
        status: status || undefined,
        trigger: trigger || undefined,
        modified: modified || undefined,
        execution: execution || undefined,
        page,
        pageSize: PAGE_SIZE,
      });
      setData({ items: res.items, total: res.total });
    } catch (err) {
      setError(err);
    }
  }, [debouncedQ, status, trigger, modified, execution, page]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setLegacy(loadLegacyBrowserAutomation()); }, []);

  const filtered = !!(debouncedQ || status || trigger || modified || execution);
  const resetPage = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(1); };

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

  return (
    <div className="p-5 space-y-4 max-w-[1400px] mx-auto">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-[16px] font-bold text-slate-800">Automations</h1>
          <p className="text-[11px] text-slate-500">Event-driven workflows that run on incoming WhatsApp messages. Activate one to start running it.</p>
        </div>
        <div className="flex-1" />
        <button className={`${secondaryBtn} ${!canCreate ? 'opacity-50 cursor-not-allowed' : ''}`} disabled={!canCreate} title={!canCreate ? 'You do not have permission to create automations' : undefined} onClick={canCreate ? () => onCreate('example') : undefined}>
          <Sparkles className="w-3.5 h-3.5" /> From example
        </button>
        <button className={`${primaryBtn} ${!canCreate ? 'opacity-50 cursor-not-allowed' : ''}`} disabled={!canCreate} title={!canCreate ? 'You do not have permission to create automations' : undefined} onClick={canCreate ? () => onCreate('blank') : undefined}>
          <Plus className="w-3.5 h-3.5" /> Create Automation
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

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative shrink-0">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search automations…" className={`${inputCls} !w-48 pl-8`} />
        </div>
        <select value={status} onChange={(e) => resetPage(setStatus)(e.target.value)} className={`${inputCls} !w-auto shrink-0`} aria-label="Status">
          <option value="">All statuses</option>
          <option value="draft">Draft</option>
          <option value="active">Active</option>
          <option value="paused">Paused</option>
          <option value="failed">Failed</option>
          <option value="archived">Archived</option>
        </select>
        <select value={trigger} onChange={(e) => resetPage(setTrigger)(e.target.value)} className={`${inputCls} !w-auto shrink-0`} aria-label="Trigger">
          <option value="">All triggers</option>
          {(Object.keys(TRIGGER_LABELS) as TriggerType[]).map((t) => <option key={t} value={t}>{TRIGGER_LABELS[t]}</option>)}
        </select>
        <select value={modified} onChange={(e) => resetPage(setModified)(e.target.value)} className={`${inputCls} !w-auto shrink-0`} aria-label="Last modified">
          <option value="">Modified any time</option>
          <option value="24h">Last 24 hours</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="older">Older than 30 days</option>
        </select>
        <select value={execution} onChange={(e) => resetPage(setExecution)(e.target.value)} className={`${inputCls} !w-auto shrink-0`} aria-label="Last execution">
          <option value="">Any last execution</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
          <option value="waiting">Waiting</option>
          <option value="running">Running</option>
          <option value="timed_out">Timed out</option>
          <option value="cancelled">Cancelled</option>
          <option value="never">Never run</option>
        </select>
        {filtered && (
          <button
            className="text-[11px] font-semibold text-[#3440a8] hover:underline px-1 shrink-0"
            onClick={() => { setQ(''); setStatus(''); setTrigger(''); setModified(''); setExecution(''); setPage(1); }}
          >
            Clear filters
          </button>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {error ? (
          <ErrorState error={error} title="Couldn't load automations" onRetry={load} />
        ) : !data ? (
          <LoadingState label="Loading automations…" />
        ) : data.items.length === 0 ? (
          <EmptyState
            icon={<Workflow className="w-9 h-9 text-slate-300" />}
            title={filtered ? 'No automations match these filters' : 'No automations yet'}
            description={filtered ? 'Try a different search or filter.' : 'Create an automation to reply, tag contacts or send WhatsApp Flows automatically.'}
            action={!filtered ? (
              <div className="flex gap-2">
                <button className={`${primaryBtn} ${!canCreate ? 'opacity-50 cursor-not-allowed' : ''}`} disabled={!canCreate} title={!canCreate ? 'You do not have permission to create automations' : undefined} onClick={canCreate ? () => onCreate('blank') : undefined}><Plus className="w-3.5 h-3.5" /> Create Automation</button>
                <button className={`${secondaryBtn} ${!canCreate ? 'opacity-50 cursor-not-allowed' : ''}`} disabled={!canCreate} title={!canCreate ? 'You do not have permission to create automations' : undefined} onClick={canCreate ? () => onCreate('example') : undefined}><Sparkles className="w-3.5 h-3.5" /> From example</button>
              </div>
            ) : undefined}
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wider text-slate-400 border-b border-slate-100">
                    <th className="px-4 py-2.5 font-semibold">Automation</th>
                    <th className="px-3 py-2.5 font-semibold">Status</th>
                    <th className="px-3 py-2.5 font-semibold">Trigger</th>
                    <th className="px-3 py-2.5 font-semibold text-center">Nodes</th>
                    <th className="px-3 py-2.5 font-semibold">Last modified</th>
                    <th className="px-3 py-2.5 font-semibold">Last execution</th>
                    <th className="px-3 py-2.5 font-semibold text-right">Executions</th>
                    <th className="px-3 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((a) => {
                    const archived = a.status === 'archived';
                    const busy = busyId === a.id;
                    const TriggerIcon = TRIGGER_ICONS[a.triggerType];
                    return (
                      <tr key={a.id} className={`border-b border-slate-50 hover:bg-slate-50/60 align-top ${busy ? 'opacity-60' : ''}`}>
                        <td className="px-4 py-2.5 max-w-[320px]">
                          <button
                            className="font-semibold text-slate-800 hover:text-[#3440a8] text-left disabled:hover:text-slate-800"
                            onClick={() => onEdit(a.id)}
                            disabled={archived}
                            title={archived ? 'Restore to edit' : 'Open in builder'}
                          >
                            {a.name}
                          </button>
                          {a.description && <div className="text-[11px] text-slate-500 line-clamp-2">{a.description}</div>}
                        </td>
                        <td className="px-3 py-2.5"><StatusBadge status={a.status} /></td>
                        <td className="px-3 py-2.5">
                          <span className={`inline-flex items-center gap-1.5 ${a.triggerType === 'none' ? 'text-amber-600' : 'text-slate-600'}`}>
                            <TriggerIcon className="w-3.5 h-3.5" /> {TRIGGER_LABELS[a.triggerType]}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-center tabular-nums">{a.nodeCount}</td>
                        <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap">{formatDate(a.updatedAt)}</td>
                        <td className="px-3 py-2.5">
                          {a.lastRunStatus ? (
                            <div className="flex flex-col items-start gap-0.5">
                              <StatusBadge status={a.lastRunStatus} />
                              <span className="text-[10px] text-slate-400 whitespace-nowrap">{formatDate(a.lastRunAt)}</span>
                            </div>
                          ) : <span className="text-slate-400">Never run</span>}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">
                          {a.totalRuns > 0 ? (
                            <button className="text-[#3440a8] hover:underline" onClick={() => setHistory(a)}>{a.totalRuns}</button>
                          ) : '0'}
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center justify-end gap-0.5">
                            {!archived && (
                              <button
                                className={`${iconBtn} ${a.isActive ? '!text-emerald-600' : ''}`}
                                title={a.isActive ? 'Pause' : 'Activate'}
                                disabled={busy}
                                onClick={() => toggleActive(a)}
                              >
                                {a.isActive ? <PauseCircle className="w-3.5 h-3.5" /> : <Power className="w-3.5 h-3.5" />}
                              </button>
                            )}
                            {!archived && <button className={`${iconBtn} ${!canUpdate ? 'opacity-40 cursor-not-allowed' : ''}`} disabled={!canUpdate} title={!canUpdate ? 'You do not have permission to update automations' : 'Edit'} onClick={canUpdate ? () => onEdit(a.id) : undefined}><Pencil className="w-3.5 h-3.5" /></button>}
                            <button className={iconBtn} title="Execution history" onClick={() => setHistory(a)}><History className="w-3.5 h-3.5" /></button>
                            <button className={`${iconBtn} ${!canCreate ? 'opacity-40 cursor-not-allowed' : ''}`} title={!canCreate ? 'You do not have permission to create automations' : 'Duplicate'} disabled={busy || !canCreate} onClick={canCreate ? () => run(a.id, () => automationsApi.duplicate(a.id), 'Automation duplicated as a draft') : undefined}>
                              <Copy className="w-3.5 h-3.5" />
                            </button>
                            {archived ? (
                              <button className={iconBtn} title="Restore" disabled={busy} onClick={() => run(a.id, () => automationsApi.restore(a.id), 'Automation restored (paused)')}>
                                <RotateCcw className="w-3.5 h-3.5" />
                              </button>
                            ) : (
                              <button className={`${iconBtn} ${canDelete ? 'hover:!text-red-500' : 'opacity-40 cursor-not-allowed'}`} title={!canDelete ? 'You do not have permission to delete automations' : (a.totalRuns > 0 ? 'Archive' : 'Delete')} disabled={busy || !canDelete} onClick={canDelete ? () => onRemove(a) : undefined}>
                                {a.totalRuns > 0 ? <Archive className="w-3.5 h-3.5" /> : <Trash2 className="w-3.5 h-3.5" />}
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

      {history && <AutomationRunsDrawer automation={history} onClose={() => setHistory(null)} />}
    </div>
  );
}
