import type { CategoryTheme, NodeCategory, PaletteItem } from './flow-types';

/** Every step type the builder can place (and the runtime understands). */
export const PALETTE_ITEMS: PaletteItem[] = [
  // ── Triggers ──────────────────────────────────────────────────────────────
  {
    type: 'trigger_incoming_message',
    label: 'Incoming Message',
    category: 'triggers',
    description: 'Starts when a customer sends any message.',
    icon: 'MessageCircle',
    keywords: ['start', 'inbound', 'receive'],
  },
  {
    type: 'trigger_keyword',
    label: 'Keyword Trigger',
    category: 'triggers',
    description: 'Starts when a message contains one of your keywords.',
    icon: 'Hash',
    keywords: ['start', 'word', 'phrase'],
  },
  {
    type: 'trigger_conversation_event',
    label: 'Conversation Event',
    category: 'triggers',
    description: 'Starts on a conversation event, like opened or assigned.',
    icon: 'Bell',
    keywords: ['start', 'opened', 'closed', 'assigned'],
  },

  // ── Conditions ────────────────────────────────────────────────────────────
  {
    type: 'condition_if_else',
    label: 'If / Else',
    category: 'conditions',
    description: 'Splits into a True and a False path based on a rule.',
    icon: 'GitBranch',
    keywords: ['branch', 'decision', 'split'],
  },
  {
    type: 'condition_keyword_match',
    label: 'Keyword Match',
    category: 'conditions',
    description: 'Continues only when the message contains a keyword.',
    icon: 'Search',
    keywords: ['filter', 'word'],
  },
  {
    type: 'condition_contact_attribute',
    label: 'Filter',
    category: 'conditions',
    description: 'Removed. Replace it with If / Else.',
    icon: 'Filter',
    hidden: true,
  },

  // ── Actions ───────────────────────────────────────────────────────────────
  {
    type: 'action_send_message',
    label: 'Send Message',
    category: 'actions',
    description: 'Replies with a plain text message.',
    icon: 'Send',
    keywords: ['reply', 'text'],
  },
  {
    type: 'action_send_template',
    label: 'Send Template',
    category: 'actions',
    description: 'Sends an approved WhatsApp template, with its variables filled in.',
    icon: 'FileText',
    keywords: ['whatsapp', 'hsm'],
  },
  {
    type: 'action_send_whatsapp_flow',
    label: 'Send WhatsApp Flow',
    category: 'actions',
    description: 'Sends a published WhatsApp Flow form to the contact.',
    icon: 'MessageSquareText',
    keywords: ['form', 'whatsapp'],
  },
  {
    type: 'action_assign_conversation',
    label: 'Assign Conversation',
    category: 'actions',
    description: 'Hands the conversation to an agent, team or bot.',
    icon: 'UserPlus',
    keywords: ['route', 'agent', 'team'],
  },
  {
    type: 'action_update_contact',
    label: 'Update Contact',
    category: 'actions',
    description: 'Adds or removes a tag, or saves a name, email or language.',
    icon: 'PenLine',
    keywords: ['field', 'tag', 'crm'],
  },

  // ── Flow Controls ─────────────────────────────────────────────────────────
  {
    type: 'flow_wait_flow_submission',
    label: 'Wait for Flow Submission',
    category: 'flow-controls',
    description: 'Pauses until the customer submits the Flow, so later steps can use the answers.',
    icon: 'Hourglass',
    keywords: ['form', 'response', 'answers', 'pause'],
  },
  {
    type: 'flow_end',
    label: 'End Workflow',
    category: 'flow-controls',
    description: 'Stops the automation on this path.',
    icon: 'StopCircle',
    keywords: ['stop', 'finish', 'terminate'],
  },
];

/** Step types that can be added (palette and node picker). */
export const PICKABLE_ITEMS = PALETTE_ITEMS.filter((i) => !i.hidden);

export const CATEGORY_ORDER: NodeCategory[] = ['triggers', 'conditions', 'actions', 'flow-controls'];

export const CATEGORY_META: Record<NodeCategory, CategoryTheme> = {
  triggers: { label: 'Triggers', singular: 'Trigger', accent: '#3440a8', soft: '#eef0fb', text: '#2a3490' },
  conditions: { label: 'Conditions', singular: 'Condition', accent: '#d97706', soft: '#fef3e2', text: '#a14f04' },
  actions: { label: 'Actions', singular: 'Action', accent: '#0d9488', soft: '#e6f6f4', text: '#0f6b63' },
  'flow-controls': { label: 'Flow Controls', singular: 'Flow Control', accent: '#e11d48', soft: '#fdecef', text: '#be123c' },
};

const FALLBACK_THEME: CategoryTheme = { label: 'Steps', singular: 'Step', accent: '#64748b', soft: '#f1f5f9', text: '#334155' };

export const getPaletteItem = (type: string) => PALETTE_ITEMS.find((i) => i.type === type);

export function categoryOf(type: string): NodeCategory | null {
  const item = getPaletteItem(type);
  if (item) return item.category;
  if (type.startsWith('trigger_')) return 'triggers';
  if (type.startsWith('condition_')) return 'conditions';
  if (type.startsWith('action_')) return 'actions';
  if (type.startsWith('flow_')) return 'flow-controls';
  return null;
}

export function themeOf(type: string): CategoryTheme {
  const cat = categoryOf(type);
  return cat ? CATEGORY_META[cat] : FALLBACK_THEME;
}

/** Case-insensitive match on name, description and keywords. */
export function matchesSearch(item: PaletteItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [item.label, item.description, CATEGORY_META[item.category].label, ...(item.keywords ?? [])]
    .some((s) => s.toLowerCase().includes(q));
}
