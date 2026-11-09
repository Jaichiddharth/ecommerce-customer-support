import type { AutomationNodeData } from './flow-types';

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

export const ATTRIBUTE_OPTIONS: Option[] = [
  { value: 'message', label: 'Message text' },
  { value: 'phone', label: 'Phone number' },
  { value: 'name', label: 'Contact name' },
  { value: 'email', label: 'Email' },
  { value: 'tag', label: 'Tag' },
  { value: 'language', label: 'Language' },
];

export const OPERATOR_OPTIONS: Option[] = [
  { value: 'equals', label: 'Equals' },
  { value: 'not_equals', label: 'Not equals' },
  { value: 'contains', label: 'Contains' },
  { value: 'starts_with', label: 'Starts with' },
  { value: 'is_empty', label: 'Is empty' },
];

export const ASSIGNEE_OPTIONS: Option[] = [
  { value: 'bot', label: 'AI Bot' },
  { value: 'support', label: 'Support Team' },
  { value: 'sales', label: 'Sales Team' },
  { value: 'agent_1', label: 'Agent 1' },
];

export const CONTACT_FIELD_OPTIONS: Option[] = [
  { value: 'name', label: 'Name' },
  { value: 'email', label: 'Email' },
  { value: 'tag', label: 'Tag' },
  { value: 'language', label: 'Language' },
  { value: 'notes', label: 'Notes' },
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
      const attr = labelFor(ATTRIBUTE_OPTIONS, d.attribute);
      const op = labelFor(OPERATOR_OPTIONS, d.operator).toLowerCase();
      if (d.operator === 'is_empty') return `${attr} is empty`;
      return d.value ? `${attr} ${op} “${d.value}”` : '';
    }
    case 'condition_keyword_match': {
      const k = keywordList(d.keywords);
      return k.length ? `Message contains ${quoteList(k)}` : '';
    }
    case 'action_send_message':
      return d.messageContent ? `“${String(d.messageContent).trim()}”` : '';
    case 'action_send_template':
      return d.templateId ? `Template: ${d.templateId}` : '';
    case 'action_assign_conversation':
      return d.assignTo ? `Assign to ${labelFor(ASSIGNEE_OPTIONS, d.assignTo)}` : '';
    case 'action_update_contact':
      return d.updateField
        ? `Set ${labelFor(CONTACT_FIELD_OPTIONS, d.updateField).toLowerCase()} to “${d.updateValue || '…'}”`
        : '';
    case 'action_send_whatsapp_flow':
      return d.flowName
        ? `${d.flowName}${d.sendMethod === 'interactive' ? ' · interactive' : d.templateName ? ` · ${d.templateName}` : ''}`
        : '';
    case 'flow_end':
      return 'The automation stops here';
    default:
      return '';
  }
}
