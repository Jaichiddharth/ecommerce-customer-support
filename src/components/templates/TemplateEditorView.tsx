'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  ArrowLeft,
  Bold,
  Italic,
  Strikethrough,
  Code,
  Plus,
  Trash2,
  Send,
  Save,
  CheckCircle2,
  AlertTriangle,
  Info,
  Loader2,
  Upload,
  Lock,
  AlertCircle,
  Ban,
} from 'lucide-react';
import { WhatsAppChatPreview } from './WhatsAppChatPreview';
import {
  HeaderType,
  TemplateButton,
  TemplateButtonType,
  TemplateCategory,
  TemplateComponent,
  WhatsAppTemplate,
  TEMPLATE_LIMITS,
  TEMPLATE_MEDIA_RULES,
  isMediaHeader,
} from '@/types/templates';
import {
  bodyCharLimit,
  extractVariables,
  getBodyTextProblems,
  getButtonProblems,
  getFooterTextProblems,
  getHeaderTextProblems,
  validateTemplateComponents,
} from '@/lib/whatsapp-templates';
import { apiClient } from '@/lib/api/client';
import { notifyError } from '@/lib/api/notify';
import { gooeyToast } from '@/components/ui/goey-toaster';

export type TemplateEditorMode = 'create' | 'edit' | 'duplicate';

interface TemplateEditorViewProps {
  mode: TemplateEditorMode;
  initialTemplate?: WhatsAppTemplate | null;
  onBack: () => void;
  onSuccess: () => void;
  businessName?: string;
  connectedNumber?: string | null;
  /** Channel the templates list was loaded from; create/edit go to the same WABA */
  phoneNumberId?: string;
}

