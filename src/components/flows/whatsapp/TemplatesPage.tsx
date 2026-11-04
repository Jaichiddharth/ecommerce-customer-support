'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Plus, RefreshCw, Trash2, RotateCcw, FileText, MousePointerClick, FlaskConical } from 'lucide-react';
import { gooeyToast } from '@/components/ui/goey-toaster';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { notifyError } from '@/lib/api/notify';
import { templatesApi, type WaTemplate } from './wa-api';
import { StatusBadge, formatDate, iconBtn, inputCls, primaryBtn } from './wa-ui';
import { CreateFlowTemplateDialog } from './CreateFlowTemplateDialog';
import { TemplateDetailsDialog } from './TemplateDetailsDialog';
import { TestFlowDialog } from './TestFlowDialog';

export function TemplatesPage({ flowFilter, onOpenFlow }: { flowFilter?: number; onOpenFlow: (id: number) => void }) {
  const [templates, setTemplates] = useState<WaTemplate[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [detailsId, setDetailsId] = useState<number | null>(null);
  const [testing, setTesting] = useState<WaTemplate | null>(null);
  const details = templates?.find((t) => t.id === detailsId) ?? null;

  const load = useCallback(async () => {
    setError(null);
    try {
      setTemplates(await templatesApi.list({ flowId: flowFilter, status: statusFilter || undefined }));
    } catch (err) {
      setError(err);
    }
  }, [flowFilter, statusFilter]);

  useEffect(() => { load(); }, [load]);

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
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={`${inputCls} w-auto`}>
          <option value="">All statuses</option>
          {['APPROVED', 'PENDING', 'REJECTED', 'PAUSED', 'DISABLED', 'SUBMISSION_FAILED'].map((s) => <option key={s} value={s}>{s.replace('_', ' ').toLowerCase()}</option>)}
        </select>
        <button className={primaryBtn} onClick={() => setCreating(true)}><Plus className="w-3.5 h-3.5" /> Create template</button>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {error ? (
          <ErrorState error={error} title="Couldn't load templates" onRetry={load} />
        ) : !templates ? (
          <LoadingState label="Loading templates…" />
        ) : templates.length === 0 ? (
          <EmptyState
            icon={<FileText className="w-9 h-9 text-slate-300" />}
            title="No Flow templates yet"
            description="Create a template with a WhatsApp Flow button to send a published Flow to customers at any time."
            action={<button className={primaryBtn} onClick={() => setCreating(true)}><Plus className="w-3.5 h-3.5" /> Create template</button>}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-slate-400 border-b border-slate-100">
                  <th className="px-4 py-2.5 font-semibold">Template</th>
                  <th className="px-3 py-2.5 font-semibold">Review status</th>
                  <th className="px-3 py-2.5 font-semibold">Flow</th>
                  <th className="px-3 py-2.5 font-semibold">Button</th>
                  <th className="px-3 py-2.5 font-semibold">Updated</th>
                  <th className="px-3 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {templates.map((t) => (
                  <tr key={t.id} className={`border-b border-slate-50 align-top hover:bg-slate-50/60 ${busyId === t.id ? 'opacity-60' : ''}`}>
                    <td className="px-4 py-2.5">
                      <button className="font-semibold text-slate-800 hover:text-[#3440a8] hover:underline text-left" onClick={() => setDetailsId(t.id)}>
                        {t.name}
                      </button>
                      <div className="text-[10px] text-slate-400">{t.language} · {t.category.toLowerCase()}</div>
                      <div className="text-[11px] text-slate-500 mt-1 line-clamp-2 max-w-sm">{t.bodyText}</div>
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusBadge status={t.status} />
                      {t.rejectionReason && <p className="text-[10px] text-red-500 mt-1 max-w-[220px]">{t.rejectionReason}</p>}
                      {t.lastError && <p className="text-[10px] text-amber-600 mt-1 max-w-[220px]">{t.lastError}</p>}
                    </td>
                    <td className="px-3 py-2.5">
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
                    </td>
                    <td className="px-3 py-2.5">
                      {t.flowButton ? (
                        <span className="inline-flex items-center gap-1 text-slate-600">
                          <MousePointerClick className="w-3 h-3" /> {t.flowButton.text}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap">{formatDate(t.updatedAt)}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center justify-end gap-0.5">
                        {canTest(t) && (
                          <button className={`${iconBtn} hover:!text-[#3440a8]`} title="Test Flow: send to a WhatsApp number" disabled={busyId === t.id} onClick={() => setTesting(t)}>
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
                        <button
                          className={`${iconBtn} hover:!text-red-500`}
                          title="Delete template"
                          disabled={busyId === t.id}
                          onClick={() => remove(t)}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

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
          onTest={() => setTesting(details)}
          onSync={() => sync(details)}
          onRetry={() => retry(details)}
          onDelete={() => remove(details)}
        />
      )}

      {testing && (
        <TestFlowDialog
          flowId={testing.flowId!}
          flowName={testing.flowName ?? testing.name}
          templates={(templates ?? []).filter((x) => x.flowId === testing.flowId)}
          defaultTemplateId={testing.id}
          onClose={() => setTesting(null)}
        />
      )}
    </div>
  );
}
