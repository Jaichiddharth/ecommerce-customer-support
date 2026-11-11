import type { AutomationNodeData } from './flow-types';
import { BASE_ATTRIBUTES, CONTACT_UPDATE_FIELDS, NO_VALUE_OPERATORS, OPERATOR_LABELS, type OperatorId } from '@/lib/automation/variables';

export interface Option {
  value: string;
  label: string;
}

/** Choices offered by the config panel. Values are what the runtime stores and reads. */
export const EVENT_OPTIONS: Option[] = [
  { value: 'conversation_opened', label: 'Conversation opened' },
  { value: 'conversation_closed', label: 'Conversation closed' },
  { value: 'conversation_assigned', label: 'Conversation assigned' },
  { value: 'contact_created', label: 'Contact created' },
];

export const ASSIGNEE_OPTIONS: Option[] = [
  { value: 'bot', label: 'AI Bot' },
  { value: 'support', label: 'Support Team' },
  { value: 'sales', label: 'Sales Team' },
  { value: 'agent_1', label: 'Agent 1' },
];

const labelFor = (options: Option[], value: unknown) =>
  options.find((o) => o.value === value)?.label ?? String(value ?? '');

const keywordList = (v: unknown) =>
  Array.isArray(v) ? v.map(String).map((k) => k.trim()).filter(Boolean) : [];

const quoteList = (items: string[], max = 3) => {
  const shown = items.slice(0, max).map((k) => `“${k}”`).join(', ');
  return items.length > max ? `${shown} +${items.length - max}` : shown;
};

/** One-line, plain-language description of how a step is configured ('' when not set up). */
export function nodeSummary(data: AutomationNodeData): string {
  const d = data as Record<string, unknown>;
  switch (data.type) {
    case 'trigger_incoming_message':
      return 'Any message from a customer';
    case 'trigger_keyword': {
      const k = keywordList(d.keywords);
      return k.length ? `Message contains ${quoteList(k)}` : '';
    }
    case 'trigger_conversation_event':
      return d.event ? `When ${labelFor(EVENT_OPTIONS, d.event).toLowerCase()}` : '';
    case 'condition_if_else':
    case 'condition_contact_attribute': {
      if (!d.attribute || !d.operator) return '';
      const attribute = String(d.attribute);
      // Flow conditions store a readable label alongside (the questions aren't loaded on the canvas)
      const attr = attribute.startsWith('flow.')
        ? String(d.attributeLabel || attribute.slice(5))
        : BASE_ATTRIBUTES.find((a) => a.value === attribute)?.label ?? attribute;
      const op = (OPERATOR_LABELS[d.operator as OperatorId] ?? String(d.operator)).toLowerCase();
      if (NO_VALUE_OPERATORS.has(String(d.operator))) return `${attr} ${op}`;
      const value = d.valueLabel || d.value;
      return value ? `${attr} ${op} “${value}”` : '';
    }
    case 'condition_keyword_match': {
      const k = keywordList(d.keywords);
      return k.length ? `Message contains ${quoteList(k)}` : '';
    }
    case 'action_send_message':
      return d.messageContent ? `“${String(d.messageContent).trim()}”` : '';
    case 'action_send_template':
      return d.templateName ? `Template: ${d.templateName}` : d.templateId ? `Template: ${d.templateId}` : '';
    case 'action_assign_conversation':
      return d.assignTo ? `Assign to ${labelFor(ASSIGNEE_OPTIONS, d.assignTo)}` : '';
    case 'action_update_contact': {
      if (!d.updateField) return '';
      const value = d.updateValue || '…';
      if (d.updateField === 'tag') return `Add tag “${value}”`;
      if (d.updateField === 'remove_tag') return `Remove tag “${value}”`;
      return `Set ${labelFor(CONTACT_UPDATE_FIELDS, d.updateField).toLowerCase()} to “${value}”`;
    }
    case 'action_send_whatsapp_flow':
      return d.flowName
        ? `${d.flowName}${d.sendMethod === 'interactive' ? ' · interactive' : d.templateName ? ` · ${d.templateName}` : ''}`
        : '';
    case 'flow_wait_flow_submission':
      return 'Continues when the customer submits the Flow';
    case 'flow_end':
      return 'The automation stops here';
    default:
      return '';
  }
}
