'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, FileText, Film, Image as ImageIcon, Loader2 } from 'lucide-react';
import apiClient from '@/lib/api/client';
import { toApiError } from '@/lib/api/api-error';
import { isMediaHeader, type MediaHeaderType, type WhatsAppTemplate } from '@/types/templates';
import {
  buildTemplateSendComponents,
  getTemplateSendBlocker,
  getTemplateSendFields,
  renderTemplateMessage,
} from '@/lib/whatsapp-templates';
import type { FieldLikeProps } from './whatsapp/AutomationFlowFields';

/** Approved templates from the Templates page's source; loaded each time the step opens so new ones show up. */
async function loadTemplates(): Promise<WhatsAppTemplate[]> {
  const res = await apiClient.get('/api/channels/whatsapp/templates', { params: { status: 'APPROVED' } });
  if (res.data?.connected === false) throw new Error('No WhatsApp number is connected.');
  if (res.data?.error) throw new Error(res.data.error);
  return ((res.data?.templates ?? []) as WhatsAppTemplate[])
    .filter((t) => t.status?.toUpperCase() === 'APPROVED')
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Why an automation can't send `tpl`, or null. Templates with variables are left out: an automation
 * has nothing to fill them with. Flow templates go through Send WhatsApp Flow (tracked responses).
 */
function automationBlocker(tpl: WhatsAppTemplate): string | null {
  const blocker = getTemplateSendBlocker(tpl);
  if (blocker) return blocker;
  const buttons = tpl.components?.find((c) => c.type === 'BUTTONS')?.buttons ?? [];
  if (buttons.some((b) => b.type === 'FLOW')) return 'Opens a WhatsApp Flow: use the Send WhatsApp Flow step.';
  if (getTemplateSendFields(tpl).some((f) => f.kind !== 'header_media')) return 'Has variables, which an automation can’t fill.';
  return null;
}

/** The template's image/video/document header format, if it has one. */
function mediaHeaderOf(tpl: WhatsAppTemplate): MediaHeaderType | null {
  const format = tpl.components?.find((c) => c.type === 'HEADER')?.format;
  return isMediaHeader(format) ? format : null;
}

/** Meta's link to the approved header file; fine to display, not to send. */
const headerSampleOf = (tpl: WhatsAppTemplate): string | undefined =>
  tpl.components?.find((c) => c.type === 'HEADER')?.example?.header_handle?.[0];

function HeaderPreview({ format, src }: { format: MediaHeaderType; src?: string }) {
  if (format === 'IMAGE' && src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="Approved header image" className="w-full max-h-48 object-cover bg-white" />;
  }
  const Icon = format === 'VIDEO' ? Film : format === 'IMAGE' ? ImageIcon : FileText;
  return (
    <div className="flex items-center gap-2 px-3 py-2.5 border-b border-emerald-100 text-[11.5px] text-slate-600">
      <Icon className="w-4 h-4 text-emerald-700" />
      Approved header {format.toLowerCase()}
    </div>
  );
}

const keyOf = (t: { name: string; language: string }) => `${t.name}|${t.language}`;

/** Config fields for Send Template: pick an approved template without variables (and its header file, if any). */
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
    const hidden: { key: string; name: string; reason: string }[] = [];
    for (const t of templates ?? []) {
      const reason = automationBlocker(t);
      if (reason) hidden.push({ key: keyOf(t), name: `${t.name} (${t.language})`, reason });
      else usable.push(t);
    }
    return { usable, hidden };
  }, [templates]);

  const selectedKey = local.templateName ? keyOf({ name: String(local.templateName), language: String(local.templateLanguage ?? '') }) : '';
  const selected = usable.find((t) => keyOf(t) === selectedKey) ?? null;
  const hiddenSelected = selected ? null : hidden.find((h) => h.key === selectedKey) ?? null;
  const headerFormat = selected ? mediaHeaderOf(selected) : null;

  /** Stores everything the engine needs, so runs never have to fetch the template from Meta. */
  const choose = (tpl: WhatsAppTemplate) => {
    set('templateName', tpl.name);
    set('templateLanguage', tpl.language);
    set('templateId', undefined); // older steps stored a typed name here
    // A header file is sent as approved: the engine looks it up by the template's Meta id
    set('templateHeaderFormat', mediaHeaderOf(tpl) ?? undefined);
    set('templateMetaId', tpl.id);
    set('templateFieldIds', []);
    set('templateValues', {});
    set('templateComponents', buildTemplateSendComponents(tpl, {}));
    set('templatePreview', renderTemplateMessage(tpl, {}));
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
      <Field
        label="Template"
        name="templateName"
        required
        hint="Approved templates from the Templates page that have no variables."
      >
        <select
          value={selected ? selectedKey : ''}
          onChange={(e) => {
            const tpl = usable.find((t) => keyOf(t) === e.target.value);
            if (tpl) choose(tpl);
          }}
          className={inputCls}
        >
          <option value="">Select an approved template…</option>
          {usable.map((t) => (
            <option key={keyOf(t)} value={keyOf(t)}>{t.name} ({t.language})</option>
          ))}
        </select>
        {error && warn(error)}
        {!error && usable.length === 0 && warn('No approved templates without variables. Create one under Templates.')}
        {hiddenSelected && warn(`“${hiddenSelected.name}” can’t be sent by an automation: ${hiddenSelected.reason} Choose another template.`)}
        {!selected && !hiddenSelected && selectedKey && warn(`“${String(local.templateName)}” is no longer approved or available. Choose another template.`)}
        {!selected && !selectedKey && !!local.templateId && warn(`This step used the typed name “${String(local.templateId)}”. Choose it from the list so its language is sent correctly.`)}
        {hidden.length > 0 && (
          <details className="text-[10.5px] text-slate-400">
            <summary className="cursor-pointer hover:text-slate-600">
              {hidden.length} template{hidden.length === 1 ? '' : 's'} not listed
            </summary>
            <ul className="mt-1 space-y-0.5 pl-3 leading-snug">
              {hidden.map((h) => (
                <li key={h.key}>
                  <span className="font-medium text-slate-500">{h.name}</span>: {h.reason}
                </li>
              ))}
            </ul>
          </details>
        )}
      </Field>

      {selected && (
        <Field
          label="Preview"
          hint={headerFormat ? `Sent exactly as approved, with the template’s approved header ${headerFormat.toLowerCase()}.` : 'Sent exactly as approved.'}
        >
          <div className="bg-[#f0fdf4] border border-emerald-100 rounded-lg overflow-hidden">
            {headerFormat && <HeaderPreview format={headerFormat} src={headerSampleOf(selected)} />}
            <p className="whitespace-pre-wrap break-words text-[12px] text-slate-700 px-3 py-2.5">
              {renderTemplateMessage(selected, {})}
            </p>
          </div>
        </Field>
      )}
    </>
  );
}
