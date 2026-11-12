'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { templatesApi, type WaTemplate } from './wa-api';
import { usePublishedFlows } from '../use-published-flows';
import { VariableInput } from '../VariableInput';

/** Field wrapper the host form provides; `name` lets it show that field's validation error. */
export type FieldLikeProps = { label: string; children: React.ReactNode; name?: string; required?: boolean; hint?: string };

/**
 * Config fields for the Automation Builder's "Send WhatsApp Flow" action.
 * Only published Flows are offered; template delivery only offers APPROVED templates that open
 * the selected Flow. Server-side activation re-validates all of this.
 */
export function SendWhatsAppFlowFields({
  local,
  set,
  inputCls,
  Field,
}: {
  local: Record<string, unknown>;
  set: (k: string, v: unknown) => void;
  inputCls: string;
  Field: React.FC<FieldLikeProps>;
}) {
  const { flows, failed: loadFailed } = usePublishedFlows();
  const [templates, setTemplates] = useState<WaTemplate[]>([]);

  useEffect(() => {
    templatesApi.list({ status: 'APPROVED' }).then(setTemplates).catch(() => setTemplates([]));
  }, []);

  const flowId = Number(local.flowId) || '';
  const method = local.sendMethod === 'interactive' ? 'interactive' : 'template';
  const flowTemplates = useMemo(() => templates.filter((t) => t.flowId === flowId), [templates, flowId]);
  const selectedTemplate = flowTemplates.find((t) => t.id === Number(local.templateId));

  const hint = (text: string, warn = false) => (
    <p className={`text-[10px] ${warn ? 'text-amber-600' : 'text-slate-400'} flex items-start gap-1`}>
      {warn && <AlertTriangle className="w-3 h-3 shrink-0 mt-px" />}
      {text}
    </p>
  );

  if (!flows) {
    return <p className="flex items-center gap-2 text-[12px] text-slate-400"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading published flows…</p>;
  }

  return (
    <>
      <Field label="WhatsApp Flow" name="flowId" required>
        <select
          value={flowId}
          onChange={(e) => {
            const id = Number(e.target.value) || '';
            const f = flows.find((x) => x.id === id);
            set('flowId', id || undefined);
            set('flowName', f?.name);
            set('templateId', undefined);
          }}
          className={inputCls}
        >
          <option value="">Select a published flow…</option>
          {flows.map((f) => <option key={f.id} value={f.id}>{f.name} (v{f.publishedVersion?.versionNumber})</option>)}
        </select>
        {loadFailed
          ? hint("Couldn't load flows. Check your connection and reopen this panel.", true)
          : flows.length === 0 && hint('No published Flows yet. Publish one under WhatsApp Flows first.', true)}
      </Field>

      <Field label="Sending method" required>
        <select value={method} onChange={(e) => set('sendMethod', e.target.value)} className={inputCls}>
          <option value="template">Approved template (any time)</option>
          <option value="interactive">Interactive message (within 24h)</option>
        </select>
        {method === 'interactive'
          ? hint('Allowed only within 24 hours of the customer’s last message. Message triggers always meet this.')
          : hint('Works outside the 24-hour window. The template must open this Flow.')}
      </Field>

      {method === 'template' ? (
        <Field label="Template" name="templateId" required>
          <select
            value={Number(local.templateId) || ''}
            onChange={(e) => {
              const t = flowTemplates.find((x) => x.id === Number(e.target.value));
              set('templateId', t?.id);
              set('templateName', t?.name);
            }}
            className={inputCls}
            disabled={!flowId}
          >
            <option value="">{flowId ? 'Select an approved template…' : 'Choose a flow first'}</option>
            {flowTemplates.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.language})</option>)}
          </select>
          {!!flowId && flowTemplates.length === 0 && hint('No approved template opens this Flow. Create one under WhatsApp Flows → Flow templates.', true)}
          {selectedTemplate?.versionNumber && hint(`Opens version ${selectedTemplate.versionNumber} of the Flow.`)}
        </Field>
      ) : (
        <>
          <Field label="Message text" name="flowBody" required>
            <VariableInput
              multiline
              rows={3}
              value={String(local.flowBody ?? '')}
              onChange={(v) => set('flowBody', v)}
              className={inputCls}
              placeholder="Hi {{contact.name}}, please fill in this short form."
            />
          </Field>
          <Field label="Button text (CTA)" name="flowCta" required>
            <input value={String(local.flowCta ?? '')} onChange={(e) => set('flowCta', e.target.value)} maxLength={30} className={inputCls} placeholder="Open form" />
          </Field>
        </>
      )}

      <Field label="Recipient">
        <input value="Contact who triggered this automation" disabled className={`${inputCls} text-slate-500`} />
      </Field>

      <Field label="Response window (hours)">
        <input
          type="number"
          min={1}
          max={720}
          value={Number(local.expiresInHours ?? 24)}
          onChange={(e) => set('expiresInHours', Number(e.target.value))}
          className={inputCls}
        />
        {hint('How long the customer can submit the form. A Wait for Flow Submission step after this one waits exactly this long.')}
      </Field>
    </>
  );
}
