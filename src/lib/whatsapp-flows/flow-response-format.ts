// ─── Flow responses → readable answers ───────────────────────────────────────
// A Flow response is keyed by field name (`choice_2`) and holds option ids (`my_self`).
// With the Flow version's definition these become the question's label and the option's title.
// Pure and client-safe: used by the webhook (inbox message), the submissions API and the UI.

import { isInputComponent, type WaFlow, type WaInputComponent } from './wa-flow-types';

export interface FlowAnswer {
  /** Field name in the response payload */
  key: string;
  /** The question as the customer saw it, else the humanized field name */
  label: string;
  /** Display value: option titles, Yes/No, formatted dates */
  value: string;
}

/** `choice_2` → `Choice 2` */
export const humanizeFieldName = (key: string): string => {
  const s = key.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return s ? s[0].toUpperCase() + s.slice(1) : key;
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `2026-11-06` (or epoch ms, sent by older Flow JSON versions) → `6 Nov 2026`; same output on server and client */
const formatDateValue = (raw: string): string => {
  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (ymd) return `${Number(ymd[3])} ${MONTHS[Number(ymd[2]) - 1] ?? ymd[2]} ${ymd[1]}`;
  if (/^\d{12,13}$/.test(raw)) {
    const d = new Date(Number(raw));
    if (!Number.isNaN(d.getTime())) return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  }
  return raw;
};

const isEmpty = (v: unknown) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);

function formatAnswerValue(value: unknown, field?: WaInputComponent): string {
  if (isEmpty(value)) return '—';
  if (field && 'options' in field) {
    const title = (id: unknown) => field.options.find((o) => o.id === String(id))?.title?.trim() || String(id);
    return Array.isArray(value) ? value.map(title).join(', ') : title(value);
  }
  if (field?.type === 'opt_in' || typeof value === 'boolean') {
    if (value === true || value === 'true') return 'Yes';
    if (value === false || value === 'false') return 'No';
  }
  if (field?.type === 'date') return formatDateValue(String(value));
  if (Array.isArray(value)) return value.map(String).join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * Readable answers, in the order the questions appear in the Flow (unknown fields after, as received).
 * Without a definition (unmatched response) labels fall back to humanized field names and values stay raw.
 */
export function formatFlowResponse(response: Record<string, unknown>, definition?: WaFlow | null): FlowAnswer[] {
  const fields = new Map<string, WaInputComponent>();
  for (const screen of definition?.screens ?? []) {
    for (const c of screen.components ?? []) {
      if (isInputComponent(c) && c.name && !fields.has(c.name)) fields.set(c.name, c);
    }
  }
  const order = [...fields.keys()];
  const rank = (k: string) => {
    const i = order.indexOf(k);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };

  return Object.keys(response ?? {})
    .filter((k) => !k.startsWith('_')) // internal keys, e.g. `_raw` for an unparseable response
    .sort((a, b) => rank(a) - rank(b))
    .map((key) => {
      const field = fields.get(key);
      return { key, label: field?.label?.trim() || humanizeFieldName(key), value: formatAnswerValue(response[key], field) };
    });
}

/** One-line summary for conversation previews and notifications */
export function summarizeFlowAnswers(answers: FlowAnswer[], flowName?: string | null): string {
  const parts = answers.slice(0, 4).map((a) => `${a.label}: ${a.value}`);
  return `📋 ${flowName?.trim() || 'Form response'}${parts.length ? ` — ${parts.join(' · ')}` : ''}`;
}
