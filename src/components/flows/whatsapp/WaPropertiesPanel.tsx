'use client';

import React from 'react';
import { Trash2, Copy, Plus, ArrowUp, ArrowDown, X, Monitor } from 'lucide-react';
import type {
  WaComponent,
  WaFlow,
  WaIssue,
  WaOption,
  WaOptionComponent,
  WaScreen,
} from '@/lib/whatsapp-flows/wa-flow-types';
import { isInputComponent, isOptionComponent } from '@/lib/whatsapp-flows/wa-flow-types';
import {
  FLOW_JSON_VERSIONS,
  LIMITS,
  makeOption,
  paletteItem,
  toFieldName,
  toOptionId,
  toScreenId,
} from '@/lib/whatsapp-flows/wa-component-registry';
import { footerOf } from '@/lib/whatsapp-flows/wa-flow-json';
import { WaPaletteIcon } from './WaComponentPalette';

// ─── Field primitives (match ConfigPanel styling) ────────────────────────────

const inputCls =
  'w-full px-3 py-2 text-[12px] rounded-xl border bg-slate-50 focus:outline-none focus:ring-2 focus:ring-[#3440a8]/20 focus:border-[#3440a8]/40 focus:bg-white placeholder:text-slate-400 transition-all';
const okBorder = 'border-slate-200';
const errBorder = 'border-red-300 bg-red-50/50';

function Field({
  label,
  hint,
  errors,
  count,
  max,
  children,
}: {
  label: string;
  hint?: string;
  errors?: string[];
  count?: number;
  max?: number;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="text-[11px] font-semibold text-slate-600">{label}</label>
        {max !== undefined && (
          <span className={`text-[10px] tabular-nums ${count !== undefined && count > max ? 'text-red-500 font-semibold' : 'text-slate-400'}`}>
            {count ?? 0}/{max}
          </span>
        )}
      </div>
      {children}
      {hint && !errors?.length && <p className="text-[10px] text-slate-400">{hint}</p>}
      {errors?.map((e) => (
        <p key={e} className="text-[10px] text-red-500">{e}</p>
      ))}
    </div>
  );
}

function TextField({
  label, value, onChange, max, placeholder, hint, errors, multiline, onBlur, mono,
}: {
  label: string;
  value: string | undefined;
  onChange: (v: string) => void;
  max?: number;
  placeholder?: string;
  hint?: string;
  errors?: string[];
  multiline?: boolean;
  onBlur?: () => void;
  mono?: boolean;
}) {
  const cls = `${inputCls} ${errors?.length ? errBorder : okBorder} ${mono ? 'font-mono' : ''}`;
  return (
    <Field label={label} hint={hint} errors={errors} count={(value ?? '').length} max={max}>
      {multiline ? (
        <textarea rows={3} value={value ?? ''} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} placeholder={placeholder} className={`${cls} resize-none`} />
      ) : (
        <input value={value ?? ''} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} placeholder={placeholder} className={cls} />
      )}
    </Field>
  );
}

function NumberField({
  label, value, onChange, hint, errors, min,
}: {
  label: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  hint?: string;
  errors?: string[];
  min?: number;
}) {
  return (
    <Field label={label} hint={hint} errors={errors}>
      <input
        type="number"
        min={min}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? undefined : Math.trunc(Number(e.target.value)))}
        placeholder="Not set"
        className={`${inputCls} ${errors?.length ? errBorder : okBorder}`}
      />
    </Field>
  );
}

