'use client';

import React, { createContext, useContext, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, Info, Loader2, Pencil, Trash2, X } from 'lucide-react';
import type { AutomationNodeData } from './flow-types';
import { SendWhatsAppFlowFields } from './whatsapp/AutomationFlowFields';
import { nodeConfigFieldIssues } from '@/lib/automation/validate';
import {
  BASE_ATTRIBUTES, CONTACT_UPDATE_FIELDS, CONTACT_VARIABLES, MESSAGE_VARIABLES, NO_VALUE_OPERATORS, OPERATOR_LABELS,
  attributeDef, flowAttribute, type FlowField, type FlowScope,
} from '@/lib/automation/variables';
import { getPaletteItem, themeOf } from './palette-config';
import { NodeTypeIcon } from './node-icons';
import { ASSIGNEE_OPTIONS, EVENT_OPTIONS, type Option } from './node-options';
import { usePublishedFlows } from './use-published-flows';
import { VariableInput, VariablesContext, type VariableGroup } from './VariableInput';
import { TemplateFields } from './TemplateFields';
import { MessageMediaField } from './MessageMediaField';
import { AiAgentFields } from './AiAgentFields';
import { automationMediaOf } from '@/lib/automation/media';

/** Where the selected step sits relative to Flow sends and waits (from validate.flowsInScope). */
export interface StepFlowContext {
  /** A Wait for Flow Submission step runs before this one, so Flow answers are available */
  available: boolean;
  /** Flows whose answers are available */
  flowIds: number[];
  /** For a Wait step: the Flows it waits for */
  waitsFor: number[];
}

interface ConfigPanelProps {
  nodeId: string;
  data: AutomationNodeData;
  /** Issues flagged on this step's card (connections, loops… as well as missing settings). */
  issues?: string[];
  flowContext: StepFlowContext;
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

/** Step label: read-only until the pencil is clicked; Enter, Esc or leaving the field locks it again. */
function LabelInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const startEditing = () => {
    setEditing(true);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  };

  return (
    <div className="relative">
      <input
        ref={inputRef}
        value={value}
        readOnly={!editing}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            setEditing(false);
          } else if (e.key === 'Escape' && editing) {
            e.stopPropagation(); // stop editing without closing the panel
            setEditing(false);
          }
        }}
        className={`${inputCls} pr-9 ${editing ? '' : 'bg-slate-50 text-slate-700 cursor-default focus:ring-0'}`}
        placeholder={placeholder}
        maxLength={80}
        aria-label="Step label"
      />
      <button
        type="button"
        // Keep focus in the input so clicking the pencil while editing doesn't blur-then-reopen
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => (editing ? inputRef.current?.blur() : startEditing())}
        className={`absolute right-1.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-md flex items-center justify-center transition-colors ${
          editing ? 'text-indigo-600 bg-indigo-50' : 'text-slate-400 hover:text-slate-700 hover:bg-slate-100'
        }`}
        title={editing ? 'Done editing' : 'Edit label'}
        aria-label={editing ? 'Done editing label' : 'Edit label'}
        aria-pressed={editing}
      >
        <Pencil className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

/** Strips the UI-only fields FlowView adds to node data for rendering. */
function toLocal(data: AutomationNodeData): Record<string, unknown> {
  return Object.fromEntries(Object.entries(data).filter(([k]) => !k.startsWith('_')));
}

