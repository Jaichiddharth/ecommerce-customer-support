'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import apiClient from '@/lib/api/client';
import { toApiError } from '@/lib/api/api-error';
import type { WhatsAppTemplate } from '@/types/templates';
import {
  buildTemplateSendComponents,
  getTemplateSendBlocker,
  getTemplateSendFields,
  renderTemplateMessage,
} from '@/lib/whatsapp-templates';
import { VariableInput } from './VariableInput';
import type { FieldLikeProps } from './whatsapp/AutomationFlowFields';

/** Approved templates, loaded once per page. */
let cache: Promise<WhatsAppTemplate[]> | null = null;

function loadTemplates(): Promise<WhatsAppTemplate[]> {
  cache ??= apiClient
    .get('/api/channels/whatsapp/templates', { params: { status: 'APPROVED' } })
    .then((res) => {
      if (res.data?.connected === false) throw new Error('No WhatsApp number is connected.');
      if (res.data?.error) throw new Error(res.data.error);
      return ((res.data?.templates ?? []) as WhatsAppTemplate[])
        .filter((t) => t.status?.toUpperCase() === 'APPROVED')
        .sort((a, b) => a.name.localeCompare(b.name));
    })
    .catch((err) => {
      cache = null;
      throw err;
    });
  return cache;
}

/** Why an automation can't send `tpl`, or null. Flow templates go through Send WhatsApp Flow (tracked responses). */
function automationBlocker(tpl: WhatsAppTemplate): string | null {
  const blocker = getTemplateSendBlocker(tpl);
  if (blocker) return blocker;
  const buttons = tpl.components?.find((c) => c.type === 'BUTTONS')?.buttons ?? [];
  if (buttons.some((b) => b.type === 'FLOW')) return 'Opens a WhatsApp Flow: use the Send WhatsApp Flow step.';
  if (getTemplateSendFields(tpl).some((f) => f.kind === 'header_media')) return 'Has a media header, not supported in automations yet.';
  return null;
}

const keyOf = (t: { name: string; language: string }) => `${t.name}|${t.language}`;

/** Config fields for Send Template: pick an approved template, then fill each of its variables. */
export function TemplateFields({
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
  const [templates, setTemplates] = useState<WhatsAppTemplate[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    loadTemplates()
      .then((list) => alive && setTemplates(list))
      .catch((err) => {
        if (!alive) return;
        setTemplates([]);
        setError(toApiError(err).message);
      });
    return () => {
      alive = false;
    };
  }, []);

  const { usable, hidden } = useMemo(() => {
    const usable: WhatsAppTemplate[] = [];
    let hidden = 0;
    for (const t of templates ?? []) {
      if (automationBlocker(t)) hidden++;
      else usable.push(t);
    }
    return { usable, hidden };
  }, [templates]);

  const selectedKey = local.templateName ? keyOf({ name: String(local.templateName), language: String(local.templateLanguage ?? '') }) : '';
  const selected = usable.find((t) => keyOf(t) === selectedKey) ?? null;
  const values = (local.templateValues && typeof local.templateValues === 'object' ? local.templateValues : {}) as Record<string, string>;
  const fields = useMemo(() => (selected ? getTemplateSendFields(selected).filter((f) => f.kind !== 'header_media') : []), [selected]);

  /** Stores everything the engine needs, so runs never have to fetch the template from Meta. */
  const commit = (tpl: WhatsAppTemplate, nextValues: Record<string, string>) => {
    const ids = getTemplateSendFields(tpl).map((f) => f.id);
    const kept = Object.fromEntries(ids.map((id) => [id, nextValues[id] ?? '']));
    set('templateName', tpl.name);
    set('templateLanguage', tpl.language);
    set('templateId', undefined); // older steps stored a typed name here
    set('templateFieldIds', ids);
    set('templateValues', kept);
    set('templateComponents', buildTemplateSendComponents(tpl, kept));
    set('templatePreview', renderTemplateMessage(tpl, kept));
    set(
      'templateButtons',
      (tpl.components?.find((c) => c.type === 'BUTTONS')?.buttons ?? []).map((b) => ({ type: b.type, text: b.text })),
    );
  };

  if (!templates) {
    return <p className="flex items-center gap-2 text-[12px] text-slate-400"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading approved templates…</p>;
  }

  const warn = (text: string) => (
    <p className="text-[10.5px] text-amber-600 flex items-start gap-1">
      <AlertTriangle className="w-3 h-3 shrink-0 mt-px" />
      {text}
    </p>
  );

  return (
    <>
      <Field label="Template" name="templateName" required>
        <select
          value={selected ? selectedKey : ''}
          onChange={(e) => {
            const tpl = usable.find((t) => keyOf(t) === e.target.value);
            if (tpl) commit(tpl, {});
          }}
          className={inputCls}
        >
          <option value="">Select an approved template…</option>
          {usable.map((t) => (
            <option key={keyOf(t)} value={keyOf(t)}>{t.name} ({t.language})</option>
          ))}
        </select>
        {error && warn(error)}
        {!error && usable.length === 0 && warn('No approved templates an automation can send. Create one under Templates.')}
        {hidden > 0 && (
          <p className="text-[10.5px] text-slate-400">
            {hidden} template{hidden === 1 ? '' : 's'} not listed: media headers aren’t supported yet, and Flow templates are sent with Send WhatsApp Flow.
          </p>
        )}
        {!selected && selectedKey && warn(`“${String(local.templateName)}” is no longer approved or available. Choose another template.`)}
        {!selected && !selectedKey && !!local.templateId && warn(`This step used the typed name “${String(local.templateId)}”. Choose it from the list so its language and variables are sent correctly.`)}
      </Field>

      {selected && fields.length > 0 && (
        <Field label="Template variables" name="templateValues" required hint="Type a fixed value or insert a variable. Every value must be filled for each contact.">
          <div className="space-y-2.5">
            {fields.map((f) => (
              <div key={f.id} className="space-y-1">
                <label className="text-[11px] text-slate-600">
                  {f.label}
                  {f.example && <span className="text-slate-400"> · e.g. {f.example}</span>}
                </label>
                <VariableInput
                  value={values[f.id] ?? ''}
                  onChange={(v) => commit(selected, { ...values, [f.id]: v })}
                  placeholder={f.kind === 'button_url' ? 'Rest of the link' : f.kind === 'coupon_code' ? 'Coupon code' : '{{contact.name}}'}
                  className={inputCls}
                />
              </div>
            ))}
          </div>
        </Field>
      )}

      {selected && (
        <Field label="Preview">
          <p className="whitespace-pre-wrap break-words text-[12px] text-slate-700 bg-[#f0fdf4] border border-emerald-100 rounded-lg px-3 py-2.5">
            {renderTemplateMessage(selected, values)}
          </p>
        </Field>
      )}
    </>
  );
}
