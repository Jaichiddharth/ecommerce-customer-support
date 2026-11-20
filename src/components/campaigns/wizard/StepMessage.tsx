'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Circle, Image as ImageIcon, RefreshCw } from 'lucide-react';
import { apiClient } from '@/lib/api/client';
import { toApiError } from '@/lib/api/api-error';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import { WhatsAppChatPreview } from '@/components/templates/WhatsAppChatPreview';
import { formatPhone } from '@/components/inbox/inbox-types';
import { getTemplateSendBlocker } from '@/lib/whatsapp-templates';
import { inputCls } from '@/components/ui/controls';
import type { HeaderType, WhatsAppTemplate } from '@/types/templates';
import { NumberHealth } from './NumberHealth';
import { autoMapVariables, mappableFields, resolveValues } from '@/lib/campaigns/message';
import { FieldLabel, SectionCard } from '../ui';
import type { CampaignAudience, CampaignMessage, VariableSource } from '../types';

interface Sender {
  channelId: number;
  phoneNumberId: string;
  name: string;
  phone: string;
}

interface Props {
  message: CampaignMessage;
  audience: CampaignAudience | null;
  onChange: (message: CampaignMessage) => void;
}

const templateKey = (t: Pick<WhatsAppTemplate, 'name' | 'language'>) => `${t.name}::${t.language}`;
const TEXT_SOURCE = '__text__';

const CATEGORY_PILL: Record<string, string> = {
  MARKETING: 'bg-rose-50 text-rose-600',
  UTILITY: 'bg-emerald-50 text-emerald-700',
};

