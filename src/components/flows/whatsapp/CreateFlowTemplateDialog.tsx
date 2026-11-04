'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, Loader2, FileText, MessageSquareText, MousePointerClick, AlertTriangle, ArrowRight, Workflow, Send } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { EmptyState, LoadingState } from '@/components/ui/states';
import { WhatsAppChatPreview } from '@/components/templates/WhatsAppChatPreview';
import { toApiError } from '@/lib/api/api-error';
import { errorTitle, notifyError } from '@/lib/api/notify';
import { flowsApi, templatesApi, type PublishedFlowOption } from './wa-api';
import { inputCls, primaryBtn, secondaryBtn } from './wa-ui';

export const TEMPLATE_LANGUAGES = [
  ['en_US', 'English (US)'], ['en_GB', 'English (UK)'], ['en', 'English'], ['hi', 'Hindi'], ['ta', 'Tamil'],
  ['es', 'Spanish'], ['pt_BR', 'Portuguese (BR)'], ['fr', 'French'], ['de', 'German'], ['ar', 'Arabic'], ['id', 'Indonesian'],
] as const;

// Mirrors TEMPLATE_LIMITS in lib/services/whatsapp-flows/template.service
const LIMITS = { name: 512, header: 60, body: 1024, footer: 60, buttonText: 25 } as const;

const CATEGORIES = [
  ['UTILITY', 'Utility', 'Order updates, forms, account info'],
  ['MARKETING', 'Marketing', 'Offers, promotions, lead capture'],
] as const;

type Field = 'name' | 'language' | 'category' | 'headerText' | 'bodyText' | 'footerText' | 'flowId' | 'buttonText';
type Errors = Partial<Record<Field, string>>;
const FORM_FIELDS: Record<Field, true> = {
  name: true, language: true, category: true, headerText: true, bodyText: true, footerText: true, flowId: true, buttonText: true,
};

// Server field names that belong to a field of this form
const SERVER_FIELD: Record<string, Field> = { flowVersionId: 'flowId', channelId: 'flowId' };
const VARIABLE_RE = /\{\{.*?\}\}/;

/** Section card: numbered heading, then its fields. */
function Section({ step, title, icon, aside, children }: { step: number; title: string; icon: React.ReactNode; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <header className="flex items-center gap-2.5 px-4 py-3 border-b border-slate-100">
        <span className="w-5 h-5 rounded-md bg-[#3440a8]/10 text-[#3440a8] text-[10px] font-bold flex items-center justify-center">{step}</span>
        <h3 className="text-[12px] font-bold text-slate-700 flex items-center gap-1.5">{icon}{title}</h3>
        <div className="flex-1" />
        {aside}
      </header>
      <div className="p-4 space-y-4">{children}</div>
    </section>
  );
}

/** Label row (with optional counter), control, then the error, else the hint. */
function FormField({ label, optional, count, max, error, hint, children }: {
  label: string; optional?: boolean; count?: number; max?: number; error?: string; hint?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-semibold text-slate-600">
          {label}{optional && <span className="font-normal text-slate-400"> · optional</span>}
        </span>
        {max !== undefined && (
          <span className={`text-[10px] tabular-nums ${count! > max ? 'text-red-500' : 'text-slate-400'}`}>{count}/{max}</span>
        )}
      </div>
      {children}
      {error ? <p className="text-[10px] text-red-500" role="alert">{error}</p> : hint ? <p className="text-[10px] text-slate-400">{hint}</p> : null}
    </div>
  );
}

const errCls = (e?: string) => (e ? '!border-red-300 focus:!ring-red-100' : '');