const SUPPORTED_LANGUAGES = [
  { code: 'en_US', label: 'English (US)' },
  { code: 'en_GB', label: 'English (UK)' },
  { code: 'en', label: 'English' },
  { code: 'hi', label: 'हिन्दी Hindi' },
  { code: 'ta', label: 'தமிழ் Tamil' },
  { code: 'te', label: 'తెలుగు Telugu' },
  { code: 'kn', label: 'ಕನ್ನಡ Kannada' },
  { code: 'ml', label: 'മലയാളം Malayalam' },
  { code: 'mr', label: 'मराठी Marathi' },
  { code: 'bn', label: 'বাংলা Bengali' },
  { code: 'gu', label: 'ગુજરાતી Gujarati' },
  { code: 'pa', label: 'ਪੰਜਾਬੀ Punjabi' },
  { code: 'ur', label: 'اردو Urdu' },
  { code: 'ar', label: 'العربية Arabic' },
  { code: 'es', label: 'Español' },
  { code: 'pt_BR', label: 'Português (BR)' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
  { code: 'id', label: 'Bahasa Indonesia' },
];

const BUTTON_TYPE_LABELS: Record<TemplateButtonType, string> = {
  QUICK_REPLY: 'Quick reply',
  URL: 'Visit website',
  PHONE_NUMBER: 'Call phone',
};

const DRAFT_KEY = 'unocx_template_draft';

interface FormState {
  name: string;
  category: TemplateCategory;
  language: string;
  headerType: HeaderType;
  headerText: string;
  headerSample: string;
  /** Meta upload handle for a media header's sample */
  headerHandle: string;
  bodyText: string;
  /** bodySamples[0] is the sample for {{1}}, … */
  bodySamples: string[];
  footerText: string;
  buttons: TemplateButton[];
}

const EMPTY_FORM: FormState = {
  name: '',
  category: 'UTILITY',
  language: 'en_US',
  headerType: 'NONE',
  headerText: '',
  headerSample: '',
  headerHandle: '',
  bodyText: '',
  bodySamples: [],
  footerText: '',
  buttons: [],
};

let buttonSeq = 0;
const newButtonId = () => `btn_${Date.now()}_${buttonSeq++}`;

/** Text input styling; red border while the field has a problem */
const fieldClass = (invalid = false) =>
  `w-full px-3 py-2 text-sm bg-white border rounded-lg text-slate-800 focus:outline-none disabled:bg-slate-50 disabled:text-slate-500 ${
    invalid ? 'border-red-400 focus:border-red-500' : 'border-slate-200 focus:border-[#3440a8]'
  }`;

/** "12/60" counter, like WhatsApp Manager; turns red past the limit */
const CharCounter: React.FC<{ count: number; max: number; className?: string }> = ({ count, max, className = '' }) => (
  <span
    className={`pointer-events-none select-none font-mono text-[11px] tabular-nums ${
      count > max ? 'font-semibold text-red-600' : 'text-slate-400'
    } ${className}`}
  >
    {count}/{max}
  </span>
);

/** Input with its counter inside the right edge */
const CountedInput: React.FC<
  Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'maxLength'> & { value: string; max: number; invalid?: boolean }
> = ({ value, max, invalid, className = '', ...rest }) => (
  <div className="relative min-w-0 flex-1">
    <input {...rest} value={value} maxLength={max} className={`${fieldClass(invalid)} pr-20 ${className}`} />
    <CharCounter count={value.length} max={max} className="absolute right-3 top-1/2 -translate-y-1/2" />
  </div>
);

/** Problems shown right under the field they belong to */
const FieldProblems: React.FC<{ problems: string[] }> = ({ problems }) =>
  problems.length === 0 ? null : (
    <ul className="mt-1.5 space-y-1">
      {problems.map((p) => (
        <li key={p} className="flex items-start gap-1.5 text-[11px] leading-snug text-red-600">
          <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" />
          <span>{p}</span>
        </li>
      ))}
    </ul>
  );

/** Meta template → editor form (samples are read back from the `example` blocks) */
function templateToForm(tpl: WhatsAppTemplate, mode: TemplateEditorMode): FormState {
  const header = tpl.components?.find((c) => c.type === 'HEADER');
  const body = tpl.components?.find((c) => c.type === 'BODY');
  const footer = tpl.components?.find((c) => c.type === 'FOOTER');
  const buttons = tpl.components?.find((c) => c.type === 'BUTTONS')?.buttons ?? [];

  const headerType: HeaderType =
    header?.format === 'TEXT' || isMediaHeader(header?.format) ? (header!.format as HeaderType) : 'NONE';

  return {
    name: mode === 'duplicate' ? `${tpl.name}_copy`.slice(0, TEMPLATE_LIMITS.name) : tpl.name,
    category: tpl.category === 'MARKETING' ? 'MARKETING' : 'UTILITY',
    language: tpl.language || 'en_US',
    headerType,
    headerText: header?.text ?? '',
    headerSample: header?.example?.header_text?.[0] ?? '',
    headerHandle: header?.example?.header_handle?.[0] ?? '',
    bodyText: body?.text ?? '',
    bodySamples: body?.example?.body_text?.[0] ?? [],
    footerText: footer?.text ?? '',
    buttons: buttons
      .filter((b) => b.type === 'QUICK_REPLY' || b.type === 'URL' || b.type === 'PHONE_NUMBER')
      .map((b) => {
        // Meta stores a dynamic URL's example as the full URL; the editor only asks for the {{1}} part
        const prefix = b.url?.split('{{1}}')[0] ?? '';
        const fullExample = b.example?.[0] ?? '';
        return {
          id: newButtonId(),
          type: b.type as TemplateButtonType,
          text: b.text ?? '',
          url: b.url,
          phone_number: b.phone_number,
          example: fullExample.startsWith(prefix) ? fullExample.slice(prefix.length) : fullExample,
        };
      }),
  };
}

/** Editor form → Meta `components` payload, including the `example` blocks Meta requires */
function formToComponents(form: FormState): TemplateComponent[] {
  const components: TemplateComponent[] = [];

  if (form.headerType === 'TEXT') {
    const hasVariable = extractVariables(form.headerText).length > 0;
    components.push({
      type: 'HEADER',
      format: 'TEXT',
      text: form.headerText.trim(),
      ...(hasVariable ? { example: { header_text: [form.headerSample.trim()] } } : {}),
    });
  } else if (isMediaHeader(form.headerType)) {
    components.push({
      type: 'HEADER',
      format: form.headerType,
      ...(form.headerHandle ? { example: { header_handle: [form.headerHandle] } } : {}),
    });
  }

  const bodyVars = extractVariables(form.bodyText);
  components.push({
    type: 'BODY',
    text: form.bodyText.trim(),
    ...(bodyVars.length > 0
      ? { example: { body_text: [bodyVars.map((v) => form.bodySamples[v - 1]?.trim() ?? '')] } }
      : {}),
  });

  if (form.footerText.trim()) {
    components.push({ type: 'FOOTER', text: form.footerText.trim() });
  }

  if (form.buttons.length > 0) {
    components.push({
      type: 'BUTTONS',
      buttons: form.buttons.map((b) => {
        const text = b.text.trim();
        if (b.type === 'URL') {
          const url = (b.url ?? '').trim();
          const isDynamic = extractVariables(url).length > 0;
          return {
            type: 'URL' as const,
            text,
            url,
            ...(isDynamic ? { example: [url.replace('{{1}}', (b.example ?? '').trim())] } : {}),
          };
        }
        if (b.type === 'PHONE_NUMBER') {
          return { type: 'PHONE_NUMBER' as const, text, phone_number: (b.phone_number ?? '').replace(/[\s()-]/g, '') };
        }
        return { type: 'QUICK_REPLY' as const, text };
      }),
    });
  }

  return components;
}

function loadDraft(): FormState | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? { ...EMPTY_FORM, ...JSON.parse(raw), headerHandle: '' } : null;
  } catch {
    return null;
  }
}

function clearDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    // storage unavailable; nothing to clear
  }
}

export const TemplateEditorView: React.FC<TemplateEditorViewProps> = ({
  mode,
  initialTemplate,
  onBack,
  onSuccess,
  businessName = 'Your business',
  connectedNumber,
  phoneNumberId,
}) => {
  const isEdit = mode === 'edit' && Boolean(initialTemplate?.id);
  // A new template picks up where the last unsent draft left off
  const [restoredDraft] = useState(() => (mode === 'create' ? loadDraft() : null));
  const [form, setForm] = useState<FormState>(
    () => restoredDraft ?? (initialTemplate ? templateToForm(initialTemplate, mode) : EMPTY_FORM)
  );
  const update = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

  const [hasDraft, setHasDraft] = useState(Boolean(restoredDraft));
  const draftToastShown = useRef(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [headerFileName, setHeaderFileName] = useState('');
  const [headerPreviewUrl, setHeaderPreviewUrl] = useState('');
  const bodyTextareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Meta only allows a category change while the template is rejected
  const categoryLocked = isEdit && initialTemplate?.status !== 'REJECTED';

  useEffect(() => {
    if (!restoredDraft || draftToastShown.current) return;
    draftToastShown.current = true;
    gooeyToast.success('Draft restored', { description: 'Continuing your unsent template.' });
  }, [restoredDraft]);

  useEffect(() => () => {
    if (headerPreviewUrl) URL.revokeObjectURL(headerPreviewUrl);
  }, [headerPreviewUrl]);

  const headerVariables = useMemo(() => extractVariables(form.headerText), [form.headerText]);
  // What "+ Variable" would produce; it's disabled when that no longer fits in 60 characters
  const headerWithVariable = `${form.headerText.trimEnd()} {{1}}`.trimStart();
  const bodyVariables = useMemo(() => extractVariables(form.bodyText), [form.bodyText]);
  const components = useMemo(() => formToComponents(form), [form]);

  // Shown under each field as soon as it has content; the checklist also covers empty required fields
  const headerProblems = useMemo(
    () => (form.headerType === 'TEXT' && form.headerText ? getHeaderTextProblems(form.headerText) : []),
    [form.headerType, form.headerText]
  );
  const bodyProblems = useMemo(() => getBodyTextProblems(form.bodyText), [form.bodyText]);
  const bodyLimit = bodyCharLimit(form.bodyText);
  const footerProblems = useMemo(() => (form.footerText ? getFooterTextProblems(form.footerText) : []), [form.footerText]);
  const buttonProblems = (btn: TemplateButton) =>
    btn.text || btn.url || btn.phone_number ? getButtonProblems(btn) : [];

  const nameValid = /^[a-z0-9_]+$/.test(form.name) && form.name.length <= TEMPLATE_LIMITS.name;
  const issues = useMemo(() => {
    const list = validateTemplateComponents(components);
    if (!nameValid) list.unshift('Template name is required (lowercase letters, numbers and underscores).');
    return list;
  }, [components, nameValid]);

  // Templates fetched from Meta carry a CDN link to their header sample
  const existingHeaderImageUrl =
    form.headerType === 'IMAGE' && form.headerHandle.startsWith('http') ? form.headerHandle : undefined;
  const footerHasOptOut =/stop|unsubscribe|opt.?out/i.test(form.footerText);
  const canSubmit = issues.length === 0 && !isSubmitting && !isUploading;

  const languageOptions = SUPPORTED_LANGUAGES.some((l) => l.code === form.language)
    ? SUPPORTED_LANGUAGES
    : [{ code: form.language, label: form.language }, ...SUPPORTED_LANGUAGES];

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const sanitized = e.target.value
      .toLowerCase()
      .replace(/[\s-]+/g, '_')
      .replace(/[^a-z0-9_]/g, '')
      .slice(0, TEMPLATE_LIMITS.name);
    update({ name: sanitized });
  };

  const handleHeaderTypeChange = (headerType: HeaderType) => {
    update({ headerType, headerHandle: '' });
    setHeaderFileName('');
    setHeaderPreviewUrl('');
  };

  // Insert the next body variable {{n}} at the cursor
  const handleAddVariable = () => {
    const textarea = bodyTextareaRef.current;
    if (!textarea) return;

    const tag = `{{${bodyVariables.length > 0 ? Math.max(...bodyVariables) + 1 : 1}}}`;
    const { selectionStart: start, selectionEnd: end } = textarea;
    update({ bodyText: `${form.bodyText.slice(0, start)}${tag}${form.bodyText.slice(end)}` });

    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + tag.length, start + tag.length);
    }, 0);
  };

  // Wrap the selection with WhatsApp formatting (*, _, ~, ```)
  const applyTextFormat = (wrapper: string) => {
    const textarea = bodyTextareaRef.current;
    if (!textarea) return;

    const { selectionStart: start, selectionEnd: end } = textarea;
    const selected = form.bodyText.slice(start, end);
    update({ bodyText: `${form.bodyText.slice(0, start)}${wrapper}${selected}${wrapper}${form.bodyText.slice(end)}` });

    const cursor = selected ? end + wrapper.length * 2 : start + wrapper.length;
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(cursor, cursor);
    }, 0);
  };

  const setBodySample = (index: number, value: string) => {
    const next = [...form.bodySamples];
    next[index] = value;
    update({ bodySamples: next });
  };

  const handleHeaderFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !isMediaHeader(form.headerType)) return;

    const rules = TEMPLATE_MEDIA_RULES[form.headerType];
    if (!rules.accept.includes(file.type) || file.size > rules.maxBytes) {
      gooeyToast.error('File not supported', { description: `Header ${form.headerType.toLowerCase()} must be ${rules.label}.` });
      return;
    }

    setIsUploading(true);
    try {
      const data = new FormData();
      data.append('file', file);
      data.append('format', form.headerType);
      if (phoneNumberId) data.append('phoneNumberId', phoneNumberId);
      const res = await apiClient.post('/api/channels/whatsapp/templates/media', data);

      update({ headerHandle: res.data.data.handle });
      setHeaderFileName(file.name);
      setHeaderPreviewUrl(form.headerType === 'DOCUMENT' ? '' : URL.createObjectURL(file));
    } catch (err) {
      notifyError(err, { where: 'TemplateEditorView.uploadHeader', title: 'Header sample not uploaded' });
    } finally {
      setIsUploading(false);
    }
  };

  // Buttons
  const handleAddButton = () => {
    if (form.buttons.length >= TEMPLATE_LIMITS.buttons) return;
    update({ buttons: [...form.buttons, { id: newButtonId(), type: 'QUICK_REPLY', text: '' }] });
  };

  const updateButton = (id: string, patch: Partial<TemplateButton>) => {
    update({ buttons: form.buttons.map((b) => (b.id === id ? { ...b, ...patch } : b)) });
  };

  const handleRemoveButton = (id: string) => {
    update({ buttons: form.buttons.filter((b) => b.id !== id) });
  };

  const handleSaveDraft = () => {
    try {
      // Upload handles are short-lived, so the header sample is re-uploaded after a restore
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...form, headerHandle: '' }));
      setHasDraft(true);
      gooeyToast.success('Draft saved', { description: 'It will be restored next time you create a template.' });
    } catch {
      gooeyToast.error('Could not save draft in this browser');
    }
  };

  const handleDiscardDraft = () => {
    clearDraft();
    setHasDraft(false);
    setForm(EMPTY_FORM);
    setHeaderFileName('');
    setHeaderPreviewUrl('');
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setIsSubmitting(true);

    try {
      if (isEdit) {
        await apiClient.put('/api/channels/whatsapp/templates', {
          templateId: initialTemplate!.id,
          components,
          ...(form.category !== initialTemplate!.category ? { category: form.category } : {}),
          phoneNumberId,
        });
        gooeyToast.success('Changes submitted to Meta', {
          description: `${form.name} goes back to review. Meta's review can take some time; the status updates here when it's done.`,
        });
      } else {
        const res = await apiClient.post('/api/channels/whatsapp/templates', {
          name: form.name,
          category: form.category,
          language: form.language,
          components,
          phoneNumberId,
        });
        if (mode === 'create') clearDraft();
        gooeyToast.success('Template submitted to Meta', {
          description: `${form.name} · ${res.data?.data?.status ?? 'PENDING'}`,
        });
      }
      onSuccess();
    } catch (err) {
      notifyError(err, { where: 'TemplateEditorView.submit', title: 'Template not submitted' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const title = isEdit ? 'Edit template' : mode === 'duplicate' ? 'Duplicate template' : 'New template';
  const inputClass = fieldClass();

  return (
    <div className="flex flex-col h-full bg-[#f8fafc] overflow-y-auto">
      {/* ── Top Bar ── */}
      <div className="h-16 bg-white border-b border-slate-200 px-6 flex items-center justify-between shrink-0 sticky top-0 z-10 shadow-xs">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-500 hover:text-slate-800 transition-colors"
            title="Back to templates"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <div className="flex items-center gap-2 text-xs text-slate-400 font-medium">
              <span onClick={onBack} className="hover:text-slate-600 cursor-pointer transition-colors">
                Templates
              </span>
              <span>&gt;</span>
              <span className="text-slate-600 font-mono">{form.name || 'new_template'}</span>
            </div>
            <h1 className="text-lg font-bold text-slate-900 leading-tight">{title}</h1>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {connectedNumber && (
            <span className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg border bg-[#ebf8f0] border-[#c9ecd6] text-[#17803d] text-xs font-semibold select-none mr-1">
              <span className="w-2 h-2 rounded-full bg-[#22a453]" />
              {connectedNumber}
            </span>
          )}
          {mode === 'create' && hasDraft && (
            <button
              type="button"
              onClick={handleDiscardDraft}
              className="px-3 py-2 text-xs font-semibold rounded-lg text-slate-500 hover:text-red-600 hover:bg-red-50 transition-colors cursor-pointer"
            >
              Discard draft
            </button>
          )}
          {mode === 'create' && (
            <button
              type="button"
              onClick={handleSaveDraft}
              className="px-4 py-2 text-xs font-semibold rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <Save className="w-3.5 h-3.5 text-slate-500" />
              Save draft
            </button>
          )}

          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            title={issues.length > 0 ? 'Fix the pre-submit checks first' : undefined}
            className="px-4 py-2 text-xs font-semibold rounded-lg bg-[#3440a8] hover:bg-[#2b358d] active:scale-[0.99] text-white shadow-xs transition-all flex items-center gap-2 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isSubmitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            {isEdit ? 'Submit changes' : 'Submit to Meta'}
          </button>
        </div>
      </div>

      {/* ── Main Content Grid ── */}
      <div className="max-w-7xl w-full mx-auto p-6 grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* ── Left / Form Column (7 of 12) ── */}
        <div className="lg:col-span-7 bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-6">
          {/* Template Name & Language */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="flex items-center gap-1 text-xs font-semibold text-slate-700 mb-1.5">
                Template name
                {isEdit && <Lock className="w-3 h-3 text-slate-400" />}
              </label>
              <CountedInput
                type="text"
                value={form.name}
                max={TEMPLATE_LIMITS.name}
                onChange={handleNameChange}
                disabled={isEdit}
                placeholder="e.g. payment_reminder"
                className="font-mono"
              />
              <p className="text-[11px] text-slate-400 mt-1">
                {isEdit ? "Meta doesn't allow renaming a template" : 'Lowercase letters, numbers and underscores only'}
              </p>
            </div>

            <div>
              <label className="flex items-center gap-1 text-xs font-semibold text-slate-700 mb-1.5">
                Language
                {isEdit && <Lock className="w-3 h-3 text-slate-400" />}
              </label>
              <select
                value={form.language}
                onChange={(e) => update({ language: e.target.value })}
                disabled={isEdit}
                className={inputClass}
              >
                {languageOptions.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-slate-400 mt-1">
                {isEdit
                  ? "Meta doesn't allow changing the language"
                  : 'For another language, submit again with the same name'}
              </p>
            </div>
          </div>

          {/* Category */}
          <div>
            <label className="flex items-center gap-1 text-xs font-semibold text-slate-700 mb-1.5">
              Category
              {categoryLocked && <Lock className="w-3 h-3 text-slate-400" />}
            </label>
            <div className="flex items-center gap-3">
              {(['UTILITY', 'MARKETING'] as TemplateCategory[]).map((cat) => {
                const isChecked = form.category === cat;
                return (
                  <label
                    key={cat}
                    className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border transition-all ${
                      categoryLocked ? 'cursor-not-allowed opacity-70' : 'cursor-pointer'
                    } ${
                      isChecked
                        ? 'border-[#3440a8] bg-indigo-50/50 text-[#3440a8]'
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <input
                      type="radio"
                      name="templateCategory"
                      checked={isChecked}
                      disabled={categoryLocked}
                      onChange={() => update({ category: cat })}
                      className="text-[#3440a8] focus:ring-[#3440a8] w-3.5 h-3.5"
                    />
                    <span>{cat.charAt(0) + cat.slice(1).toLowerCase()}</span>
                  </label>
                );
              })}
            </div>
            {categoryLocked && (
              <p className="text-[11px] text-slate-400 mt-1">The category can only be changed while a template is rejected</p>
            )}
          </div>

          {/* Header Section */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Header (optional)</label>
            <div className="flex items-center gap-3">
              <select
                value={form.headerType}
                onChange={(e) => handleHeaderTypeChange(e.target.value as HeaderType)}
                className="w-36 px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-[#3440a8]"
              >
                <option value="NONE">None</option>
                <option value="TEXT">Text</option>
                <option value="IMAGE">Image</option>
                <option value="VIDEO">Video</option>
                <option value="DOCUMENT">Document</option>
              </select>

              {form.headerType === 'TEXT' && (
                <div className="flex-1 flex items-center gap-2 min-w-0">
                  <CountedInput
                    type="text"
                    value={form.headerText}
                    max={TEMPLATE_LIMITS.headerText}
                    invalid={headerProblems.length > 0}
                    onChange={(e) => update({ headerText: e.target.value })}
                    placeholder="e.g. Order {{1}} · payment pending"
                  />
                  {headerVariables.length === 0 && (
                    <button
                      type="button"
                      onClick={() => update({ headerText: headerWithVariable })}
                      disabled={headerWithVariable.length > TEMPLATE_LIMITS.headerText}
                      title={
                        headerWithVariable.length > TEMPLATE_LIMITS.headerText
                          ? `No room for {{1}}: shorten the header to ${TEMPLATE_LIMITS.headerText - 6} characters or fewer`
                          : 'Add {{1}} at the end'
                      }
                      className="shrink-0 text-xs font-semibold text-[#3440a8] hover:text-[#2b358d] flex items-center gap-1 cursor-pointer disabled:cursor-not-allowed disabled:text-slate-300"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Variable
                    </button>
                  )}
                </div>
              )}

              {isMediaHeader(form.headerType) && (
                <div className="flex-1 flex items-center gap-2 min-w-0">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={TEMPLATE_MEDIA_RULES[form.headerType].accept.join(',')}
                    onChange={handleHeaderFile}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading}
                    className="px-3 py-2 text-xs font-semibold rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 flex items-center gap-1.5 cursor-pointer disabled:opacity-60 shrink-0"
                  >
                    {isUploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                    {form.headerHandle ? 'Replace sample' : 'Upload sample'}
                  </button>
                  <span className="text-[11px] text-slate-500 truncate">
                    {headerFileName ||
                      (form.headerHandle ? 'Using the current sample' : TEMPLATE_MEDIA_RULES[form.headerType].label)}
                  </span>
                </div>
              )}
            </div>

            <FieldProblems problems={headerProblems} />

            {form.headerType === 'TEXT' && headerVariables.length > 0 && (
              <div className="flex items-center gap-2 mt-2">
                <span className="font-mono text-xs font-bold text-[#3440a8] bg-indigo-50 border border-indigo-100 px-2 py-1.5 rounded-lg shrink-0">
                  {'{{1}}'}
                </span>
                <input
                  type="text"
                  value={form.headerSample}
                  onChange={(e) => update({ headerSample: e.target.value })}
                  placeholder="Sample value, e.g. #NC-2041"
                  className="w-full px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-[#3440a8]"
                />
              </div>
            )}
          </div>

          {/* Body Section */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold text-slate-700">Body</label>
              <span
                className="flex items-center gap-1"
                title={`1024 characters, plus ${TEMPLATE_LIMITS.bodyPerVariable} for each variable`}
              >
                <CharCounter count={form.bodyText.length} max={bodyLimit} />
                {bodyProblems.length > 0 && <Ban className="h-3.5 w-3.5 text-red-600" />}
              </span>
            </div>

            {/* No maxLength: pasted text isn't cut off silently; the counter and error show what's too long */}
            <div
              className={`border rounded-xl overflow-hidden focus-within:ring-1 bg-white transition-all ${
                bodyProblems.length > 0
                  ? 'border-red-400 focus-within:border-red-500 focus-within:ring-red-500'
                  : 'border-slate-200 focus-within:border-[#3440a8] focus-within:ring-[#3440a8]'
              }`}
            >
              <textarea
                ref={bodyTextareaRef}
                value={form.bodyText}
                onChange={(e) => update({ bodyText: e.target.value })}
                rows={5}
                placeholder="Hi {{1}}, thanks for shopping with us..."
                className="w-full p-3 text-sm text-slate-800 outline-none resize-none"
              />

              {/* Formatting Toolbar */}
              <div className="px-3 py-2 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-1 text-slate-600">
                  <button type="button" onClick={() => applyTextFormat('*')} className="w-7 h-7 rounded hover:bg-slate-200 flex items-center justify-center" title="Bold (*text*)">
                    <Bold className="w-3.5 h-3.5" />
                  </button>
                  <button type="button" onClick={() => applyTextFormat('_')} className="w-7 h-7 rounded hover:bg-slate-200 flex items-center justify-center" title="Italic (_text_)">
                    <Italic className="w-3.5 h-3.5" />
                  </button>
                  <button type="button" onClick={() => applyTextFormat('~')} className="w-7 h-7 rounded hover:bg-slate-200 flex items-center justify-center" title="Strikethrough (~text~)">
                    <Strikethrough className="w-3.5 h-3.5" />
                  </button>
                  <button type="button" onClick={() => applyTextFormat('```')} className="w-7 h-7 rounded hover:bg-slate-200 flex items-center justify-center" title="Monospace (```text```)">
                    <Code className="w-3.5 h-3.5" />
                  </button>
                </div>

                <button
                  type="button"
                  onClick={handleAddVariable}
                  className="text-xs font-semibold text-[#3440a8] hover:text-[#2b358d] flex items-center gap-1 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add variable
                </button>
              </div>
            </div>
            <FieldProblems problems={bodyProblems} />

            {bodyVariables.length > 0 && (
              <div className="mt-3">
                <p className="text-[11px] text-slate-400 mb-2">
                  Meta reviews templates with these sample values, so use realistic examples.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {bodyVariables.map((v) => (
                    <div key={v} className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold text-[#3440a8] bg-indigo-50 border border-indigo-100 px-2 py-1.5 rounded-lg shrink-0">
                        {`{{${v}}}`}
                      </span>
                      <input
                        type="text"
                        value={form.bodySamples[v - 1] ?? ''}
                        onChange={(e) => setBodySample(v - 1, e.target.value)}
                        placeholder={`Sample for {{${v}}}`}
                        className="w-full px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-[#3440a8]"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Footer Section */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Footer (optional)</label>
            <CountedInput
              type="text"
              value={form.footerText}
              max={TEMPLATE_LIMITS.footer}
              invalid={footerProblems.length > 0}
              onChange={(e) => update({ footerText: e.target.value })}
              placeholder="e.g. Reply STOP to stop messages"
            />
            <FieldProblems problems={footerProblems} />
          </div>

          {/* Buttons Section */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-slate-700">Buttons (optional)</label>
              <span className="text-[11px] text-slate-400 font-mono">
                {form.buttons.length} of {TEMPLATE_LIMITS.buttons}
              </span>
            </div>

            <div className="space-y-3">
              {form.buttons.map((btn) => (
                <div key={btn.id} className="p-3 rounded-xl border border-slate-200 bg-slate-50/50 space-y-2">
                  <div className="flex items-center gap-2">
                    <select
                      value={btn.type}
                      onChange={(e) => updateButton(btn.id, { type: e.target.value as TemplateButtonType })}
                      className="w-36 px-2.5 py-2 text-xs bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-[#3440a8]"
                    >
                      {(Object.keys(BUTTON_TYPE_LABELS) as TemplateButtonType[]).map((t) => (
                        <option key={t} value={t}>
                          {BUTTON_TYPE_LABELS[t]}
                        </option>
                      ))}
                    </select>
                    <CountedInput
                      type="text"
                      value={btn.text}
                      max={TEMPLATE_LIMITS.buttonText}
                      onChange={(e) => updateButton(btn.id, { text: e.target.value })}
                      placeholder="Button label"
                    />
                    <button
                      type="button"
                      onClick={() => handleRemoveButton(btn.id)}
                      className="w-8 h-8 shrink-0 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 flex items-center justify-center transition-colors"
                      title="Remove button"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  {btn.type === 'URL' && (
                    <div className="flex flex-col sm:flex-row gap-2">
                      <CountedInput
                        type="url"
                        value={btn.url ?? ''}
                        max={TEMPLATE_LIMITS.url}
                        onChange={(e) => updateButton(btn.id, { url: e.target.value })}
                        placeholder="https://example.com/track/{{1}}"
                        className="font-mono text-xs"
                      />
                      {extractVariables(btn.url).length > 0 && (
                        <input
                          type="text"
                          value={btn.example ?? ''}
                          onChange={(e) => updateButton(btn.id, { example: e.target.value })}
                          placeholder="Sample for {{1}}"
                          className={`${inputClass} sm:w-48 text-xs`}
                        />
                      )}
                    </div>
                  )}

                  {btn.type === 'PHONE_NUMBER' && (
                    <CountedInput
                      type="tel"
                      value={btn.phone_number ?? ''}
                      max={TEMPLATE_LIMITS.phoneNumber}
                      onChange={(e) => updateButton(btn.id, { phone_number: e.target.value })}
                      placeholder="+919876543210"
                      className="font-mono text-xs"
                    />
                  )}

                  <FieldProblems problems={buttonProblems(btn)} />
                </div>
              ))}

              {form.buttons.length < TEMPLATE_LIMITS.buttons && (
                <button
                  type="button"
                  onClick={handleAddButton}
                  className="text-xs font-semibold text-[#3440a8] hover:text-[#2b358d] flex items-center gap-1.5 cursor-pointer py-1"
                >
                  <Plus className="w-4 h-4" />
                  Add button
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ── Right Column: Preview & Checks (5 of 12) ── */}
        <div className="lg:col-span-5 space-y-6 lg:sticky lg:top-20">
          <div>
            <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">PREVIEW</div>
            <WhatsAppChatPreview
              businessName={businessName}
              headerType={form.headerType}
              headerText={form.headerText}
              headerSample={form.headerSample}
              headerMediaUrl={headerPreviewUrl || existingHeaderImageUrl}
              bodyText={form.bodyText}
              bodySamples={form.bodySamples}
              footerText={form.footerText}
              buttons={form.buttons}
            />
          </div>

          {/* Pre-submit checks Card */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4">
            <h3 className="text-sm font-bold text-slate-900">Pre-submit checks</h3>

            <div className="space-y-3">
              {issues.length === 0 ? (
                <div className="flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  <span className="text-xs text-slate-700 font-medium">Ready to submit: the template follows Meta&apos;s rules</span>
                </div>
              ) : (
                issues.map((issue) => (
                  <div key={issue} className="flex items-start gap-2.5">
                    <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                    <span className="text-xs text-slate-700 font-medium">{issue}</span>
                  </div>
                ))
              )}

              {form.category === 'MARKETING' && (
                <div className="flex items-start gap-2.5">
                  {footerHasOptOut ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  ) : (
                    <Info className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                  )}
                  <span className="text-xs text-slate-700 font-medium">
                    {footerHasOptOut
                      ? 'Footer includes an opt-out'
                      : 'Tip: add "Reply STOP to unsubscribe" in the footer to protect your quality rating'}
                  </span>
                </div>
              )}

              {isEdit && (
                <div className="flex items-start gap-2.5">
                  <Info className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                  <span className="text-xs text-slate-700 font-medium">
                    Edited templates go back to review. Meta allows one edit per day, up to 10 per month.
                  </span>
                </div>
              )}
            </div>

            <div className="pt-3 border-t border-slate-100 text-[11px] text-slate-500">
              {form.category === 'UTILITY' && 'Utility: updates about an order or account the customer already has. Promotional wording gets re-categorised as marketing.'}
              {form.category === 'MARKETING' && 'Marketing: offers, discounts, product launches and other promotional messages.'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
