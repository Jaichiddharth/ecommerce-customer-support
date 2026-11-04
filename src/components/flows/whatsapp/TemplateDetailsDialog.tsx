'use client';

import React from 'react';
import { FlaskConical, RefreshCw, RotateCcw, Trash2, ExternalLink, AlertTriangle, MousePointerClick, Workflow } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { WhatsAppChatPreview } from '@/components/templates/WhatsAppChatPreview';
import { type WaTemplate } from './wa-api';
import { StatusBadge, formatDate, primaryBtn, secondaryBtn } from './wa-ui';
import { TEMPLATE_LANGUAGES } from './CreateFlowTemplateDialog';

function Row({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <dt className="text-[11px] text-slate-400 shrink-0">{label}</dt>
      <dd className={`text-[11px] text-slate-700 font-medium text-right min-w-0 break-all ${mono ? 'font-mono text-[10px]' : ''}`}>{children}</dd>
    </div>
  );
}

/** Template details: review status, the Flow it opens (version + Meta Flow ID), its button, and a preview. */
export function TemplateDetailsDialog({
  template: t,
  busy,
  onClose,
  onOpenFlow,
  onTest,
  onSync,
  onRetry,
  onDelete,
}: {
  template: WaTemplate;
  busy: boolean;
  onClose: () => void;
  onOpenFlow: (flowId: number) => void;
  onTest: () => void;
  onSync: () => void;
  onRetry: () => void;
  onDelete: () => void;
}) {
  const language = TEMPLATE_LANGUAGES.find(([v]) => v === t.language)?.[1] ?? t.language;
  const versionGone = !!t.versionStatus && t.versionStatus !== 'published' && t.versionStatus !== 'throttled';

  return (
    <Modal isOpen onClose={onClose} title={<span className="font-mono">{t.name}</span>} maxWidth="3xl">
      <div className="grid md:grid-cols-[minmax(0,1fr)_300px] gap-5">
        <div className="space-y-4 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={t.status} />
            <span className="text-[11px] text-slate-500">{language} · {t.category.toLowerCase()}</span>
          </div>

          {t.status !== 'APPROVED' && (
            <p className="text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
              Only approved templates can be sent, tested or used in automations.
            </p>
          )}
          {t.rejectionReason && (
            <p className="flex items-start gap-1.5 text-[11px] text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" /> {t.rejectionReason}
            </p>
          )}
          {t.lastError && (
            <p className="flex items-start gap-1.5 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" /> {t.lastError}
            </p>
          )}

          <section className="rounded-xl border border-slate-200 px-3 py-2">
            <h4 className="flex items-center gap-1.5 text-[11px] font-bold text-slate-700 pb-1">
              <Workflow className="w-3.5 h-3.5 text-[#3440a8]" /> WhatsApp Flow
            </h4>
            <dl className="divide-y divide-slate-50">
              <Row label="Flow">
                {t.flowId ? (
                  <button className="text-[#3440a8] hover:underline inline-flex items-center gap-1" onClick={() => onOpenFlow(t.flowId!)}>
                    {t.flowName ?? `Flow #${t.flowId}`} <ExternalLink className="w-3 h-3" />
                  </button>
                ) : '—'}
              </Row>
              <Row label="Version">
                {t.versionNumber ? `v${t.versionNumber}` : '—'}
                {t.versionStatus && <StatusBadge status={t.versionStatus} className="ml-1.5" />}
              </Row>
              <Row label="Meta Flow ID" mono>{t.metaFlowId ?? '—'}</Row>
            </dl>
            {versionGone && (
              <p className="text-[10px] text-amber-600 pb-1.5">This template opens a Flow version that is no longer published, so it can’t open the Flow.</p>
            )}
          </section>

          <section className="rounded-xl border border-slate-200 px-3 py-2">
            <h4 className="flex items-center gap-1.5 text-[11px] font-bold text-slate-700 pb-1">
              <MousePointerClick className="w-3.5 h-3.5 text-[#3440a8]" /> Button
            </h4>
            <dl className="divide-y divide-slate-50">
              <Row label="Type">WhatsApp Flow</Row>
              <Row label="Text">{t.flowButton?.text ?? '—'}</Row>
              <Row label="Flow action">{t.flowButton?.flowAction ?? '—'}</Row>
              <Row label="Starting screen" mono>{t.flowButton?.navigateScreen ?? '—'}</Row>
            </dl>
          </section>

          <dl className="divide-y divide-slate-50 px-1">
            <Row label="Meta template ID" mono>{t.metaTemplateId ?? 'Not submitted'}</Row>
            <Row label="Created">{formatDate(t.createdAt)}</Row>
            <Row label="Last status sync">{formatDate(t.lastSyncedAt)}</Row>
          </dl>
        </div>

        <div>
          <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-400 mb-2">Preview</p>
          <WhatsAppChatPreview
            headerType={t.headerText ? 'TEXT' : 'NONE'}
            headerText={t.headerText ?? ''}
            bodyText={t.bodyText}
            footerText={t.footerText ?? ''}
            buttons={t.flowButton ? [{ id: 'flow', type: 'FLOW', text: t.flowButton.text }] : []}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-4 border-t border-slate-100">
        <button className={`${secondaryBtn} hover:!text-red-600 hover:!border-red-200`} onClick={onDelete} disabled={busy}>
          <Trash2 className="w-3.5 h-3.5" /> Delete
        </button>
        <div className="flex-1" />
        {t.status === 'SUBMISSION_FAILED' ? (
          <button className={secondaryBtn} onClick={onRetry} disabled={busy}><RotateCcw className="w-3.5 h-3.5" /> Retry submission</button>
        ) : (
          <button className={secondaryBtn} onClick={onSync} disabled={busy || !t.metaTemplateId}>
            <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} /> Sync status
          </button>
        )}
        <button
          className={primaryBtn}
          onClick={onTest}
          disabled={t.status !== 'APPROVED' || !t.flowId || versionGone}
          title={t.status === 'APPROVED' ? 'Send this template to a WhatsApp number' : 'Only approved templates can be tested'}
        >
          <FlaskConical className="w-3.5 h-3.5" /> Test Flow
        </button>
      </div>
    </Modal>
  );
}