export function CreateFlowTemplateDialog({ defaultFlowId, onClose, onCreated }: { defaultFlowId?: number; onClose: () => void; onCreated: () => void }) {
  const [flows, setFlows] = useState<PublishedFlowOption[] | null>(null);
  const [flowId, setFlowId] = useState<number | ''>('');
  const [name, setName] = useState('');
  const [language, setLanguage] = useState('en_US');
  const [category, setCategory] = useState<'MARKETING' | 'UTILITY'>('UTILITY');
  const [headerText, setHeaderText] = useState('');
  const [bodyText, setBodyText] = useState('');
  const [footerText, setFooterText] = useState('');
  const [buttonText, setButtonText] = useState('Open form');
  const [touched, setTouched] = useState<Partial<Record<Field, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);
  const [serverErrors, setServerErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<{ title: string; message: string; ref?: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    flowsApi.published().then((list) => {
      const eligible = list.filter((f) => f.publishedVersion?.metaFlowId);
      setFlows(eligible);
      setFlowId(eligible.find((f) => f.id === defaultFlowId)?.id ?? eligible[0]?.id ?? '');
    }).catch((err) => { notifyError(err, { where: 'CreateFlowTemplateDialog' }); setFlows([]); });
  }, [defaultFlowId]);

  const flow = useMemo(() => flows?.find((f) => f.id === flowId) ?? null, [flows, flowId]);
  const entryScreen = flow?.publishedVersion?.screens.find((s) => s.id === flow.publishedVersion?.entryScreen) ?? flow?.publishedVersion?.screens[0];

  const clientErrors = useMemo<Errors>(() => {
    const e: Errors = {};
    const noVars = (v: string, label: string) => (VARIABLE_RE.test(v) ? `${label} can’t contain {{variables}} in Flow templates.` : undefined);
    if (!name) e.name = 'Give the template a name.';
    else if (!/^[a-z0-9_]+$/.test(name)) e.name = 'Use lowercase letters, numbers and underscores only.';
    if (!bodyText.trim()) e.bodyText = 'The message body is required.';
    else e.bodyText = noVars(bodyText, 'The body');
    if (headerText) e.headerText = noVars(headerText, 'The header');
    if (footerText) e.footerText = noVars(footerText, 'The footer');
    if (!flow) e.flowId = 'Choose the published Flow this button opens.';
    if (!buttonText.trim()) e.buttonText = 'Button text is required.';
    return e;
  }, [name, bodyText, headerText, footerText, flow, buttonText]);

  const errorFor = (f: Field) => serverErrors[f] ?? ((submitted || touched[f]) ? clientErrors[f] : undefined);
  const touch = (f: Field) => () => setTouched((t) => ({ ...t, [f]: true }));
  // Editing a field clears the server's verdict on it
  const edit = <T,>(f: Field, setter: (v: T) => void) => (v: T) => {
    setter(v);
    if (serverErrors[f]) setServerErrors((s) => ({ ...s, [f]: undefined }));
  };

  const submit = async () => {
    setSubmitted(true);
    setFormError(null);
    const firstInvalid = (Object.keys(clientErrors) as Field[]).find((k) => clientErrors[k]);
    if (firstInvalid || !flow) {
      scrollRef.current?.querySelector<HTMLElement>(`[data-field="${firstInvalid}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
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
      const apiErr = toApiError(err);
      const raw = typeof apiErr.details?.field === 'string' ? apiErr.details.field : undefined;
      const field = (raw && (SERVER_FIELD[raw] ?? raw)) as Field | undefined;
      if (field && field in FORM_FIELDS) setServerErrors({ [field]: apiErr.message });
      else if (apiErr.code === 'CONFLICT' && /already exists/i.test(apiErr.message)) setServerErrors({ name: apiErr.message });
      else setFormError({ title: apiErr.title ?? errorTitle(apiErr), message: apiErr.message, ref: apiErr.requestId });
    } finally {
      setSaving(false);
    }
  };

  const header = (
    <div className="flex items-start gap-3 px-5 py-4 border-b border-slate-100">
      <div className="w-9 h-9 rounded-xl bg-[#3440a8]/10 flex items-center justify-center shrink-0">
        <FileText className="w-4 h-4 text-[#3440a8]" />
      </div>
      <div className="min-w-0">
        <h2 className="text-[14px] font-bold text-slate-800">New Flow template</h2>
        <p className="text-[11px] text-slate-500">A message template with a WhatsApp Flow button. Meta reviews it before it can be sent.</p>
      </div>
      <div className="flex-1" />
      <button type="button" onClick={onClose} disabled={saving} className="p-1 text-slate-400 hover:text-slate-600 transition-colors" aria-label="Close">
        <X className="w-4 h-4" />
      </button>
    </div>
  );

  return (
    <Modal isOpen onClose={saving ? () => {} : onClose} header={header} maxWidth="5xl" className="!p-0 !space-y-0 overflow-hidden">
      {!flows ? (
        <LoadingState label="Loading published flows…" compact className="py-16" />
      ) : flows.length === 0 ? (
        <div className="p-6">
          <EmptyState
            compact
            icon={<Workflow className="w-5 h-5" />}
            title="No published Flows"
            description="A Flow must be published before it can be attached to a template. Publish one under Flows, then come back."
          />
          <div className="flex justify-end pt-2"><button className={secondaryBtn} onClick={onClose}>Close</button></div>
        </div>
      ) : (
        <>
          <div className="flex flex-col lg:flex-row max-h-[calc(100dvh-11rem)] overflow-y-auto lg:overflow-hidden">
            {/* ── Form ── */}
            <div ref={scrollRef} className="flex-1 min-w-0 lg:overflow-y-auto bg-slate-50/60 p-4 sm:p-5 space-y-4">
              <Section step={1} title="Template details" icon={<FileText className="w-3.5 h-3.5 text-slate-400" />}>
                <div className="grid sm:grid-cols-[minmax(0,1fr)_170px] gap-3">
                  <div data-field="name">
                    <FormField label="Template name" error={errorFor('name')} hint="Lowercase letters, numbers and underscores. Can’t be changed later.">
                      <input
                        value={name}
                        onChange={(e) => edit('name', setName)(e.target.value.toLowerCase().replace(/\s+/g, '_'))}
                        onBlur={touch('name')}
                        placeholder="order_details_form"
                        maxLength={LIMITS.name}
                        autoFocus
                        className={`${inputCls} font-mono ${errCls(errorFor('name'))}`}
                        aria-invalid={!!errorFor('name')}
                      />
                    </FormField>
                  </div>
                  <FormField label="Language" error={errorFor('language')}>
                    <select value={language} onChange={(e) => edit('language', setLanguage)(e.target.value)} className={inputCls}>
                      {TEMPLATE_LANGUAGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </FormField>
                </div>
                <FormField label="Category" error={errorFor('category')} hint="Meta may re-categorise a template during review.">
                  <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Category">
                    {CATEGORIES.map(([value, label, desc]) => (
                      <button
                        key={value}
                        type="button"
                        role="radio"
                        aria-checked={category === value}
                        onClick={() => edit('category', setCategory)(value)}
                        className={`text-left px-3 py-2 rounded-lg border transition-colors ${
                          category === value ? 'border-[#3440a8] bg-[#3440a8]/5 ring-2 ring-[#3440a8]/10' : 'border-slate-200 bg-white hover:bg-slate-50'
                        }`}
                      >
                        <span className={`block text-[12px] font-semibold ${category === value ? 'text-[#3440a8]' : 'text-slate-700'}`}>{label}</span>
                        <span className="block text-[10px] text-slate-400">{desc}</span>
                      </button>
                    ))}
                  </div>
                </FormField>
              </Section>

              <Section step={2} title="Message" icon={<MessageSquareText className="w-3.5 h-3.5 text-slate-400" />}>
                <div data-field="headerText">
                  <FormField label="Header" optional count={headerText.length} max={LIMITS.header} error={errorFor('headerText')}>
                    <input
                      value={headerText}
                      onChange={(e) => edit('headerText', setHeaderText)(e.target.value)}
                      onBlur={touch('headerText')}
                      maxLength={LIMITS.header}
                      placeholder="Complete your order"
                      className={`${inputCls} ${errCls(errorFor('headerText'))}`}
                    />
                  </FormField>
                </div>
                <div data-field="bodyText">
                  <FormField
                    label="Body"
                    count={bodyText.length}
                    max={LIMITS.body}
                    error={errorFor('bodyText')}
                    hint={<>Format with <code className="font-mono">*bold*</code>, <code className="font-mono">_italic_</code>, <code className="font-mono">~strike~</code>. Variables aren’t supported in Flow templates.</>}
                  >
                    <textarea
                      value={bodyText}
                      onChange={(e) => edit('bodyText', setBodyText)(e.target.value)}
                      onBlur={touch('bodyText')}
                      maxLength={LIMITS.body}
                      rows={4}
                      placeholder="Tell us a few details so we can complete your order."
                      className={`${inputCls} resize-y min-h-[92px] ${errCls(errorFor('bodyText'))}`}
                      aria-invalid={!!errorFor('bodyText')}
                    />
                  </FormField>
                </div>
                <div data-field="footerText">
                  <FormField label="Footer" optional count={footerText.length} max={LIMITS.footer} error={errorFor('footerText')}>
                    <input
                      value={footerText}
                      onChange={(e) => edit('footerText', setFooterText)(e.target.value)}
                      onBlur={touch('footerText')}
                      maxLength={LIMITS.footer}
                      placeholder="Takes less than a minute"
                      className={`${inputCls} ${errCls(errorFor('footerText'))}`}
                    />
                  </FormField>
                </div>
              </Section>

              <Section
                step={3}
                title="Button"
                icon={<MousePointerClick className="w-3.5 h-3.5 text-slate-400" />}
                aside={<span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200">WhatsApp Flow</span>}
              >
                <div className="grid sm:grid-cols-[minmax(0,1fr)_200px] gap-3">
                  <div data-field="flowId">
                    <FormField label="Flow to open" error={errorFor('flowId')} hint="Only published Flows are listed.">
                      <select
                        value={flowId}
                        onChange={(e) => edit('flowId', setFlowId)(Number(e.target.value))}
                        className={`${inputCls} ${errCls(errorFor('flowId'))}`}
                      >
                        {flows.map((f) => <option key={f.id} value={f.id}>{f.name} · v{f.publishedVersion?.versionNumber}</option>)}
                      </select>
                    </FormField>
                  </div>
                  <div data-field="buttonText">
                    <FormField label="Button text" count={buttonText.length} max={LIMITS.buttonText} error={errorFor('buttonText')}>
                      <input
                        value={buttonText}
                        onChange={(e) => edit('buttonText', setButtonText)(e.target.value)}
                        onBlur={touch('buttonText')}
                        maxLength={LIMITS.buttonText}
                        placeholder="Open form"
                        className={`${inputCls} ${errCls(errorFor('buttonText'))}`}
                      />
                    </FormField>
                  </div>
                </div>

                {flow?.publishedVersion && (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-600">
                      <span className="font-semibold text-slate-700">On tap</span>
                      <ArrowRight className="w-3 h-3 text-slate-400" />
                      <span>opens <strong className="text-slate-700">{flow.name}</strong></span>
                      <span className="text-slate-400">on screen</span>
                      <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-white border border-slate-200 text-slate-700">
                        {entryScreen ? `${entryScreen.title || entryScreen.id}` : flow.publishedVersion.entryScreen ?? '—'}
                      </span>
                    </div>
                    <dl className="mt-2 grid grid-cols-3 gap-2 text-[10px]">
                      {[
                        ['Flow action', 'Navigate'],
                        ['Version', `v${flow.publishedVersion.versionNumber} (pinned)`],
                        ['Meta Flow ID', flow.publishedVersion.metaFlowId ?? '—'],
                      ].map(([label, value]) => (
                        <div key={label} className="min-w-0">
                          <dt className="text-slate-400">{label}</dt>
                          <dd className="font-medium text-slate-700 truncate font-mono" title={value}>{value}</dd>
                        </div>
                      ))}
                    </dl>
                    <p className="mt-2 text-[10px] text-slate-400">
                      Static Flows always start on their first screen. Later versions of this Flow don’t change this template.
                    </p>
                  </div>
                )}
              </Section>
            </div>

            {/* ── Preview ── */}
            <aside className="lg:w-[340px] shrink-0 border-t lg:border-t-0 lg:border-l border-slate-200 bg-white lg:overflow-y-auto p-4 sm:p-5">
              <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-400 mb-2">Preview</p>
              <WhatsAppChatPreview
                headerType={headerText.trim() ? 'TEXT' : 'NONE'}
                headerText={headerText}
                bodyText={bodyText}
                footerText={footerText}
                buttons={[{ id: 'flow', type: 'FLOW', text: buttonText }]}
              />
              <p className="mt-3 text-[10px] text-slate-400 leading-relaxed">
                Every send gets its own flow token, so each response is matched to the customer who opened it.
              </p>
            </aside>
          </div>

          {/* ── Footer ── */}
          <div className="flex flex-wrap items-center gap-2 px-5 py-3 border-t border-slate-200 bg-white">
            {formError ? (
              <div role="alert" className="flex items-start gap-1.5 text-[11px] text-red-600 min-w-0 flex-1">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
                <span className="min-w-0 break-words"><strong>{formError.title}:</strong> {formError.message}{formError.ref && <span className="text-red-400"> · Ref {formError.ref}</span>}</span>
              </div>
            ) : (submitted && Object.values(clientErrors).some(Boolean)) || Object.values(serverErrors).some(Boolean) ? (
              <p className="text-[11px] text-red-500 flex-1">Fix the highlighted fields to continue.</p>
            ) : (
              <p className="text-[10px] text-slate-400 flex-1">Review usually takes from a few minutes up to 24 hours. Status updates automatically.</p>
            )}
            <button className={secondaryBtn} onClick={onClose} disabled={saving}>Cancel</button>
            <button className={primaryBtn} onClick={submit} disabled={saving}>
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              {saving ? 'Submitting…' : 'Submit for review'}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