export const StepMessage: React.FC<Props> = ({ message, audience, onChange }) => {
  const [senders, setSenders] = useState<Sender[] | null>(null);
  const [templates, setTemplates] = useState<WhatsAppTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const requestRef = useRef(0);
  const messageRef = useRef(message);
  messageRef.current = message;

  // Connected WhatsApp numbers; the first one is picked when none is chosen yet
  useEffect(() => {
    apiClient
      .get('/api/channels', { params: { type: 'whatsapp', includeDisconnected: 'false' } })
      .then((res) => {
        const list: any[] = Array.isArray(res.data?.channels) ? res.data.channels : [];
        const found = list
          .filter((c) => c.metaPhoneNumberId)
          .map((c) => ({ channelId: Number(c.id), phoneNumberId: c.metaPhoneNumberId, name: c.verified_name || c.name || 'WhatsApp', phone: formatPhone(c.phoneNumber) }));
        setSenders(found);
        const current = messageRef.current;
        if (!current.phoneNumberId && found[0]) {
          onChange({ ...current, phoneNumberId: found[0].phoneNumberId, senderLabel: `${found[0].name} (${found[0].phone})` });
        }
      })
      .catch(() => setSenders([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadTemplates = async (phoneNumberId: string) => {
    const requestId = ++requestRef.current;
    setLoadingTemplates(true);
    setTemplateError(null);
    try {
      const res = await apiClient.get('/api/channels/whatsapp/templates', { params: { phoneNumberId } });
      if (requestId !== requestRef.current) return;
      setTemplates(Array.isArray(res.data?.templates) ? res.data.templates : []);
      if (res.data?.error) setTemplateError(res.data.error);
    } catch (err) {
      if (requestId === requestRef.current) setTemplateError(toApiError(err).message);
    } finally {
      if (requestId === requestRef.current) setLoadingTemplates(false);
    }
  };

  useEffect(() => {
    if (message.phoneNumberId) loadTemplates(message.phoneNumberId);
  }, [message.phoneNumberId]);

  // Only templates a campaign can actually send: approved, not OTP, with supported headers and buttons
  const sendable = useMemo(() => templates.filter((t) => !getTemplateSendBlocker(t)), [templates]);
  const hiddenCount = templates.length - sendable.length;

  const template = message.template;
  const fields = useMemo(() => mappableFields(template), [template]);
  const mediaField = template?.components.find((c) => c.type === 'HEADER' && c.format && c.format !== 'TEXT');
  const columns = audience?.columns ?? [];

  const pickSender = (phoneNumberId: string) => {
    const s = senders?.find((x) => x.phoneNumberId === phoneNumberId);
    if (!s || s.phoneNumberId === message.phoneNumberId) return;
    // Templates belong to a WhatsApp account, so the pick is cleared when the number changes
    onChange({ ...message, phoneNumberId: s.phoneNumberId, senderLabel: `${s.name} (${s.phone})`, template: null, variables: {} });
  };

  const pickTemplate = (key: string) => {
    const t = sendable.find((x) => templateKey(x) === key);
    if (!t) return;
    onChange({ ...message, template: t, variables: autoMapVariables(t, columns) });
  };

  const setVariable = (id: string, source: VariableSource) => onChange({ ...message, variables: { ...message.variables, [id]: source } });

  // Preview with the first contact's values
  const values = resolveValues(message.variables, audience?.recipients[0]);
  const find = (type: string) => template?.components.find((c) => c.type === type);
  const header = find('HEADER');
  // Values by variable key, so the preview can mark which words come from the contact file or fixed text
  const headerValues: Record<string, string> = {};
  for (const m of (header?.text ?? '').matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)) {
    if (values.header?.trim()) headerValues[m[1]] = values.header;
  }
  const bodyValues = Object.fromEntries(
    Object.entries(values)
      .filter(([id, v]) => id.startsWith('body:') && v?.trim())
      .map(([id, v]) => [id.slice(5), v])
  );
  const headerType: HeaderType =
    header?.format === 'TEXT' || header?.format === 'IMAGE' || header?.format === 'VIDEO' || header?.format === 'DOCUMENT' ? header.format : 'NONE';
  const headerHandle = header?.example?.header_handle?.[0];

  return (
    <div className="space-y-5">
      <SectionCard step="01" title="Pick template" description="Only approved templates that can be sent in bulk are listed.">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <FieldLabel htmlFor="sender">Send from *</FieldLabel>
            <SearchableSelect
              id="sender"
              size="md"
              value={message.phoneNumberId || null}
              onChange={pickSender}
              placeholder={senders === null ? 'Loading numbers…' : senders.length ? 'Choose a WhatsApp number' : 'No WhatsApp number connected'}
              disabled={!senders?.length}
              options={(senders ?? []).map((s) => ({ value: s.phoneNumberId, label: s.name, description: s.phone }))}
            />
            {senders?.length === 0 && <p className="mt-1 text-[11px] text-amber-700">Connect a WhatsApp number in Settings first.</p>}
          </div>
          <div>
            <FieldLabel
              htmlFor="template"
              hint={
                message.phoneNumberId && (
                  <button
                    type="button"
                    onClick={() => loadTemplates(message.phoneNumberId)}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#3440a8] cursor-pointer"
                    title="Reload templates"
                  >
                    <RefreshCw className={`w-3 h-3 ${loadingTemplates ? 'animate-spin' : ''}`} />
                    Refresh
                  </button>
                )
              }
            >
              Template *
            </FieldLabel>
            <SearchableSelect
              id="template"
              size="md"
              value={template ? templateKey(template) : null}
              onChange={pickTemplate}
              disabled={!message.phoneNumberId || loadingTemplates}
              placeholder={loadingTemplates ? 'Loading templates…' : sendable.length ? 'Search approved templates' : 'No approved templates'}
              searchPlaceholder="Search by name"
              options={sendable.map((t) => ({
                value: templateKey(t),
                label: t.name,
                description: `${t.category.toLowerCase()} · ${t.language}`,
              }))}
            />
            {hiddenCount > 0 && !loadingTemplates && (
              <p className="mt-1 text-[11px] text-slate-400">{hiddenCount} templates hidden: not approved, OTP, or with buttons a campaign can&apos;t send.</p>
            )}
            {templateError && <p className="mt-1 text-[11px] text-red-600">{templateError}</p>}
          </div>
        </div>
        <NumberHealth
          channelId={senders?.find((s) => s.phoneNumberId === message.phoneNumberId)?.channelId ?? null}
          recipients={audience?.recipientCount ?? 0}
        />
        {template?.category === 'MARKETING' && (
          <p className="mt-4 px-3 py-2 rounded-lg bg-amber-50 border border-amber-100 text-[11px] text-amber-800 flex items-start gap-2">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
            Marketing messages only reach contacts who opted in, and Meta may hold back some to protect the user experience (error 131049).
          </p>
        )}
      </SectionCard>

      {template && (
        <SectionCard
          step="02"
          title="Preview & variables"
          description={<span className="font-mono">{template.name}</span>}
          action={
            <div className="flex items-center gap-1.5">
              <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase ${CATEGORY_PILL[template.category] ?? 'bg-slate-100 text-slate-600'}`}>
                {template.category}
              </span>
              <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase bg-slate-100 text-slate-600">{template.language}</span>
            </div>
          }
        >
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div>
              <p className="mb-2 text-[11px] font-bold text-slate-600 uppercase tracking-wider">Preview · first contact</p>
              <WhatsAppChatPreview
                businessName={message.senderLabel.replace(/\s*\(.*\)$/, '') || 'Your business'}
                headerType={headerType}
                headerText={headerType === 'TEXT' ? header?.text : undefined}
                headerValues={headerValues}
                headerMediaUrl={headerType === 'IMAGE' && headerHandle?.startsWith('http') ? headerHandle : undefined}
                bodyText={find('BODY')?.text ?? ''}
                bodyValues={bodyValues}
                highlightVariables
                footerText={find('FOOTER')?.text}
                buttons={(find('BUTTONS')?.buttons ?? []).map((b, i) => ({
                  id: String(i),
                  type: b.type === 'URL' || b.type === 'PHONE_NUMBER' || b.type === 'FLOW' ? b.type : 'QUICK_REPLY',
                  text: b.text,
                }))}
              />
            </div>

            <div>
              <p className="mb-2 text-[11px] font-bold text-slate-600 uppercase tracking-wider">Fill variables from columns</p>
              {mediaField && (
                <p className="mb-3 px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-[11px] text-slate-600 flex items-start gap-2">
                  <ImageIcon className="w-3.5 h-3.5 shrink-0 mt-px" />
                  The header {mediaField.format?.toLowerCase()} approved with the template is sent to everyone.
                </p>
              )}
              {fields.length === 0 ? (
                <p className="text-xs text-slate-500">This template has no variables. Everyone gets the same message.</p>
              ) : (
                <div className="space-y-3">
                  {fields.map((field) => {
                    const source = message.variables[field.id];
                    const mapped = source && (source.type === 'column' ? Boolean(source.column) : Boolean(source.value.trim()));
                    return (
                      <div key={field.id} className={`p-3 rounded-xl border ${mapped ? 'border-slate-200' : 'border-amber-200 bg-amber-50/30'}`}>
                        <div className="flex items-center justify-between gap-2 mb-1.5">
                          <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
                            {mapped ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> : <Circle className="w-3.5 h-3.5 text-amber-500" />}
                            <span className="font-mono">{field.label}</span>
                          </span>
                          {field.example && <span className="text-[10px] text-slate-400 truncate">e.g. {field.example}</span>}
                        </div>
                        <select
                          className={`${inputCls} cursor-pointer`}
                          value={source?.type === 'text' ? TEXT_SOURCE : source?.column ?? ''}
                          onChange={(e) =>
                            setVariable(field.id, e.target.value === TEXT_SOURCE ? { type: 'text', value: '' } : { type: 'column', column: e.target.value })
                          }
                        >
                          <option value="">Choose a column…</option>
                          <optgroup label="Columns in your file">
                            {columns.map((c) => (
                              <option key={c} value={c}>
                                {c}
                              </option>
                            ))}
                          </optgroup>
                          <optgroup label="Other">
                            <option value={TEXT_SOURCE}>Same text for everyone…</option>
                          </optgroup>
                        </select>
                        {source?.type === 'text' && (
                          <div className="mt-2 flex items-center gap-1">
                            {field.prefix && <span className="text-[11px] text-slate-400 font-mono truncate max-w-[45%]">{field.prefix}</span>}
                            <input
                              className={inputCls}
                              value={source.value}
                              placeholder={field.example ?? 'Value'}
                              onChange={(e) => setVariable(field.id, { type: 'text', value: e.target.value })}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </SectionCard>
      )}
    </div>
  );
};