function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="flex items-start gap-3 cursor-pointer">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`mt-0.5 w-8 h-[18px] shrink-0 rounded-full relative transition-colors ${checked ? 'bg-[#3440a8]' : 'bg-slate-300'}`}
      >
        <span className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white shadow transition-all ${checked ? 'left-[16px]' : 'left-[2px]'}`} />
      </button>
      <span>
        <span className="block text-[12px] font-medium text-slate-700">{label}</span>
        {hint && <span className="block text-[10px] text-slate-400">{hint}</span>}
      </span>
    </label>
  );
}

function SelectField<T extends string>({
  label, value, options, onChange, errors, hint,
}: {
  label: string;
  value: T | '';
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  errors?: string[];
  hint?: string;
}) {
  return (
    <Field label={label} errors={errors} hint={hint}>
      <select value={value} onChange={(e) => onChange(e.target.value as T)} className={`${inputCls} ${errors?.length ? errBorder : okBorder}`}>
        {value === '' && <option value="">Select…</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </Field>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3.5">
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{title}</p>
      {children}
    </div>
  );
}

// ─── Options editor (Dropdown / Radio / Checkbox) ────────────────────────────

function OptionsEditor({
  component, onChange, errors,
}: {
  component: WaOptionComponent;
  onChange: (options: WaOption[]) => void;
  errors?: string[];
}) {
  const max = component.type === 'dropdown' ? LIMITS.dropdownMaxOptions : LIMITS.selectionMaxOptions;
  const opts = component.options;
  const update = (i: number, patch: Partial<WaOption>) => onChange(opts.map((o, j) => (j === i ? { ...o, ...patch } : o)));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= opts.length) return;
    const next = [...opts];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  return (
    <Field label={`Options (${opts.length}/${max})`} errors={errors}>
      <div className="space-y-2">
        {opts.map((o, i) => (
          <div key={o.uid} className="rounded-xl border border-slate-200 bg-slate-50/60 p-2 space-y-1.5">
            <div className="flex items-center gap-1">
              <input
                value={o.title}
                onChange={(e) => {
                  const title = e.target.value;
                  // Keep the value in sync while it still mirrors the title.
                  const syncId = o.id === toOptionId(o.title);
                  update(i, { title, ...(syncId ? { id: toOptionId(title) } : {}) });
                }}
                placeholder="Option title"
                className={`${inputCls} ${okBorder} !py-1.5 !rounded-lg flex-1 bg-white`}
              />
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="w-6 h-6 rounded flex items-center justify-center text-slate-400 hover:bg-slate-200 disabled:opacity-30" title="Move up">
                <ArrowUp className="w-3 h-3" />
              </button>
              <button type="button" onClick={() => move(i, 1)} disabled={i === opts.length - 1} className="w-6 h-6 rounded flex items-center justify-center text-slate-400 hover:bg-slate-200 disabled:opacity-30" title="Move down">
                <ArrowDown className="w-3 h-3" />
              </button>
              <button type="button" onClick={() => onChange(opts.filter((_, j) => j !== i))} className="w-6 h-6 rounded flex items-center justify-center text-slate-400 hover:text-red-500 hover:bg-red-50" title="Remove option">
                <X className="w-3 h-3" />
              </button>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-slate-400 w-9 shrink-0">Value</span>
              <input
                value={o.id}
                onChange={(e) => update(i, { id: e.target.value })}
                placeholder="option_id"
                className={`${inputCls} ${okBorder} !py-1 !rounded-lg font-mono !text-[11px] bg-white`}
              />
            </div>
            <input
              value={o.description ?? ''}
              onChange={(e) => update(i, { description: e.target.value || undefined })}
              placeholder="Description (optional)"
              className={`${inputCls} ${okBorder} !py-1 !rounded-lg !text-[11px] bg-white`}
            />
            {o.title.length > LIMITS.optionTitle && (
              <p className="text-[10px] text-red-500">Title is {o.title.length}/{LIMITS.optionTitle} characters.</p>
            )}
          </div>
        ))}
        <button
          type="button"
          disabled={opts.length >= max}
          onClick={() => {
            const taken = new Set(opts.map((o) => o.id));
            let n = opts.length + 1;
            while (taken.has(toOptionId(`Option ${n}`))) n++;
            onChange([...opts, makeOption(`Option ${n}`)]);
          }}
          className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-xl border border-dashed border-slate-300 text-[11px] font-semibold text-slate-500 hover:text-[#3440a8] hover:border-[#3440a8]/50 disabled:opacity-40 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" /> Add option
        </button>
      </div>
    </Field>
  );
}

// ─── Component properties ────────────────────────────────────────────────────

function ComponentFields({
  c, flow, screen, err, set,
}: {
  c: WaComponent;
  flow: WaFlow;
  screen: WaScreen;
  err: (field: string) => string[] | undefined;
  set: (patch: Partial<WaComponent>) => void;
}) {
  const labelMax: Partial<Record<WaComponent['type'], number>> = {
    text_input: LIMITS.textInputLabel,
    text_area: LIMITS.textAreaLabel,
    dropdown: LIMITS.dropdownLabel,
    radio: LIMITS.selectionLabel,
    checkbox: LIMITS.selectionLabel,
    date: LIMITS.dateLabel,
    opt_in: LIMITS.optInLabel,
  };

  return (
    <>
      {(c.type === 'heading' || c.type === 'subheading' || c.type === 'body' || c.type === 'caption') && (
        <Section title="Content">
          <TextField label="Text" value={c.text} onChange={(text) => set({ text })} max={LIMITS[c.type]} multiline={c.type === 'body' || c.type === 'caption'} errors={err('text')} />
          {(c.type === 'body' || c.type === 'caption') && (
            <>
              <SelectField
                label="Font weight"
                value={c.fontWeight ?? 'normal'}
                options={[
                  { value: 'normal', label: 'Normal' },
                  { value: 'bold', label: 'Bold' },
                  { value: 'italic', label: 'Italic' },
                  { value: 'bold_italic', label: 'Bold italic' },
                ]}
                onChange={(fontWeight) => set({ fontWeight })}
              />
              <Toggle label="Strikethrough" checked={!!c.strikethrough} onChange={(strikethrough) => set({ strikethrough })} />
              <Toggle label="Markdown" hint="Render *bold*, _italic_, lists and links (Flow JSON 5.1+)." checked={!!c.markdown} onChange={(markdown) => set({ markdown })} />
            </>
          )}
        </Section>
      )}

      {isInputComponent(c) && (
        <Section title="Field">
          <TextField label="Label" value={c.label} onChange={(label) => set({ label })} max={labelMax[c.type]} multiline={c.type === 'opt_in'} errors={err('label')} />
          <TextField
            label="Field name"
            mono
            value={c.name}
            onChange={(name) => set({ name })}
            onBlur={() => c.name && set({ name: toFieldName(c.name) })}
            hint="Key used for this answer in the flow response. Unique across the flow."
            errors={err('name')}
          />
          <Toggle label="Required" hint="Customers must fill this before continuing." checked={c.required} onChange={(required) => set({ required })} />
        </Section>
      )}

      {c.type === 'text_input' && (
        <Section title="Input & validation">
          <SelectField
            label="Input type"
            value={c.inputType}
            options={[
              { value: 'text', label: 'Text' },
              { value: 'number', label: 'Number' },
              { value: 'email', label: 'Email' },
              { value: 'phone', label: 'Phone' },
              { value: 'password', label: 'Password' },
              { value: 'passcode', label: 'Passcode' },
            ]}
            onChange={(inputType) => set({ inputType })}
          />
          <TextField label="Helper text" value={c.helperText} onChange={(helperText) => set({ helperText: helperText || undefined })} max={LIMITS.helperText} errors={err('helperText')} />
          <div className="grid grid-cols-2 gap-2">
            <NumberField label="Min characters" min={0} value={c.minChars} onChange={(minChars) => set({ minChars })} errors={err('minChars')} />
            <NumberField label="Max characters" min={1} value={c.maxChars} onChange={(maxChars) => set({ maxChars })} hint="Default 80" errors={err('maxChars')} />
          </div>
          <TextField
            label="Pattern (regex)"
            mono
            value={c.pattern}
            onChange={(pattern) => set({ pattern: pattern || undefined })}
            placeholder="e.g. ^[0-9]{6}$"
            hint="Raw regex without slashes. Requires helper text. Text, number, password and passcode only."
            errors={err('pattern')}
          />
        </Section>
      )}

      {c.type === 'text_area' && (
        <Section title="Input & validation">
          <TextField label="Helper text" value={c.helperText} onChange={(helperText) => set({ helperText: helperText || undefined })} max={LIMITS.helperText} errors={err('helperText')} />
          <NumberField label="Max length" min={1} value={c.maxLength} onChange={(maxLength) => set({ maxLength })} hint={`Default and maximum ${LIMITS.textAreaMaxLength}`} errors={err('maxLength')} />
        </Section>
      )}

      {isOptionComponent(c) && (
        <Section title="Options">
          {(c.type === 'radio' || c.type === 'checkbox') && (
            <TextField label="Description" value={c.description} onChange={(description) => set({ description: description || undefined })} max={LIMITS.selectionDescription} errors={err('description')} />
          )}
          <OptionsEditor component={c} onChange={(options) => set({ options })} errors={err('options')} />
          {c.type === 'checkbox' && (
            <div className="grid grid-cols-2 gap-2">
              <NumberField label="Min selections" min={0} value={c.minSelected} onChange={(minSelected) => set({ minSelected })} errors={err('minSelected')} />
              <NumberField label="Max selections" min={1} value={c.maxSelected} onChange={(maxSelected) => set({ maxSelected })} errors={err('maxSelected')} />
            </div>
          )}
        </Section>
      )}

      {c.type === 'date' && (
        <Section title="Dates">
          <TextField label="Helper text" value={c.helperText} onChange={(helperText) => set({ helperText: helperText || undefined })} max={LIMITS.helperText} errors={err('helperText')} />
          <div className="grid grid-cols-2 gap-2">
            <Field label="Min date" errors={err('minDate')}>
              <input type="date" value={c.minDate ?? ''} onChange={(e) => set({ minDate: e.target.value || undefined })} className={`${inputCls} ${okBorder}`} />
            </Field>
            <Field label="Max date" errors={err('maxDate')}>
              <input type="date" value={c.maxDate ?? ''} onChange={(e) => set({ maxDate: e.target.value || undefined })} className={`${inputCls} ${okBorder}`} />
            </Field>
          </div>
          <TextField
            label="Unavailable dates"
            mono
            value={c.unavailableDates?.join(', ')}
            onChange={(v) => {
              const dates = v.split(',').map((d) => d.trim()).filter(Boolean);
              set({ unavailableDates: dates.length ? dates : undefined });
            }}
            placeholder="2026-12-25, 2027-01-01"
            hint="Comma-separated, YYYY-MM-DD."
            errors={err('unavailableDates')}
          />
        </Section>
      )}

      {c.type === 'footer' && (
        <>
          <Section title="Button">
            <TextField label="Button label" value={c.label} onChange={(label) => set({ label })} max={LIMITS.footerLabel} errors={err('label')} />
          </Section>
          <Section title="On click">
            <SelectField
              label="Action"
              value={c.action}
              options={[
                { value: 'navigate', label: 'Go to another screen' },
                { value: 'complete', label: 'Submit / complete the flow' },
              ]}
              onChange={(action) => set({ action })}
              hint={c.action === 'complete' ? 'This screen becomes a terminal screen; all answers are sent to your webhook.' : undefined}
            />
            {c.action === 'navigate' && (
              <SelectField
                label="Next screen"
                value={flow.screens.some((s) => s.uid === c.nextScreenUid) ? c.nextScreenUid! : ''}
                options={flow.screens
                  .filter((s) => s.uid !== screen.uid)
                  .map((s) => ({ value: s.uid, label: `${s.title || s.id} (${s.id})` }))}
                onChange={(nextScreenUid) => set({ nextScreenUid })}
                errors={err('nextScreenUid')}
              />
            )}
          </Section>
          <Section title="Captions">
            <TextField label="Center caption" value={c.centerCaption} onChange={(v) => set({ centerCaption: v || undefined })} max={LIMITS.footerCaption} errors={err('centerCaption')} hint="Use either center, or left/right." />
            <div className="grid grid-cols-2 gap-2">
              <TextField label="Left" value={c.leftCaption} onChange={(v) => set({ leftCaption: v || undefined })} max={LIMITS.footerCaption} errors={err('leftCaption')} />
              <TextField label="Right" value={c.rightCaption} onChange={(v) => set({ rightCaption: v || undefined })} max={LIMITS.footerCaption} errors={err('rightCaption')} />
            </div>
          </Section>
        </>
      )}
    </>
  );
}

// ─── Panel ───────────────────────────────────────────────────────────────────

export function WaPropertiesPanel({
  flow,
  screen,
  component,
  issues,
  onUpdateComponent,
  onUpdateScreen,
  onUpdateFlow,
  onDuplicateComponent,
  onDeleteComponent,
  onDeselect,
}: {
  flow: WaFlow;
  screen: WaScreen;
  component: WaComponent | null;
  issues: WaIssue[];
  onUpdateComponent: (uid: string, patch: Partial<WaComponent>) => void;
  onUpdateScreen: (uid: string, patch: Partial<WaScreen>) => void;
  onUpdateFlow: (patch: Partial<WaFlow>) => void;
  onDuplicateComponent: (uid: string) => void;
  onDeleteComponent: (uid: string) => void;
  onDeselect: () => void;
}) {
  const fieldErrors = (match: (i: WaIssue) => boolean) => (field: string) => {
    const msgs = issues
      .filter((i) => i.severity === 'error' && match(i) && i.field === field)
      .map((i) => i.message.replace(/^.*?: /, ''));
    return msgs.length ? msgs : undefined;
  };

  if (component) {
    const err = fieldErrors((i) => i.componentUid === component.uid);
    const item = paletteItem(component.type);
    return (
      <aside className="w-80 shrink-0 bg-white border-l border-slate-200 flex flex-col h-full overflow-hidden">
        <div className="px-4 py-3.5 border-b border-slate-100 flex items-center gap-2.5 shrink-0">
          <div className="w-8 h-8 rounded-lg bg-[#3440a8]/10 flex items-center justify-center">
            <WaPaletteIcon type={component.type} className="w-4 h-4 text-[#3440a8]" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-[13px] font-bold text-slate-800">{item.label}</h3>
            <p className="text-[10px] text-slate-400 font-mono">{item.metaType}</p>
          </div>
          <button onClick={onDeselect} className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors" title="Back to screen properties">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6">
          <ComponentFields
            c={component}
            flow={flow}
            screen={screen}
            err={err}
            set={(patch) => onUpdateComponent(component.uid, patch)}
          />
        </div>
        <div className="px-4 py-3 border-t border-slate-100 shrink-0 flex items-center gap-2">
          <button
            onClick={() => onDuplicateComponent(component.uid)}
            disabled={component.type === 'footer'}
            className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 text-[12px] font-semibold transition-colors disabled:opacity-40"
          >
            <Copy className="w-3.5 h-3.5" /> Duplicate
          </button>
          <button
            onClick={() => onDeleteComponent(component.uid)}
            className="w-9 h-9 rounded-xl flex items-center justify-center border border-slate-200 text-red-400 hover:bg-red-50 hover:border-red-200 transition-colors"
            title="Delete component"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </aside>
    );
  }

  const err = fieldErrors((i) => i.screenUid === screen.uid && !i.componentUid);
  const terminal = footerOf(screen)?.action === 'complete';
  const index = flow.screens.findIndex((s) => s.uid === screen.uid);

  return (
    <aside className="w-80 shrink-0 bg-white border-l border-slate-200 flex flex-col h-full overflow-hidden">
      <div className="px-4 py-3.5 border-b border-slate-100 flex items-center gap-2.5 shrink-0">
        <div className="w-8 h-8 rounded-lg bg-[#3440a8]/10 flex items-center justify-center">
          <Monitor className="w-4 h-4 text-[#3440a8]" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-[13px] font-bold text-slate-800">Screen properties</h3>
          <p className="text-[10px] text-slate-400">
            Screen {index + 1} of {flow.screens.length}
            {index === 0 && ' · entry screen'}
            {terminal && ' · submits flow'}
          </p>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6">
        <Section title="Screen">
          <TextField label="Title" value={screen.title} onChange={(title) => onUpdateScreen(screen.uid, { title })} hint="Shown in the WhatsApp top bar." errors={err('title')} />
          <TextField
            label="Screen ID"
            mono
            value={screen.id}
            onChange={(id) => onUpdateScreen(screen.uid, { id: id.toUpperCase().replace(/[^A-Z_]/g, '_') })}
            onBlur={() => onUpdateScreen(screen.uid, { id: toScreenId(screen.id) })}
            hint="Letters and underscores. Navigation links follow renames automatically."
            errors={err('id')}
          />
          {terminal && (
            <Toggle
              label="Successful outcome"
              hint="Whether completing the flow on this screen counts as a success."
              checked={screen.success}
              onChange={(success) => onUpdateScreen(screen.uid, { success })}
            />
          )}
        </Section>
        <Section title="Flow">
          <SelectField
            label="Flow JSON version"
            value={flow.version}
            options={FLOW_JSON_VERSIONS.map((v) => ({ value: v, label: v }))}
            onChange={(version) => onUpdateFlow({ version })}
          />
          <p className="text-[10px] text-slate-400 leading-relaxed">
            Static flow: screens and options are defined here; no data endpoint is used. Select a component on the screen to edit it.
          </p>
        </Section>
      </div>
    </aside>
  );
}
