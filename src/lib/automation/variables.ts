import { isInputComponent, type WaFlow } from '@/lib/whatsapp-flows/wa-flow-types';

/**
 * What automation steps can reference, shared by the builder (pickers), the validator and the
 * engine so the three never disagree. Pure and client-safe.
 *
 *  - Variables: `{{contact.name}}`, `{{message.text}}`, `{{flow.<field>}}` in message texts.
 *  - Condition attributes: what If / Else can check, and the operators that make sense for each.
 */

// ─── Variables ──────────────────────────────────────────────────────────────

export const VARIABLE_RE = /\{\{\s*([\w.]+)\s*\}\}/g;

export interface VariableDef {
  /** Path inside the braces, e.g. `contact.name` */
  path: string;
  label: string;
  example?: string;
}

/** Contact fields worth putting in a message. Keys are Customer properties. */
export const CONTACT_VARIABLES: VariableDef[] = [
  { path: 'contact.name', label: 'Name', example: 'Priya' },
  { path: 'contact.phone', label: 'Phone number', example: '919876543210' },
  { path: 'contact.email', label: 'Email', example: 'priya@mail.com' },
  { path: 'contact.language', label: 'Language', example: 'en' },
  { path: 'contact.tags', label: 'Tags', example: 'vip, lead' },
];

export const MESSAGE_VARIABLES: VariableDef[] = [
  { path: 'message.text', label: 'Customer’s message', example: 'What is the price?' },
];

const KNOWN_PATHS = new Set([...CONTACT_VARIABLES, ...MESSAGE_VARIABLES].map((v) => v.path));

/** Every variable path used in `text`, in order (duplicates kept once). */
export function variableRefs(text: unknown): string[] {
  if (typeof text !== 'string' || !text.includes('{{')) return [];
  return [...new Set(Array.from(text.matchAll(VARIABLE_RE), (m) => m[1]))];
}

/**
 * Flow answers a step can use. Omitted: only the syntax and the contact / message variables are checked
 * (flow variables pass). `fields` null: answers are available but their names aren't known here.
 */
export interface FlowScope {
  available: boolean;
  fields: FlowField[] | null;
}

/** Why `{{path}}` won't work in this step, or null when it will. */
export function variableProblem(path: string, scope?: FlowScope): string | null {
  if (KNOWN_PATHS.has(path)) return null;
  const [root, ...rest] = path.split('.');
  const key = rest.join('.');
  if (root === 'flow' && key) {
    if (!scope) return null;
    if (!scope.available) return `{{${path}}} needs a Wait for Flow Submission step earlier on this path.`;
    if (scope.fields && !scope.fields.some((f) => f.name === key)) return `{{${path}}} isn't a question in the Flow.`;
    return null;
  }
  if (root === 'contact') return `{{${path}}} isn't a contact variable. Use Insert variable to pick one.`;
  return `{{${path}}} isn't a variable. Use Insert variable to pick one.`;
}

/** Problems with every variable in `text` (empty when all of them work). */
export function variableProblems(text: unknown, scope?: FlowScope): string[] {
  return variableRefs(text)
    .map((p) => variableProblem(p, scope))
    .filter((m): m is string => !!m);
}

// ─── Flow answers ───────────────────────────────────────────────────────────

/** One question of a WhatsApp Flow, as its answer arrives in the submission. */
export interface FlowField {
  /** Key in the response, used as `{{flow.<name>}}` / attribute `flow.<name>` */
  name: string;
  /** The question as the customer sees it */
  label: string;
  type: string;
  /** Choices for dropdown / radio / checkbox: the response holds the `id` */
  options?: { id: string; title: string }[];
}

/** Questions of a Flow definition, in screen order. */
export function flowFieldsOf(definition: WaFlow | null | undefined): FlowField[] {
  const out: FlowField[] = [];
  const seen = new Set<string>();
  for (const screen of definition?.screens ?? []) {
    for (const c of screen.components ?? []) {
      if (!isInputComponent(c) || !c.name || seen.has(c.name)) continue;
      seen.add(c.name);
      out.push({
        name: c.name,
        label: c.label?.trim() || c.name,
        type: c.type,
        ...('options' in c ? { options: c.options.map((o) => ({ id: o.id, title: o.title })) } : {}),
      });
    }
  }
  return out;
}

// ─── Condition attributes and operators ─────────────────────────────────────

export type OperatorId = 'equals' | 'not_equals' | 'contains' | 'starts_with' | 'is_empty' | 'is_not_empty' | 'has' | 'not_has';

