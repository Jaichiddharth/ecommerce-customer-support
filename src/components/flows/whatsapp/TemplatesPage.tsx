'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, RefreshCw, Trash2, RotateCcw, FileText, Loader2, MousePointerClick } from 'lucide-react';
import { gooeyToast } from '@/components/ui/goey-toaster';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { Modal } from '@/components/ui/Modal';
import { notifyError } from '@/lib/api/notify';
import { flowsApi, templatesApi, type PublishedFlowOption, type WaTemplate } from './wa-api';
import { FieldLabel, StatusBadge, formatDate, iconBtn, inputCls, primaryBtn, secondaryBtn } from './wa-ui';

const LANGUAGES = [
  ['en_US', 'English (US)'], ['en_GB', 'English (UK)'], ['en', 'English'], ['hi', 'Hindi'], ['ta', 'Tamil'],
  ['es', 'Spanish'], ['pt_BR', 'Portuguese (BR)'], ['fr', 'French'], ['de', 'German'], ['ar', 'Arabic'], ['id', 'Indonesian'],
] as const;

export function TemplatesPage({ flowFilter, onOpenFlow }: { flowFilter?: number; onOpenFlow: (id: number) => void }) {
  const [templates, setTemplates] = useState<WaTemplate[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');

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
                  <tr key={t.id} className={`border-b border-slate-50 align-top ${busyId === t.id ? 'opacity-60' : ''}`}>
                    <td className="px-4 py-2.5">
                      <div className="font-semibold text-slate-800">{t.name}</div>
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
                        {t.status === 'SUBMISSION_FAILED' ? (
                          <button className={iconBtn} title="Retry submission" disabled={busyId === t.id} onClick={() => run(t.id, () => templatesApi.retry(t.id), 'Template submitted')}>
                            <RotateCcw className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                          <button className={iconBtn} title="Sync review status" disabled={busyId === t.id || !t.metaTemplateId} onClick={() => run(t.id, () => templatesApi.sync(t.id), 'Status synced')}>
                            <RefreshCw className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          className={`${iconBtn} hover:!text-red-500`}
                          title="Delete template"
                          disabled={busyId === t.id}
                          onClick={() => window.confirm(`Delete template "${t.name}" from WhatsApp? Automations using it will stop sending.`) && run(t.id, () => templatesApi.remove(t.id), 'Template deleted')}
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
        <CreateTemplateDialog
          defaultFlowId={flowFilter}
          onClose={() => setCreating(false)}
          onCreated={() => { setCreating(false); gooeyToast.success('Template submitted for review'); load(); }}
        />
      )}
    </div>
  );
}

