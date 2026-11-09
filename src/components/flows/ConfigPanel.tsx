'use client';

import React, { createContext, useContext, useMemo, useState } from 'react';
import { AlertTriangle, Check, Info, Trash2, X } from 'lucide-react';
import type { AutomationNodeData } from './flow-types';
import { SendWhatsAppFlowFields } from './whatsapp/AutomationFlowFields';
import { nodeConfigFieldIssues } from '@/lib/automation/validate';
import { getPaletteItem, themeOf } from './palette-config';
import { NodeTypeIcon } from './node-icons';
import {
  ASSIGNEE_OPTIONS, ATTRIBUTE_OPTIONS, CONTACT_FIELD_OPTIONS, EVENT_OPTIONS, OPERATOR_OPTIONS, type Option,
} from './node-options';

interface ConfigPanelProps {
  nodeId: string;
  data: AutomationNodeData;
  /** Issues flagged on this step's card (connections, loops… as well as missing settings). */
  issues?: string[];
  onUpdate: (id: string, data: Partial<AutomationNodeData>) => void;
  onClose: () => void;
  onDelete: (id: string) => void;
}

/** Field errors by data key, shown under the matching input. */
const FieldErrorsContext = createContext<Record<string, string>>({});

export interface FieldProps {
  label: string;
  children: React.ReactNode;
  /** Data key; shows that field's validation error. */
  name?: string;
  required?: boolean;
  hint?: string;
}

export function Field({ label, children, name, required, hint }: FieldProps) {
  const errors = useContext(FieldErrorsContext);
  const error = name ? errors[name] : undefined;
  return (
    <div className="flex flex-col gap-1.5" data-invalid={error ? true : undefined}>
      <label className="text-[11.5px] font-medium text-slate-700">
        {required && <span className="text-red-500 mr-0.5" aria-hidden>*</span>}
        {label}
      </label>
      {children}
      {error ? (
        <p role="alert" className="text-[11px] text-red-600 flex items-start gap-1">
          <AlertTriangle className="w-3 h-3 shrink-0 mt-px" />
          {error}
        </p>
      ) : hint ? (
        <p className="text-[11px] text-slate-500 leading-snug">{hint}</p>
      ) : null}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="px-4 py-4 border-b border-slate-100 last:border-b-0">
      <h4 className="text-[10.5px] font-semibold uppercase tracking-wider text-slate-500 mb-3">{title}</h4>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

/** Strips the UI-only fields FlowView adds to node data for rendering. */
function toLocal(data: AutomationNodeData): Record<string, unknown> {
  return Object.fromEntries(Object.entries(data).filter(([k]) => !k.startsWith('_')));
}

/** Properties panel for the selected step: edits are kept locally until Apply. */
export function ConfigPanel({ nodeId, data, issues = [], onUpdate, onClose, onDelete }: ConfigPanelProps) {
  const [local, setLocal] = useState<Record<string, unknown>>(() => toLocal(data));
  // Once the user has tried to save the automation, show the step's missing settings right away
  const [errors, setErrors] = useState<Record<string, string>>(() =>
    issues.length ? errorMap(nodeConfigFieldIssues(data.type, toLocal(data))) : {},
  );
  const [touched, setTouched] = useState(false);

  const item = getPaletteItem(data.type);
  const theme = themeOf(data.type);

  const set = (key: string, value: unknown) => {
    setTouched(true);
    setLocal((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      if (!(key in prev)) return prev;
      const { [key]: _removed, ...rest } = prev;
      return rest;
    });
  };

  // Canvas-level problems (not about a single field), e.g. "Connect this trigger to the first step."
  const fieldMessages = useMemo(
    () => new Set(nodeConfigFieldIssues(data.type, toLocal(data)).map((i) => i.message)),
    [data],
  );
  const graphIssues = issues.filter((m) => !fieldMessages.has(m));

  const apply = () => {
    const problems = nodeConfigFieldIssues(data.type, local);
    if (problems.length) {
      setErrors(errorMap(problems));
      return;
    }
    onUpdate(nodeId, { ...local, configured: true } as Partial<AutomationNodeData>);
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      apply();
    }
  };

  const errorCount = Object.keys(errors).length;

  return (
    <aside
      onKeyDown={onKeyDown}
      aria-label="Step properties"
      className="absolute inset-y-0 right-0 z-30 w-[360px] max-w-full shadow-2xl md:static md:shadow-none shrink-0 bg-white border-l border-slate-200 flex flex-col h-full overflow-hidden af-slide-in"
    >
      {/* Header */}
      <div className="px-4 pt-4 pb-3 border-b border-slate-100 shrink-0">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 text-white" style={{ backgroundColor: theme.accent }}>
            <NodeTypeIcon type={data.type} className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: theme.text }}>
              {theme.singular} · {item?.label ?? data.type}
            </p>
            <h3 className="text-[14px] font-semibold text-slate-800 truncate mt-0.5">
              {String(local.label ?? '').trim() || 'Untitled step'}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
            title="Close (Esc)"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        {item?.description && <p className="text-[12px] text-slate-500 mt-2.5 leading-snug">{item.description}</p>}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        {graphIssues.length > 0 && (
          <div role="alert" className="mx-4 mt-4 px-3 py-2.5 rounded-lg bg-red-50 border border-red-200">
            <p className="text-[11.5px] font-semibold text-red-700 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" />
              On the canvas
            </p>
            <ul className="mt-1 space-y-0.5 text-[11.5px] text-red-700 leading-snug">
              {graphIssues.map((m) => <li key={m}>{m}</li>)}
            </ul>
          </div>
        )}

        <FieldErrorsContext.Provider value={errors}>
          <Section title="General">
            <Field label="Label" hint="Shown on the canvas so others can tell steps apart.">
              <input
                value={String(local.label ?? '')}
                onChange={(e) => set('label', e.target.value)}
                className={inputCls}
                placeholder={item?.label ?? 'Step name'}
                maxLength={80}
              />
            </Field>
          </Section>

          <Section title="Settings">
            <TypeFields type={data.type} local={local} set={set} />
          </Section>

          {data.type === 'condition_if_else' && (
            <Section title="Paths">
              <div className="space-y-2 text-[11.5px] text-slate-600 leading-snug">
                <p className="flex items-start gap-2">
                  <span className="mt-0.5 px-1.5 rounded-full text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200">True</span>
                  When the rule matches, the automation follows the True path.
                </p>
                <p className="flex items-start gap-2">
                  <span className="mt-0.5 px-1.5 rounded-full text-[10px] font-semibold text-red-700 bg-red-50 border border-red-200">False</span>
                  Otherwise it follows the False path.
                </p>
              </div>
            </Section>
          )}
        </FieldErrorsContext.Provider>
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-slate-100 shrink-0 flex items-center gap-2 bg-slate-50/60">
        <button
          type="button"
          onClick={() => onDelete(nodeId)}
          className="w-9 h-9 rounded-lg flex items-center justify-center border border-slate-200 bg-white text-slate-400 hover:text-red-600 hover:bg-red-50 hover:border-red-200 transition-colors"
          title="Delete step"
          aria-label="Delete step"
        >
          <Trash2 className="w-4 h-4" />
        </button>
        <span className="flex-1 text-[11px] text-red-600 truncate">
          {errorCount > 0 && `Fix ${errorCount} ${errorCount === 1 ? 'field' : 'fields'} to apply`}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="px-3 h-9 rounded-lg border border-slate-200 bg-white text-[12px] font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
          title={touched ? 'Discard changes to this step' : 'Close'}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={apply}
          className="px-3.5 h-9 rounded-lg bg-[#3440a8] hover:bg-[#2a3490] text-white text-[12px] font-semibold flex items-center gap-1.5 transition-colors"
          title="Apply (Ctrl+Enter)"
        >
          <Check className="w-3.5 h-3.5" />
          Apply
        </button>
      </div>
    </aside>
  );
}

