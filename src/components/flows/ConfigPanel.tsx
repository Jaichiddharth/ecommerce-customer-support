'use client';

import React, { useState } from 'react';
import { X, Save, Trash2 } from 'lucide-react';
import type { AutomationNodeData } from './flow-types';
import { SendWhatsAppFlowFields, WaitForFlowSubmissionFields } from './whatsapp/AutomationFlowFields';

interface ConfigPanelProps {
  nodeId: string;
  data: AutomationNodeData;
  onUpdate: (id: string, data: Partial<AutomationNodeData>) => void;
  onClose: () => void;
  onDelete: (id: string) => void;
}

export function ConfigPanel({ nodeId, data, onUpdate, onClose, onDelete }: ConfigPanelProps) {
  const [local, setLocal] = useState<Record<string, unknown>>({ ...data } as Record<string, unknown>);

  const set = (key: string, value: unknown) =>
    setLocal((prev) => ({ ...prev, [key]: value }));

  const [error, setError] = useState<string | null>(null);

  const save = () => {
    const problem = validateNode(data.type, local);
    if (problem) {
      setError(problem);
      return;
    }
    onUpdate(nodeId, { ...local, configured: true } as Partial<AutomationNodeData>);
    onClose();
  };

  return (
    <div className="w-80 shrink-0 bg-white border-l border-slate-200 flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3.5 border-b border-slate-100 flex items-center justify-between shrink-0">
        <div>
          <h3 className="text-[13px] font-bold text-slate-800">Configure Node</h3>
          <p className="text-[11px] text-slate-400 mt-0.5">{data.label}</p>
        </div>
        <button
          onClick={onClose}
          className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Form body */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {/* Common: label */}
        <Field label="Node Label">
          <input
            value={String(local.label ?? '')}
            onChange={(e) => set('label', e.target.value)}
            className={inputCls}
            placeholder="Enter a label…"
          />
        </Field>

        {/* Type-specific fields */}
        <TypeFields type={data.type} local={local} set={(k, v) => { setError(null); set(k, v); }} />
      </div>

      {error && (
        <p role="alert" className="mx-4 mb-0 mt-0 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-[11px] text-red-600 shrink-0">
          {error}
        </p>
      )}

      {/* Footer actions */}
      <div className="px-4 py-3 border-t border-slate-100 shrink-0 flex items-center gap-2">
        <button
          onClick={save}
          className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-[#3440a8] hover:bg-[#2a3490] text-white text-[12px] font-semibold transition-colors"
        >
          <Save className="w-3.5 h-3.5" />
          Save Changes
        </button>
        <button
          onClick={() => { onDelete(nodeId); onClose(); }}
          className="w-9 h-9 rounded-xl flex items-center justify-center border border-slate-200 text-red-400 hover:bg-red-50 hover:border-red-200 transition-colors"
          title="Delete node"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

// ─── Validation before saving (activation re-checks on the server) ───────────

function validateNode(type: string, d: Record<string, unknown>): string | null {
  if (type === 'action_send_whatsapp_flow') {
    if (!d.flowId) return 'Choose a published WhatsApp Flow.';
    if (d.sendMethod === 'interactive') {
      if (!String(d.flowBody ?? '').trim()) return 'Enter the message text.';
      if (!String(d.flowCta ?? '').trim()) return 'Enter the button text.';
    } else if (!d.templateId) {
      return 'Choose an approved template that opens this Flow.';
    }
  }
  return null;
}

// ─── Type-specific field groups ───────────────────────────────────────────────

function TypeFields({
  type,
  local,
  set,
}: {
  type: string;
  local: Record<string, unknown>;
  set: (k: string, v: unknown) => void;
}) {
  switch (type) {
    case 'trigger_keyword':
      return (
        <Field label="Keywords (comma-separated)">
          <input
            value={String((local.keywords as string[] | undefined)?.join(', ') ?? '')}
            onChange={(e) => set('keywords', e.target.value.split(',').map((k) => k.trim()))}
            className={inputCls}
            placeholder="e.g. hello, help, start"
          />
        </Field>
      );

    case 'trigger_conversation_event':
      return (
        <Field label="Event Type">
          <select
            value={String(local.event ?? '')}
            onChange={(e) => set('event', e.target.value)}
            className={inputCls}
          >
            <option value="">Select event…</option>
            <option value="conversation_opened">Conversation opened</option>
            <option value="conversation_closed">Conversation closed</option>
            <option value="conversation_assigned">Conversation assigned</option>
            <option value="contact_created">Contact created</option>
          </select>
        </Field>
      );

    case 'condition_if_else':
    case 'condition_contact_attribute':
      return (
        <>
          <Field label="Attribute">
            <select
              value={String(local.attribute ?? '')}
              onChange={(e) => set('attribute', e.target.value)}
              className={inputCls}
            >
              <option value="">Select attribute…</option>
              <option value="phone">Phone number</option>
              <option value="name">Contact name</option>
              <option value="email">Email</option>
              <option value="tag">Tag</option>
              <option value="language">Language</option>
            </select>
          </Field>
          <Field label="Operator">
            <select
              value={String(local.operator ?? '')}
              onChange={(e) => set('operator', e.target.value)}
              className={inputCls}
            >
              <option value="">Select operator…</option>
              <option value="equals">Equals</option>
              <option value="not_equals">Not equals</option>
              <option value="contains">Contains</option>
              <option value="starts_with">Starts with</option>
              <option value="is_empty">Is empty</option>
            </select>
          </Field>
          <Field label="Value">
            <input
              value={String(local.value ?? '')}
              onChange={(e) => set('value', e.target.value)}
              className={inputCls}
              placeholder="Enter value…"
            />
          </Field>
        </>
      );

    case 'condition_keyword_match':
      return (
        <Field label="Keywords to match (comma-separated)">
          <input
            value={String((local.keywords as string[] | undefined)?.join(', ') ?? '')}
            onChange={(e) => set('keywords', e.target.value.split(',').map((k) => k.trim()))}
            className={inputCls}
            placeholder="e.g. price, order, help"
          />
        </Field>
      );

    case 'action_send_message':
      return (
        <Field label="Message Content">
          <textarea
            value={String(local.messageContent ?? '')}
            onChange={(e) => set('messageContent', e.target.value)}
            className={`${inputCls} resize-none`}
            rows={4}
            placeholder="Type your message here…"
          />
        </Field>
      );

    case 'action_send_template':
      return (
        <Field label="Template ID">
          <input
            value={String(local.templateId ?? '')}
            onChange={(e) => set('templateId', e.target.value)}
            className={inputCls}
            placeholder="e.g. welcome_message_v1"
          />
        </Field>
      );

    case 'action_assign_conversation':
      return (
        <Field label="Assign To">
          <select
            value={String(local.assignTo ?? '')}
            onChange={(e) => set('assignTo', e.target.value)}
            className={inputCls}
          >
            <option value="">Select agent / team…</option>
            <option value="bot">AI Bot</option>
            <option value="support">Support Team</option>
            <option value="sales">Sales Team</option>
            <option value="agent_1">Agent 1</option>
          </select>
        </Field>
      );

    case 'action_update_contact':
      return (
        <>
          <Field label="Field">
            <select
              value={String(local.updateField ?? '')}
              onChange={(e) => set('updateField', e.target.value)}
              className={inputCls}
            >
              <option value="">Select field…</option>
              <option value="name">Name</option>
              <option value="email">Email</option>
              <option value="tag">Tag</option>
              <option value="language">Language</option>
              <option value="notes">Notes</option>
            </select>
          </Field>
          <Field label="Value">
            <input
              value={String(local.updateValue ?? '')}
              onChange={(e) => set('updateValue', e.target.value)}
              className={inputCls}
              placeholder="New value…"
            />
          </Field>
        </>
      );

    case 'flow_delay':
      return (
        <div className="flex gap-2">
          <Field label="Duration">
            <input
              type="number"
              min={1}
              value={Number(local.delayAmount ?? 5)}
              onChange={(e) => set('delayAmount', Number(e.target.value))}
              className={inputCls}
            />
          </Field>
          <Field label="Unit">
            <select
              value={String(local.delayUnit ?? 'minutes')}
              onChange={(e) => set('delayUnit', e.target.value)}
              className={inputCls}
            >
              <option value="seconds">Seconds</option>
              <option value="minutes">Minutes</option>
              <option value="hours">Hours</option>
              <option value="days">Days</option>
            </select>
          </Field>
        </div>
      );

    case 'action_send_whatsapp_flow':
      return <SendWhatsAppFlowFields local={local} set={set} inputCls={inputCls} Field={Field} />;

    case 'flow_wait_flow_submission':
      return <WaitForFlowSubmissionFields local={local} set={set} inputCls={inputCls} Field={Field} />;

    default:
      return (
        <p className="text-[12px] text-slate-400 italic">
          No additional configuration required for this node type.
        </p>
      );
  }
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 flex-1">
      <label className="text-[11px] font-semibold text-slate-600 uppercase tracking-wide">
        {label}
      </label>
      {children}
    </div>
  );
}

const inputCls =
  'w-full px-3 py-2 text-[12px] rounded-lg border border-slate-200 bg-slate-50 text-slate-800 ' +
  'focus:outline-none focus:ring-2 focus:ring-[#3440a8]/20 focus:border-[#3440a8]/40 transition-all ' +
  'placeholder:text-slate-400';