/** Properties panel for the selected step: edits are kept locally until Apply. */
export function ConfigPanel({ nodeId, data, issues = [], flowContext, onUpdate, onClose, onDelete }: ConfigPanelProps) {
  const [local, setLocal] = useState<Record<string, unknown>>(() => toLocal(data));
  const { flows } = usePublishedFlows();

  // Flow questions this step can use (null while loading or when a Flow isn't published)
  const flowScope = useMemo<FlowScope>(() => {
    if (!flowContext.available || !flows) return { available: flowContext.available, fields: null };
    const seen = new Set<string>();
    const fields: FlowField[] = [];
    for (const id of flowContext.flowIds) {
      const f = flows.find((x) => x.id === id);
      if (!f?.publishedVersion) return { available: true, fields: null };
      for (const q of f.publishedVersion.fields) {
        if (!seen.has(q.name)) {
          seen.add(q.name);
          fields.push(q);
        }
      }
    }
    return { available: true, fields };
  }, [flowContext, flows]);

  const variableGroups = useMemo<VariableGroup[]>(() => [
    { title: 'Contact', items: CONTACT_VARIABLES },
    { title: 'Message', items: MESSAGE_VARIABLES },
    {
      title: 'Flow answers',
      items: (flowScope.fields ?? []).map((f) => ({ path: `flow.${f.name}`, label: f.label })),
      emptyHint: flowScope.available
        ? 'Loading the Flow’s questions…'
        : 'Add Send WhatsApp Flow → Wait for Flow Submission before this step to use the customer’s answers.',
    },
  ], [flowScope]);

  // Once the user has tried to save the automation, show the step's missing settings right away
  const [errors, setErrors] = useState<Record<string, string>>(() =>
    issues.length ? errorMap(nodeConfigFieldIssues(data.type, toLocal(data), flowScope)) : {},
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
    () => new Set(nodeConfigFieldIssues(data.type, toLocal(data), flowScope).map((i) => i.message)),
    [data, flowScope],
  );
  const graphIssues = issues.filter((m) => !fieldMessages.has(m));

  const apply = () => {
    const problems = nodeConfigFieldIssues(data.type, local, flowScope);
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

        <VariablesContext.Provider value={variableGroups}>
        <FieldErrorsContext.Provider value={errors}>
          <Section title="General">
            <Field label="Label" hint="Shown on the canvas so others can tell steps apart.">
              <LabelInput
                value={String(local.label ?? '')}
                onChange={(v) => set('label', v)}
                placeholder={item?.label ?? 'Step name'}
              />
            </Field>
          </Section>

          <Section title="Settings">
            <TypeFields type={data.type} local={local} set={set} flowScope={flowScope} waitsFor={flowContext.waitsFor} />
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
          {data.type === 'action_ai_agent' && (
            <Section title="Paths">
              <div className="space-y-2 text-[11.5px] text-slate-600 leading-snug">
                <p className="flex items-start gap-2">
                  <span className="mt-0.5 px-1.5 rounded-full text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200">Replied</span>
                  The agent answered the customer (or asked them for details).
                </p>
                <p className="flex items-start gap-2">
                  <span className="mt-0.5 px-1.5 rounded-full text-[10px] font-semibold text-amber-800 bg-amber-50 border border-amber-200">Handover</span>
                  A person should take over: refunds, exchanges, an upset customer, a request for a person, or the agent is paused. Add Assign Conversation here.
                </p>
              </div>
            </Section>
          )}
        </FieldErrorsContext.Provider>
        </VariablesContext.Provider>
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
  flowScope,
  waitsFor,
}: {
  type: string;
  local: Record<string, unknown>;
  set: (k: string, v: unknown) => void;
  flowScope: FlowScope;
  waitsFor: number[];
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
      return <ConditionFields local={local} set={set} flowScope={flowScope} />;

    case 'condition_keyword_match':
      return (
        <Field label="Keywords to match" name="keywords" required hint="Separate keywords with commas. The automation continues only on a match.">
          <KeywordsInput keywords={local.keywords} onChange={(k) => set('keywords', k)} placeholder="e.g. price, order, help" invalid={!!errors.keywords} />
        </Field>
      );

    case 'action_send_message': {
      const media = automationMediaOf(local);
      return (
        <>
          <Field
            label={media ? 'Caption' : 'Message'}
            name="messageContent"
            required={!media}
            hint={
              media?.kind === 'audio'
                ? 'WhatsApp doesn’t show captions on audio, so this text is sent as a separate message after it.'
                : media
                  ? 'Optional. Shown under the file. Use Insert variable to personalise it.'
                  : 'Use Insert variable to personalise it, e.g. with the contact’s name.'
            }
          >
            <VariableInput
              multiline
              value={String(local.messageContent ?? '')}
              onChange={(v) => set('messageContent', v)}
              className={`${inputCls} min-h-[96px] ${bad('messageContent')}`}
              placeholder="Hi {{contact.name}}, thanks for your message!"
            />
          </Field>
          <Field label="Attachment" hint="Optional. Sent with every run of this step.">
            <MessageMediaField
              value={local.media}
              onChange={(m) => {
                set('media', m);
                // Adding a file makes an empty message valid, so its "enter a message" error no longer applies
                if (m) set('messageContent', local.messageContent ?? '');
              }}
            />
          </Field>
        </>
      );
    }

    case 'action_send_template':
      return <TemplateFields local={local} set={set} inputCls={inputCls} Field={Field} />;

    case 'action_assign_conversation':
      return (
        <Field label="Assign to" name="assignTo" required>
          <Select value={local.assignTo} onChange={(v) => set('assignTo', v)} options={ASSIGNEE_OPTIONS} placeholder="Select an agent or team…" invalid={!!errors.assignTo} />
        </Field>
      );

    case 'action_update_contact': {
      const field = CONTACT_UPDATE_FIELDS.find((f) => f.value === local.updateField);
      const options: Option[] = [...CONTACT_UPDATE_FIELDS];
      if (local.updateField && !field) options.push({ value: String(local.updateField), label: `${String(local.updateField)} (can’t be saved)` });
      const isTag = field?.value === 'tag' || field?.value === 'remove_tag';
      return (
        <>
          <Field label="Update" name="updateField" required>
            <Select value={local.updateField} onChange={(v) => set('updateField', v)} options={options} placeholder="Choose what to update…" invalid={!!errors.updateField} />
          </Field>
          <Field label={isTag ? 'Tag' : 'New value'} name="updateValue" required hint={field?.hint}>
            <VariableInput
              value={String(local.updateValue ?? '')}
              onChange={(v) => set('updateValue', v)}
              className={`${inputCls} ${bad('updateValue')}`}
              placeholder={field?.placeholder ?? 'New value…'}
            />
          </Field>
        </>
      );
    }

    case 'action_ai_agent':
      return <AiAgentFields local={local} set={set} inputCls={inputCls} invalidCls={invalidCls} errors={errors} Field={Field} />;

    case 'action_send_whatsapp_flow':
      return <SendWhatsAppFlowFields local={local} set={set} inputCls={inputCls} Field={Field} />;

    case 'flow_wait_flow_submission':
      return <WaitFields waitsFor={waitsFor} />;

    case 'flow_end':
      return <Note>Stops the automation on this path. Nothing to set up.</Note>;

    default:
      return <Note>No additional configuration is needed for this step.</Note>;
  }
}