export const OPERATOR_LABELS: Record<OperatorId, string> = {
  equals: 'Equals',
  not_equals: 'Does not equal',
  contains: 'Contains',
  starts_with: 'Starts with',
  is_empty: 'Is empty',
  is_not_empty: 'Is not empty',
  has: 'Has',
  not_has: 'Doesn’t have',
};

/** Operators that take no value. */
export const NO_VALUE_OPERATORS = new Set<string>(['is_empty', 'is_not_empty']);

export interface AttributeDef {
  value: string;
  label: string;
  operators: OperatorId[];
  /** Shown under the value input */
  hint?: string;
  placeholder?: string;
  /** Fixed choices for the value (stored value → label) */
  valueOptions?: { value: string; label: string }[];
}

/** Message and contact checks: only the combinations that mean something for a group of customers. */
export const BASE_ATTRIBUTES: AttributeDef[] = [
  {
    value: 'message',
    label: 'Customer’s message',
    operators: ['contains', 'equals', 'starts_with', 'is_empty'],
    hint: 'The message that started this automation. Empty for photos, voice notes and other media.',
    placeholder: 'e.g. refund',
  },
  {
    value: 'tag',
    label: 'Tag',
    operators: ['has', 'not_has'],
    hint: 'The exact tag name (not case-sensitive).',
    placeholder: 'e.g. vip',
  },
  {
    value: 'email',
    label: 'Email',
    operators: ['is_empty', 'is_not_empty', 'contains'],
    hint: 'Use Contains to match a domain, e.g. @company.com.',
    placeholder: 'e.g. @company.com',
  },
  {
    value: 'phone',
    label: 'Phone number',
    operators: ['starts_with'],
    hint: 'Country code without +, e.g. 91 for India or 971 for the UAE.',
    placeholder: 'e.g. 91',
  },
  {
    value: 'language',
    label: 'Language',
    operators: ['equals', 'not_equals', 'is_empty'],
    hint: 'Language code, e.g. en, ta, hi.',
    placeholder: 'e.g. ta',
  },
];

const OPT_IN_VALUES = [
  { value: 'true', label: 'Accepted' },
  { value: 'false', label: 'Not accepted' },
];

/** Condition attribute for one Flow question. */
export function flowAttribute(f: FlowField): AttributeDef {
  const base = { value: `flow.${f.name}`, label: f.label };
  if (f.type === 'dropdown' || f.type === 'radio') {
    return { ...base, operators: ['equals', 'not_equals'], valueOptions: (f.options ?? []).map((o) => ({ value: o.id, label: o.title })) };
  }
  if (f.type === 'checkbox') {
    return { ...base, operators: ['has', 'not_has'], valueOptions: (f.options ?? []).map((o) => ({ value: o.id, label: o.title })) };
  }
  if (f.type === 'opt_in') return { ...base, operators: ['equals'], valueOptions: OPT_IN_VALUES };
  if (f.type === 'date') return { ...base, operators: ['equals', 'is_empty', 'is_not_empty'], hint: 'Date as YYYY-MM-DD.', placeholder: '2026-12-31' };
  return { ...base, operators: ['contains', 'equals', 'starts_with', 'is_empty', 'is_not_empty'] };
}

/** Definition of `attribute`, or null when the condition can't check it. Flow attributes need `flowFields`. */
export function attributeDef(attribute: string, flowFields?: FlowField[] | null): AttributeDef | null {
  const base = BASE_ATTRIBUTES.find((a) => a.value === attribute);
  if (base) return base;
  if (attribute.startsWith('flow.')) {
    const f = flowFields?.find((x) => `flow.${x.name}` === attribute);
    return f ? flowAttribute(f) : null;
  }
  return null;
}

// ─── Update Contact ─────────────────────────────────────────────────────────

export const CONTACT_UPDATE_FIELDS: { value: string; label: string; placeholder: string; hint?: string }[] = [
  { value: 'tag', label: 'Add tag', placeholder: 'e.g. pricing-lead', hint: 'Keeps the contact’s other tags.' },
  { value: 'remove_tag', label: 'Remove tag', placeholder: 'e.g. form-pending' },
  { value: 'name', label: 'Name', placeholder: 'e.g. {{flow.full_name}}', hint: 'Replaces the current name.' },
  { value: 'email', label: 'Email', placeholder: 'e.g. {{flow.email}}', hint: 'Replaces the current email. Skipped when the value isn’t an email address.' },
  { value: 'language', label: 'Language', placeholder: 'e.g. ta', hint: 'Language code, e.g. en, ta, hi. Replaces the current one.' },
];

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