function errorMap(list: { field: string; message: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const { field, message } of list) if (!out[field]) out[field] = message;
  return out;
}

// ─── Type-specific fields ─────────────────────────────────────────────────────

function Select({ value, onChange, options, placeholder, invalid }: {
  value: unknown;
  onChange: (v: string) => void;
  options: Option[];
  placeholder: string;
  invalid?: boolean;
}) {
  return (
    <select
      value={String(value ?? '')}
      onChange={(e) => onChange(e.target.value)}
      className={`${inputCls} ${invalid ? invalidCls : ''}`}
    >
      <option value="">{placeholder}</option>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

function TypeFields({
  type,
  local,
  set,
}: {
  type: string;
  local: Record<string, unknown>;
  set: (k: string, v: unknown) => void;
}) {
  const errors = useContext(FieldErrorsContext);
  const bad = (k: string) => (errors[k] ? invalidCls : '');

  switch (type) {
    case 'trigger_incoming_message':
      return <Note>Runs every time a customer sends a message. Nothing to set up.</Note>;

    case 'trigger_keyword':
      return (
        <Field label="Keywords" name="keywords" required hint="Separate keywords with commas. Phrases are allowed.">
          <KeywordsInput keywords={local.keywords} onChange={(k) => set('keywords', k)} placeholder="e.g. hello, help, start" invalid={!!errors.keywords} />
        </Field>
      );

    case 'trigger_conversation_event':
      return (
        <Field label="Event" name="event" required>
          <Select value={local.event} onChange={(v) => set('event', v)} options={EVENT_OPTIONS} placeholder="Select an event…" invalid={!!errors.event} />
        </Field>
      );

    case 'condition_if_else':
    case 'condition_contact_attribute':
      return (
        <>
          <Field label="Attribute" name="attribute" required hint="What to check about the message or contact.">
            <Select value={local.attribute} onChange={(v) => set('attribute', v)} options={ATTRIBUTE_OPTIONS} placeholder="Select an attribute…" invalid={!!errors.attribute} />
          </Field>
          <Field label="Operator" name="operator" required>
            <Select value={local.operator} onChange={(v) => set('operator', v)} options={OPERATOR_OPTIONS} placeholder="Select an operator…" invalid={!!errors.operator} />
          </Field>
          {local.operator !== 'is_empty' && (
            <Field label="Value" name="value" required>
              <input
                value={String(local.value ?? '')}
                onChange={(e) => set('value', e.target.value)}
                className={`${inputCls} ${bad('value')}`}
                placeholder="Enter a value…"
              />
            </Field>
          )}
        </>
      );

    case 'condition_keyword_match':
      return (
        <Field label="Keywords to match" name="keywords" required hint="Separate keywords with commas. The automation continues only on a match.">
          <KeywordsInput keywords={local.keywords} onChange={(k) => set('keywords', k)} placeholder="e.g. price, order, help" invalid={!!errors.keywords} />
        </Field>
      );

    case 'action_send_message':
      return (
        <Field label="Message" name="messageContent" required>
          <textarea
            value={String(local.messageContent ?? '')}
            onChange={(e) => set('messageContent', e.target.value)}
            className={`${inputCls} resize-y min-h-[96px] ${bad('messageContent')}`}
            rows={4}
            placeholder="Type the reply to send…"
          />
        </Field>
      );

    case 'action_send_template':
      return (
        <Field label="Template ID" name="templateId" required hint="The name of an approved WhatsApp template.">
          <input
            value={String(local.templateId ?? '')}
            onChange={(e) => set('templateId', e.target.value)}
            className={`${inputCls} ${bad('templateId')}`}
            placeholder="e.g. welcome_message_v1"
          />
        </Field>
      );

    case 'action_assign_conversation':
      return (
        <Field label="Assign to" name="assignTo" required>
          <Select value={local.assignTo} onChange={(v) => set('assignTo', v)} options={ASSIGNEE_OPTIONS} placeholder="Select an agent or team…" invalid={!!errors.assignTo} />
        </Field>
      );

    case 'action_update_contact':
      return (
        <>
          <Field label="Contact field" name="updateField" required>
            <Select value={local.updateField} onChange={(v) => set('updateField', v)} options={CONTACT_FIELD_OPTIONS} placeholder="Select a field…" invalid={!!errors.updateField} />
          </Field>
          <Field label="New value" name="updateValue" required>
            <input
              value={String(local.updateValue ?? '')}
              onChange={(e) => set('updateValue', e.target.value)}
              className={`${inputCls} ${bad('updateValue')}`}
              placeholder="New value…"
            />
          </Field>
        </>
      );

    case 'action_send_whatsapp_flow':
      return <SendWhatsAppFlowFields local={local} set={set} inputCls={inputCls} Field={Field} />;

    case 'flow_end':
      return <Note>Stops the automation on this path. Nothing to set up.</Note>;

    default:
      return <Note>No additional configuration is needed for this step.</Note>;
  }
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 text-[12px] text-slate-500 leading-snug bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5">
      <Info className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-px" />
      {children}
    </p>
  );
}

/**
 * Comma-separated keywords. The field keeps exactly what the user typed (trailing commas, spaces
 * inside phrases); only the stored list is cleaned. Rebuilding the text from the list on every
 * keystroke made "Hello," impossible to delete and phrases impossible to type.
 */
function KeywordsInput({
  keywords,
  onChange,
  placeholder,
  invalid,
}: {
  keywords: unknown;
  onChange: (keywords: string[]) => void;
  placeholder: string;
  invalid?: boolean;
}) {
  const [text, setText] = useState(() => (Array.isArray(keywords) ? keywords.map(String).filter((k) => k.trim()).join(', ') : ''));
  const list = Array.isArray(keywords) ? keywords.map(String).filter((k) => k.trim()) : [];
  return (
    <>
      <input
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          onChange(e.target.value.split(',').map((k) => k.trim()).filter(Boolean));
        }}
        className={`${inputCls} ${invalid ? invalidCls : ''}`}
        placeholder={placeholder}
      />
      {list.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {list.map((k, i) => (
            <span key={`${k}-${i}`} className="text-[11px] text-[#2a3490] bg-[#eef0fb] border border-[#3440a8]/15 rounded-md px-1.5 py-px">
              {k}
            </span>
          ))}
        </div>
      )}
    </>
  );
}

const inputCls =
  'w-full px-3 py-2 text-[12.5px] rounded-lg border border-slate-200 bg-white text-slate-800 ' +
  'focus:outline-none focus:ring-2 focus:ring-[#3440a8]/20 focus:border-[#3440a8]/50 transition-all ' +
  'placeholder:text-slate-400 disabled:bg-slate-50 disabled:text-slate-500';

const invalidCls = '!border-red-300 focus:!ring-red-200 focus:!border-red-400';