/** Attribute → condition → value, offering only the combinations that work for the chosen attribute. */
function ConditionFields({
  local,
  set,
  flowScope,
}: {
  local: Record<string, unknown>;
  set: (k: string, v: unknown) => void;
  flowScope: FlowScope;
}) {
  const errors = useContext(FieldErrorsContext);
  const attribute = String(local.attribute ?? '');
  const operator = String(local.operator ?? '');
  const flowAttrs = (flowScope.fields ?? []).map(flowAttribute);
  const def = attributeDef(attribute, flowScope.fields);
  const isFlow = attribute.startsWith('flow.');
  const flowLoading = isFlow && flowScope.available && !flowScope.fields;
  const legacy = !!attribute && !def && !flowLoading;

  const chooseAttribute = (value: string) => {
    const next = attributeDef(value, flowScope.fields);
    set('attribute', value);
    set('attributeLabel', value.startsWith('flow.') ? next?.label : undefined);
    set('operator', next?.operators[0] ?? '');
    set('value', '');
    set('valueLabel', undefined);
  };

  return (
    <>
      <Field label="Check" name="attribute" required>
        <select value={attribute} onChange={(e) => chooseAttribute(e.target.value)} className={`${inputCls} ${errors.attribute ? invalidCls : ''}`}>
          <option value="">Choose what to check…</option>
          <optgroup label="Message & contact">
            {BASE_ATTRIBUTES.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
          </optgroup>
          {flowAttrs.length > 0 && (
            <optgroup label="Flow answers">
              {flowAttrs.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
            </optgroup>
          )}
          {(legacy || flowLoading) && (
            <option value={attribute}>
              {String(local.attributeLabel || attribute)}{legacy ? ' (no longer available)' : ''}
            </option>
          )}
        </select>
        {!flowScope.available && (
          <p className="text-[11px] text-slate-500 leading-snug">
            To check the customer’s form answers, put Send WhatsApp Flow → Wait for Flow Submission before this step.
          </p>
        )}
        {flowLoading && (
          <p className="flex items-center gap-1.5 text-[11px] text-slate-400"><Loader2 className="w-3 h-3 animate-spin" /> Loading the Flow’s questions…</p>
        )}
      </Field>

      {def && (
        <Field label="Condition" name="operator" required>
          <Select
            value={operator}
            onChange={(v) => {
              set('operator', v);
              if (NO_VALUE_OPERATORS.has(v)) {
                set('value', '');
                set('valueLabel', undefined);
              }
            }}
            options={def.operators.map((o) => ({ value: o, label: OPERATOR_LABELS[o] }))}
            placeholder="Choose a condition…"
            invalid={!!errors.operator}
          />
        </Field>
      )}

      {def && operator && !NO_VALUE_OPERATORS.has(operator) && (
        <Field label="Value" name="value" required hint={def.valueOptions ? undefined : def.hint}>
          {def.valueOptions ? (
            <Select
              value={local.value}
              onChange={(v) => {
                set('value', v);
                set('valueLabel', def.valueOptions!.find((o) => o.value === v)?.label);
              }}
              options={def.valueOptions}
              placeholder="Choose an answer…"
              invalid={!!errors.value}
            />
          ) : (
            <input
              value={String(local.value ?? '')}
              onChange={(e) => set('value', e.target.value)}
              className={`${inputCls} ${errors.value ? invalidCls : ''}`}
              placeholder={def.placeholder ?? 'Enter a value…'}
            />
          )}
        </Field>
      )}
    </>
  );
}

/** Wait for Flow Submission: nothing to set, so explain what it waits for and what it unlocks. */
function WaitFields({ waitsFor }: { waitsFor: number[] }) {
  const { flows } = usePublishedFlows();
  const waited = waitsFor.map((id) => flows?.find((f) => f.id === id)).filter((f): f is NonNullable<typeof f> => !!f);

  if (!waitsFor.length) {
    return <Note>Place this step after a Send WhatsApp Flow step. It then waits for the customer to submit that Flow.</Note>;
  }
  return (
    <>
      <Note>
        Pauses the automation until the customer submits the Flow, for as long as the response window set on the Send WhatsApp Flow
        step. If they don’t submit in time, the automation stops (shown as Timed out in its runs). Other messages from the customer
        don’t affect the wait.
      </Note>
      {waited.map((f) => (
        <div key={f.id} className="space-y-1.5">
          <p className="text-[11.5px] font-medium text-slate-700">Answers from “{f.name}” you can use next</p>
          {(f.publishedVersion?.fields ?? []).length === 0 ? (
            <p className="text-[11px] text-slate-500">This Flow has no questions.</p>
          ) : (
            <ul className="rounded-lg border border-slate-200 divide-y divide-slate-100">
              {f.publishedVersion!.fields.map((q) => (
                <li key={q.name} className="px-3 py-1.5 flex items-center justify-between gap-3">
                  <span className="text-[12px] text-slate-700 truncate">{q.label}</span>
                  <code className="text-[10.5px] text-slate-500 bg-slate-50 px-1 rounded shrink-0">{`{{flow.${q.name}}}`}</code>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
      <p className="text-[11px] text-slate-500 leading-snug">
        Use them in later messages with Insert variable, or check them in If / Else under “Flow answers”.
      </p>
    </>
  );
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