function CreateTemplateDialog({ defaultFlowId, onClose, onCreated }: { defaultFlowId?: number; onClose: () => void; onCreated: () => void }) {
  const [flows, setFlows] = useState<PublishedFlowOption[] | null>(null);
  const [flowId, setFlowId] = useState<number | ''>(defaultFlowId ?? '');
  const [name, setName] = useState('');
  const [language, setLanguage] = useState('en_US');
  const [category, setCategory] = useState<'MARKETING' | 'UTILITY'>('UTILITY');
  const [headerText, setHeaderText] = useState('');
  const [bodyText, setBodyText] = useState('');
  const [footerText, setFooterText] = useState('');
  const [buttonText, setButtonText] = useState('Open form');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    flowsApi.published().then((list) => {
      const eligible = list.filter((f) => f.publishedVersion?.metaFlowId);
      setFlows(eligible);
      if (!defaultFlowId && eligible[0]) setFlowId(eligible[0].id);
    }).catch((err) => { notifyError(err, { where: 'CreateTemplateDialog' }); setFlows([]); });
  }, [defaultFlowId]);

  const flow = useMemo(() => flows?.find((f) => f.id === flowId) ?? null, [flows, flowId]);
  const nameValid = /^[a-z0-9_]+$/.test(name);
  const canSave = !!flow && nameValid && bodyText.trim() && buttonText.trim() && !saving;

  const submit = async () => {
    if (!flow) return;
    setSaving(true);
    try {
      await templatesApi.create({
        name,
        language,
        category,
        bodyText: bodyText.trim(),
        headerText: headerText.trim() || undefined,
        footerText: footerText.trim() || undefined,
        flowId: flow.id,
        buttonText: buttonText.trim(),
      });
      onCreated();
    } catch (err) {
      notifyError(err, { where: 'CreateTemplateDialog', title: 'Template not created' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title="New template with a WhatsApp Flow button" maxWidth="2xl">
      {!flows ? (
        <LoadingState label="Loading published flows…" compact />
      ) : flows.length === 0 ? (
        <EmptyState compact title="No published Flows" description="A Flow must be published before it can be attached to a template." />
      ) : (
        <div className="grid md:grid-cols-[1fr_240px] gap-5">
          <div className="space-y-3.5">
            <div className="grid grid-cols-2 gap-3">
              <FieldLabel label="Template name" hint="Lowercase letters, numbers and underscores.">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value.toLowerCase().replace(/\s+/g, '_'))}
                  placeholder="order_details_form"
                  className={`${inputCls} font-mono ${name && !nameValid ? 'border-red-300' : ''}`}
                  maxLength={512}
                />
              </FieldLabel>
              <FieldLabel label="Language">
                <select value={language} onChange={(e) => setLanguage(e.target.value)} className={inputCls}>
                  {LANGUAGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </FieldLabel>
            </div>
            <FieldLabel label="Category" hint="Meta may re-categorise a template during review.">
              <select value={category} onChange={(e) => setCategory(e.target.value as 'MARKETING' | 'UTILITY')} className={inputCls}>
                <option value="UTILITY">Utility</option>
                <option value="MARKETING">Marketing</option>
              </select>
            </FieldLabel>
            <FieldLabel label="Header (optional)">
              <input value={headerText} onChange={(e) => setHeaderText(e.target.value)} maxLength={60} className={inputCls} />
            </FieldLabel>
            <FieldLabel label="Body" hint={`${bodyText.length}/1024 · variables aren't supported in Flow templates here.`}>
              <textarea value={bodyText} onChange={(e) => setBodyText(e.target.value)} maxLength={1024} rows={4} className={`${inputCls} resize-none`} placeholder="Tell us a few details so we can complete your order." />
            </FieldLabel>
            <FieldLabel label="Footer (optional)">
              <input value={footerText} onChange={(e) => setFooterText(e.target.value)} maxLength={60} className={inputCls} />
            </FieldLabel>

            <div className="rounded-xl border border-[#3440a8]/20 bg-[#3440a8]/[0.03] p-3 space-y-3">
              <p className="text-[11px] font-bold text-slate-700">WhatsApp Flow button</p>
              <FieldLabel label="Flow" hint="Only published Flows can be attached. The template pins the current live version.">
                <select value={flowId} onChange={(e) => setFlowId(Number(e.target.value))} className={inputCls}>
                  {flows.map((f) => <option key={f.id} value={f.id}>{f.name} (v{f.publishedVersion?.versionNumber})</option>)}
                </select>
              </FieldLabel>
              <div className="grid grid-cols-2 gap-3">
                <FieldLabel label="Button text" hint={`${buttonText.length}/25`}>
                  <input value={buttonText} onChange={(e) => setButtonText(e.target.value)} maxLength={25} className={inputCls} />
                </FieldLabel>
                <FieldLabel label="Flow action">
                  <input value="Navigate" disabled className={`${inputCls} bg-slate-50 text-slate-500`} />
                </FieldLabel>
              </div>
              <FieldLabel label="Starting screen" hint="Static Flows open on their entry (first) screen.">
                <input value={flow?.publishedVersion?.entryScreen ?? ''} disabled className={`${inputCls} bg-slate-50 font-mono text-slate-500`} />
              </FieldLabel>
              <p className="text-[10px] text-slate-400">A unique flow token is generated each time the template is sent, so every response is matched to its customer.</p>
            </div>
          </div>

          {/* Preview */}
          <div>
            <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-400 mb-2">Preview</p>
            <div className="rounded-2xl bg-[#efeae2] p-3">
              <div className="bg-white rounded-lg shadow-sm p-2.5 space-y-1.5">
                {headerText && <p className="text-[12px] font-bold text-slate-800">{headerText}</p>}
                <p className="text-[12px] text-slate-700 whitespace-pre-wrap">{bodyText || 'Message body…'}</p>
                {footerText && <p className="text-[10px] text-slate-400">{footerText}</p>}
                <div className="border-t border-slate-100 pt-1.5 text-center text-[12px] font-semibold text-[#00a5f4]">{buttonText || 'Button'}</div>
              </div>
            </div>
          </div>
        </div>
      )}
      <div className="flex justify-end gap-2 pt-4">
        <button className={secondaryBtn} onClick={onClose}>Cancel</button>
        <button className={primaryBtn} onClick={submit} disabled={!canSave}>
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null} Submit for review
        </button>
      </div>
    </Modal>
  );
}
