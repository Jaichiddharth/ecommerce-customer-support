'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft, Pencil, Eye, RefreshCw, Send, ExternalLink, Ban, Workflow, FileText, Inbox, AlertTriangle, Rocket, Loader2, FlaskConical,
} from 'lucide-react';
import { gooeyToast } from '@/components/ui/goey-toaster';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { notifyError } from '@/lib/api/notify';
import { flowsApi, categoryLabel, type FlowDetails } from './wa-api';
import { StatusBadge, formatDate, iconBtn, primaryBtn, secondaryBtn } from './wa-ui';
import { SendFlowDialog } from './SendFlowDialog';
import { TestFlowDialog } from './TestFlowDialog';

function Card({ title, icon, action, children }: { title: string; icon?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <header className="px-4 py-2.5 border-b border-slate-100 flex items-center gap-2">
        {icon}
        <h2 className="text-[12px] font-bold text-slate-700">{title}</h2>
        <div className="flex-1" />
        {action}
      </header>
      {children}
    </section>
  );
}

export function FlowDetailsPage({
  flowId,
  onBack,
  onEdit,
  onPreview,
  onOpenSubmissions,
  onOpenTemplates,
}: {
  flowId: number;
  onBack: () => void;
  onEdit: (id: number) => void;
  onPreview: (id: number) => void;
  onOpenSubmissions: (id: number) => void;
  onOpenTemplates: (id: number) => void;
}) {
  const [flow, setFlow] = useState<FlowDetails | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [sendOpen, setSendOpen] = useState(false);
  const [testOpen, setTestOpen] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setFlow(await flowsApi.get(flowId));
    } catch (err) {
      setError(err);
    }
  }, [flowId]);

  useEffect(() => { load(); }, [load]);

  const act = async (key: string, fn: () => Promise<FlowDetails | void>, success?: string) => {
    setBusy(key);
    try {
      const res = await fn();
      if (res) setFlow(res);
      if (success) gooeyToast.success(success);
    } catch (err) {
      notifyError(err, { where: 'FlowDetailsPage' });
      load();
    } finally {
      setBusy(null);
    }
  };

  const openPreview = (versionId: number) =>
    act(`preview-${versionId}`, async () => {
      const preview = await flowsApi.preview(flowId, versionId);
      if (preview?.preview_url) window.open(preview.preview_url, '_blank', 'noopener,noreferrer');
      else gooeyToast.info('No preview available for this version yet');
    });

  if (error) return <ErrorState error={error} title="Couldn't load this flow" onRetry={load} className="h-full" />;
  if (!flow) return <LoadingState label="Loading flow…" className="h-full" />;

  const live = flow.versions.find((v) => v.id === flow.publishedVersionId);
  const archived = flow.status === 'archived';

  return (
    <div className="p-5 space-y-4 max-w-[1200px] mx-auto">
      <div className="flex flex-wrap items-center gap-3">
        <button className={iconBtn} onClick={onBack} title="Back to flows"><ArrowLeft className="w-4 h-4" /></button>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-[16px] font-bold text-slate-800 truncate">{flow.name}</h1>
            <StatusBadge status={flow.status} />
          </div>
          <p className="text-[11px] text-slate-500">
            {flow.categories.map(categoryLabel).join(', ')} · Flow JSON {flow.jsonVersion} · {flow.screensCount} screens · updated {formatDate(flow.updatedAt)}
          </p>
        </div>
        <div className="flex-1" />
        <button className={secondaryBtn} onClick={() => act('sync', () => flowsApi.action(flowId, 'sync'), 'Status synced from Meta')} disabled={!!busy}>
          <RefreshCw className={`w-3.5 h-3.5 ${busy === 'sync' ? 'animate-spin' : ''}`} /> Sync status
        </button>
        <button className={secondaryBtn} onClick={() => onPreview(flowId)}><Eye className="w-3.5 h-3.5" /> Preview</button>
        {!archived && <button className={secondaryBtn} onClick={() => onEdit(flowId)}><Pencil className="w-3.5 h-3.5" /> Edit</button>}
        {!archived && flow.hasUnpublishedChanges && (
          <button
            className={secondaryBtn}
            disabled={!!busy}
            onClick={() => window.confirm('Publish the current draft as a new version?') && act('publish', () => flowsApi.action(flowId, 'publish'), 'Flow published')}
          >
            {busy === 'publish' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Rocket className="w-3.5 h-3.5" />} Publish
          </button>
        )}
        <button
          className={secondaryBtn}
          disabled={!live || archived}
          onClick={() => setTestOpen(true)}
          title={live ? 'Send an approved template of this Flow to a WhatsApp number' : 'Publish the Flow first'}
        >
          <FlaskConical className="w-3.5 h-3.5" /> Test Flow
        </button>
        <button className={primaryBtn} disabled={!live || archived} onClick={() => setSendOpen(true)} title={live ? 'Send to a contact' : 'Publish the Flow first'}>
          <Send className="w-3.5 h-3.5" /> Send
        </button>
      </div>

      {!live && !archived && (
        <div className="flex items-start gap-2 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          This Flow has no published version. Publish it before attaching it to a template, an automation, or sending it.
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          ['Live version', live ? `v${live.versionNumber}` : '—'],
          ['Meta Flow ID', live?.metaFlowId ?? '—'],
          ['Templates', String(flow.templates.length)],
          ['Submissions', String(flow.submissionsCount)],
        ].map(([label, value]) => (
          <div key={label} className="bg-white border border-slate-200 rounded-xl px-4 py-3">
            <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-400">{label}</p>
            <p className="text-[14px] font-bold text-slate-800 truncate font-mono">{value}</p>
          </div>
        ))}
      </div>

      <Card title="Versions" icon={<Rocket className="w-3.5 h-3.5 text-[#3440a8]" />}>
        {flow.versions.length === 0 ? (
          <p className="px-4 py-6 text-[12px] text-slate-400 text-center">Not published yet. Each publish creates an immutable version on Meta.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-slate-400 border-b border-slate-100">
                  <th className="px-4 py-2 font-semibold">Version</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                  <th className="px-3 py-2 font-semibold">Meta Flow ID</th>
                  <th className="px-3 py-2 font-semibold">Published</th>
                  <th className="px-3 py-2 font-semibold">Health</th>
                  <th className="px-3 py-2 font-semibold">Notes</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {flow.versions.map((v) => (
                  <tr key={v.id} className="border-b border-slate-50 align-top">
                    <td className="px-4 py-2.5 font-semibold text-slate-700">
                      v{v.versionNumber} {v.id === flow.publishedVersionId && <span className="text-[10px] font-medium text-emerald-600">(live)</span>}
                    </td>
                    <td className="px-3 py-2.5"><StatusBadge status={v.status} /></td>
                    <td className="px-3 py-2.5 font-mono text-[10px] text-slate-500">{v.metaFlowId ?? '—'}</td>
                    <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap">{formatDate(v.publishedAt)}</td>
                    <td className="px-3 py-2.5 text-slate-500">{v.healthStatus?.can_send_message ?? '—'}</td>
                    <td className="px-3 py-2.5 text-[11px] text-red-500 max-w-xs">
                      {v.lastError}
                      {v.validationErrors.length > 0 && (
                        <ul className="list-disc pl-4 mt-0.5">
                          {v.validationErrors.slice(0, 5).map((e, i) => <li key={i}>{e.message || e.error}{e.line_start ? ` (line ${e.line_start})` : ''}</li>)}
                        </ul>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center justify-end gap-0.5">
                        {v.metaFlowId && (
                          <button className={iconBtn} title="Open Meta web preview" disabled={!!busy} onClick={() => openPreview(v.id)}>
                            <ExternalLink className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {(v.status === 'published' || v.status === 'throttled') && (
                          <button
                            className={`${iconBtn} hover:!text-red-500`}
                            title="Deprecate (irreversible)"
                            disabled={!!busy}
                            onClick={() =>
                              window.confirm(`Deprecate v${v.versionNumber}? Customers can no longer open it and templates using it stop working. This cannot be undone.`) &&
                              act(`dep-${v.id}`, () => flowsApi.deprecate(flowId, v.id), 'Version deprecated')
                            }
                          >
                            <Ban className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card
          title="Message templates"
          icon={<FileText className="w-3.5 h-3.5 text-[#3440a8]" />}
          action={<button className="text-[11px] font-semibold text-[#3440a8] hover:underline" onClick={() => onOpenTemplates(flowId)}>Manage</button>}
        >
          {flow.templates.length === 0 ? (
            <p className="px-4 py-5 text-[12px] text-slate-400 text-center">No templates open this Flow yet.</p>
          ) : (
            <ul className="divide-y divide-slate-50">
              {flow.templates.map((t) => (
                <li key={t.id} className="px-4 py-2.5 flex items-center gap-2 text-[12px]">
                  <span className="font-semibold text-slate-700">{t.name}</span>
                  <span className="text-[10px] text-slate-400">{t.language} · {t.category.toLowerCase()} · v{t.versionNumber ?? '?'}</span>
                  <div className="flex-1" />
                  <StatusBadge status={t.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Automations" icon={<Workflow className="w-3.5 h-3.5 text-[#3440a8]" />}>
          {flow.automations.length === 0 ? (
            <p className="px-4 py-5 text-[12px] text-slate-400 text-center">No automation sends this Flow. Add a “Send WhatsApp Flow” action in the Automation Builder.</p>
          ) : (
            <ul className="divide-y divide-slate-50">
              {flow.automations.map((a) => (
                <li key={a.id} className="px-4 py-2.5 flex items-center gap-2 text-[12px]">
                  <span className="font-semibold text-slate-700">{a.name}</span>
                  <span className="text-[10px] text-slate-400">{a.nodeIds.length} step{a.nodeIds.length > 1 ? 's' : ''}</span>
                  <div className="flex-1" />
                  <StatusBadge status={a.isActive ? 'running' : 'draft'} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card
        title="Submissions"
        icon={<Inbox className="w-3.5 h-3.5 text-[#3440a8]" />}
        action={<button className="text-[11px] font-semibold text-[#3440a8] hover:underline" onClick={() => onOpenSubmissions(flowId)}>View all</button>}
      >
        <p className="px-4 py-4 text-[12px] text-slate-500">
          {flow.submissionsCount} customer response{flow.submissionsCount === 1 ? '' : 's'} received for this Flow.
        </p>
      </Card>

      {sendOpen && live && (
        <SendFlowDialog
          flowId={flowId}
          flowName={flow.name}
          templates={flow.templates}
          onClose={() => setSendOpen(false)}
          onSent={() => { setSendOpen(false); gooeyToast.success('Flow sent'); }}
        />
      )}

      {testOpen && live && (
        <TestFlowDialog flowId={flowId} flowName={flow.name} templates={flow.templates} onClose={() => setTestOpen(false)} />
      )}
    </div>
  );
}
