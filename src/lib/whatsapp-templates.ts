import {
  TEMPLATE_LIMITS,
  isMediaHeader,
  type MediaHeaderType,
  type TemplateComponent,
  type WhatsAppTemplate,
} from '@/types/templates';

/**
 * Meta's message-template rules, shared by the template editor (pre-submit checks)
 * and the templates API route (server-side validation). No server-only imports here.
 */

const VARIABLE_RE = /\{\{(\d+)\}\}/g;

/** Unique variable numbers in `text`, sorted: "Hi {{2}} {{1}} {{2}}" → [1, 2] */
export const extractVariables = (text?: string): number[] => {
  if (!text) return [];
  const found = Array.from(text.matchAll(VARIABLE_RE), (m) => parseInt(m[1], 10));
  return [...new Set(found)].sort((a, b) => a - b);
};

/** Meta numbers variables per component: each must run {{1}}..{{n}} with no gaps */
const isSequential = (vars: number[]) => vars.every((v, i) => v === i + 1);

const PHONE_RE = /^\+?[1-9]\d{6,14}$/;

/** Meta's wording, so agents see the same message as in WhatsApp Manager */
export const MALFORMED_VARIABLE_MESSAGE =
  'This template contains variable parameters with incorrect formatting. Variable parameters must be whole numbers with two sets of curly brackets (for example, {{1}}, {{2}}).';

/** True when `text` has broken placeholders: {{1}, {1}}, {{ 1 }}, {{name}}, {{}} … */
export const hasMalformedVariables = (text?: string): boolean =>
  Boolean(text) && /\{\{|\}\}/.test(text!.replace(VARIABLE_RE, ''));

/** Body length limit: 1024, plus 4 per {{n}} placeholder, as WhatsApp Manager counts it */
export const bodyCharLimit = (text?: string): number =>
  TEMPLATE_LIMITS.body + TEMPLATE_LIMITS.bodyPerVariable * (text?.match(VARIABLE_RE)?.length ?? 0);

// -------------------------------------------------------------
// PER-FIELD RULES: the editor shows these under each field, and
// validateTemplateComponents (editor checklist + API route) reuses them
// -------------------------------------------------------------

/** Problems with header text (excluding "empty" and the sample, which are checked on submit) */
export function getHeaderTextProblems(text: string): string[] {
  const problems: string[] = [];
  const vars = extractVariables(text);
  if (hasMalformedVariables(text)) problems.push(MALFORMED_VARIABLE_MESSAGE);
  if (text.length > TEMPLATE_LIMITS.headerText) problems.push(`Header text must be ${TEMPLATE_LIMITS.headerText} characters or fewer.`);
  if (/[\n\r]/.test(text)) problems.push("Header text can't contain line breaks.");
  if (vars.length > 1 || (vars.length === 1 && vars[0] !== 1)) {
    problems.push('The header can have only one variable, and it must be {{1}}.');
  }
  return problems;
}

/** Problems with body text (excluding "empty" and samples, which are checked on submit) */
export function getBodyTextProblems(text: string): string[] {
  const problems: string[] = [];
  const trimmed = text.trim();
  if (!trimmed) return problems;

  const vars = extractVariables(text);
  const limit = bodyCharLimit(text);
  if (hasMalformedVariables(text)) problems.push(MALFORMED_VARIABLE_MESSAGE);
  if (text.length > limit) problems.push(`Body must be ${limit} characters or fewer (1024, plus 4 for each variable).`);
  if (!isSequential(vars)) {
    problems.push(`Body variables must be numbered {{1}} to {{${vars.length}}} with no gaps (found ${vars.map((v) => `{{${v}}}`).join(', ')}).`);
  }
  if (/^\{\{\d+\}\}/.test(trimmed) || /\{\{\d+\}\}$/.test(trimmed)) {
    problems.push("The body can't start or end with a variable.");
  }
  if (/\n[ \t]*\n[ \t]*\n/.test(text)) {
    problems.push('The body can have at most one empty line in a row.');
  }
  return problems;
}

/** Problems with footer text */
export function getFooterTextProblems(text: string): string[] {
  const problems: string[] = [];
  if (text.length > TEMPLATE_LIMITS.footer) problems.push(`Footer must be ${TEMPLATE_LIMITS.footer} characters or fewer.`);
  if (extractVariables(text).length > 0 || hasMalformedVariables(text)) problems.push("The footer can't contain variables.");
  if (/[\n\r]/.test(text)) problems.push("The footer can't contain line breaks.");
  return problems;
}

/** Problems with one button, worded to read on their own (the checklist adds "Button n: ") */
export function getButtonProblems(btn: { type: string; text?: string; url?: string; phone_number?: string; example?: string | string[] }): string[] {
  const problems: string[] = [];
  const text = btn.text ?? '';
  if (!text.trim()) problems.push('Add a button label.');
  else if (text.length > TEMPLATE_LIMITS.buttonText) problems.push(`The label must be ${TEMPLATE_LIMITS.buttonText} characters or fewer.`);
  if (extractVariables(text).length > 0 || hasMalformedVariables(text)) problems.push("The label can't contain variables.");

  if (btn.type === 'URL') {
    const url = btn.url?.trim() ?? '';
    const vars = extractVariables(url);
    const example = Array.isArray(btn.example) ? btn.example[0] : btn.example;
    if (!/^https?:\/\/\S+\.\S+/.test(url)) problems.push('Enter a valid website URL (https://…).');
    else if (url.length > TEMPLATE_LIMITS.url) problems.push(`The URL must be ${TEMPLATE_LIMITS.url} characters or fewer.`);
    if (hasMalformedVariables(url)) problems.push(MALFORMED_VARIABLE_MESSAGE);
    if (vars.length > 1 || (vars.length === 1 && (vars[0] !== 1 || !url.endsWith('{{1}}')))) {
      problems.push('A dynamic URL can have one variable, {{1}}, at the very end.');
    } else if (vars.length === 1 && !example?.trim()) {
      problems.push('Add a sample value for the URL variable.');
    }
  }

  if (btn.type === 'PHONE_NUMBER' && !PHONE_RE.test((btn.phone_number ?? '').replace(/[\s()-]/g, ''))) {
    problems.push('Enter a phone number with country code, e.g. +919876543210.');
  }
  return problems;
}

/**
 * Validates components in Meta's create/edit payload shape (with `example` blocks).
 * Returns human-readable problems; an empty array means Meta should accept the structure.
 */
export function validateTemplateComponents(components: TemplateComponent[]): string[] {
  const errors: string[] = [];
  const header = components.find((c) => c.type === 'HEADER');
  const body = components.find((c) => c.type === 'BODY');
  const footer = components.find((c) => c.type === 'FOOTER');
  const buttons = components.find((c) => c.type === 'BUTTONS')?.buttons ?? [];

  if (header?.format === 'TEXT') {
    const text = header.text ?? '';
    if (!text.trim()) errors.push('Header text is empty. Add text or set the header to None.');
    const problems = getHeaderTextProblems(text);
    errors.push(...problems);
    if (problems.length === 0 && extractVariables(text).length === 1 && !header.example?.header_text?.[0]?.trim()) {
      errors.push('Add a sample value for the header variable.');
    }
  } else if (header && isMediaHeader(header.format)) {
    if (!header.example?.header_handle?.[0]) {
      errors.push(`Upload a sample ${header.format.toLowerCase()} for the header.`);
    }
  }

  const bodyText = body?.text ?? '';
  if (!bodyText.trim()) {
    errors.push('Body text is required.');
  } else {
    errors.push(...getBodyTextProblems(bodyText));
    const vars = extractVariables(bodyText);
    const samples = body?.example?.body_text?.[0] ?? [];
    if (vars.length > 0 && (samples.length < vars.length || samples.some((s) => !s?.trim()))) {
      errors.push('Add a sample value for every body variable.');
    }
  }

  if (footer) errors.push(...getFooterTextProblems(footer.text ?? ''));

  if (buttons.length > TEMPLATE_LIMITS.buttons) errors.push(`A template can have at most ${TEMPLATE_LIMITS.buttons} buttons.`);
  if (buttons.filter((b) => b.type === 'URL').length > TEMPLATE_LIMITS.urlButtons) {
    errors.push(`A template can have at most ${TEMPLATE_LIMITS.urlButtons} website buttons.`);
  }
  if (buttons.filter((b) => b.type === 'PHONE_NUMBER').length > TEMPLATE_LIMITS.phoneButtons) {
    errors.push(`A template can have at most ${TEMPLATE_LIMITS.phoneButtons} phone number button.`);
  }

  // Quick replies must be grouped together, not interleaved with call-to-action buttons
  const groupSwitches = buttons.filter((b, i) => i > 0 && (b.type === 'QUICK_REPLY') !== (buttons[i - 1].type === 'QUICK_REPLY')).length;
  if (groupSwitches > 1) errors.push('Keep quick reply buttons together, before or after the website/phone buttons.');

  buttons.forEach((btn, i) => {
    for (const problem of getButtonProblems(btn)) errors.push(`Button ${i + 1}: ${problem}`);
  });

  return errors;
}

// -------------------------------------------------------------
// SENDING AN APPROVED TEMPLATE
// -------------------------------------------------------------

/** Positional ({{1}}) or named ({{first_name}}) variables */
const ANY_VARIABLE_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/** Variable keys of `text`: positional ones sorted by number, named ones in order of appearance */
const variableKeys = (text?: string): string[] => {
  if (!text) return [];
  const keys = [...new Set(Array.from(text.matchAll(ANY_VARIABLE_RE), (m) => m[1]))];
  return keys.every((k) => /^\d+$/.test(k)) ? keys.sort((a, b) => Number(a) - Number(b)) : keys;
};

const isNamed = (key: string) => !/^\d+$/.test(key);

/** Button types an agent can send from the inbox; others (catalog, flow, OTP…) need extra setup */
const SENDABLE_BUTTON_TYPES = ['QUICK_REPLY', 'URL', 'PHONE_NUMBER', 'COPY_CODE'];

export type TemplateSendFieldKind = 'header_text' | 'header_media' | 'body' | 'button_url' | 'coupon_code';

/** One value the agent fills in before a template can be sent */
export interface TemplateSendField {
  /** Key into the values map: `header`, `header_media`, `body:<var>`, `button:<index>` */
  id: string;
  kind: TemplateSendFieldKind;
  label: string;
  /** Variable name for named-parameter templates */
  paramName?: string;
  /** Meta's sample value, shown as a hint */
  example?: string;
  /** Fixed start of a dynamic URL, shown before the input */
  prefix?: string;
  buttonIndex?: number;
  mediaFormat?: MediaHeaderType;
}

const component = (tpl: WhatsAppTemplate, type: TemplateComponent['type']) =>
  tpl.components?.find((c) => c.type === type);

/** Why `tpl` can't be sent from the inbox, or null when it can */
export function getTemplateSendBlocker(tpl: WhatsAppTemplate): string | null {
  if (tpl.status && tpl.status.toUpperCase() !== 'APPROVED') return 'Only approved templates can be sent.';
  if (tpl.category === 'AUTHENTICATION') return 'Authentication (OTP) templates are sent by your login system, not from the inbox.';
  const header = component(tpl, 'HEADER');
  if (header?.format === 'LOCATION') return 'Location headers are not supported yet.';
  // The approved sample is what gets sent as the header
  if (header && isMediaHeader(header.format) && !header.example?.header_handle?.[0]) {
    return `This template has no approved header ${header.format.toLowerCase()} to send.`;
  }
  const buttons = component(tpl, 'BUTTONS')?.buttons ?? [];
  if (buttons.some((b) => !SENDABLE_BUTTON_TYPES.includes(b.type))) return 'This template has a button type the inbox can’t send yet.';
  return null;
}

/** Every value `tpl` needs at send time, in the order they appear in the message */
export function getTemplateSendFields(tpl: WhatsAppTemplate): TemplateSendField[] {
  const fields: TemplateSendField[] = [];
  const header = component(tpl, 'HEADER');
  const body = component(tpl, 'BODY');
  const buttons = component(tpl, 'BUTTONS')?.buttons ?? [];

  if (header?.format === 'TEXT') {
    const [key] = variableKeys(header.text);
    if (key) {
      fields.push({
        id: 'header',
        kind: 'header_text',
        label: `Header ${isNamed(key) ? key : `{{${key}}}`}`,
        paramName: isNamed(key) ? key : undefined,
        example: isNamed(key)
          ? header.example?.header_text_named_params?.find((p) => p.param_name === key)?.example
          : header.example?.header_text?.[0],
      });
    }
  } else if (header && isMediaHeader(header.format)) {
    fields.push({
      id: 'header_media',
      kind: 'header_media',
      label: `Header ${header.format.toLowerCase()}`,
      mediaFormat: header.format,
      // Meta's approved sample; only for display, it can't be sent as a link
      example: header.example?.header_handle?.[0],
    });
  }

  const bodySamples = body?.example?.body_text?.[0] ?? [];
  variableKeys(body?.text).forEach((key, i) => {
    fields.push({
      id: `body:${key}`,
      kind: 'body',
      label: isNamed(key) ? key : `{{${key}}}`,
      paramName: isNamed(key) ? key : undefined,
      example: isNamed(key)
        ? body?.example?.body_text_named_params?.find((p) => p.param_name === key)?.example
        : bodySamples[i],
    });
  });

  buttons.forEach((btn, index) => {
    if (btn.type === 'URL' && btn.url && variableKeys(btn.url).length > 0) {
      const prefix = btn.url.replace(ANY_VARIABLE_RE, '');
      const sample = btn.example?.[0];
      fields.push({
        id: `button:${index}`,
        kind: 'button_url',
        label: `“${btn.text}” link`,
        prefix,
        buttonIndex: index,
        example: sample?.startsWith(prefix) ? sample.slice(prefix.length) : sample,
      });
    } else if (btn.type === 'COPY_CODE') {
      fields.push({
        id: `button:${index}`,
        kind: 'coupon_code',
        label: 'Coupon code',
        buttonIndex: index,
        example: btn.example?.[0],
      });
    }
  });

  return fields;
}

/**
 * Problems per field id; an empty object means the template is ready to send.
 * `header_media` holds a WhatsApp media id; left empty, the approved sample is re-uploaded at send time.
 */
export function getTemplateValueErrors(tpl: WhatsAppTemplate, values: Record<string, string>): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of getTemplateSendFields(tpl)) {
    const value = values[field.id]?.trim() ?? '';
    if (field.kind === 'header_media') {
      if (!value && !field.example) errors[field.id] = 'Required';
    } else if (!value) {
      errors[field.id] = 'Required';
    } else if (/[\n\t]/.test(value) || / {5,}/.test(value)) {
      // Meta rejects parameters containing new lines, tabs or more than 4 spaces in a row
      errors[field.id] = 'No line breaks, tabs or long runs of spaces';
    } else if (field.kind === 'button_url' && /\s/.test(value)) {
      errors[field.id] = 'No spaces in a link';
    }
  }
  return errors;
}

/** `components` for Meta's send-message call (`template.components`); `header_media` must already be a media id */
export function buildTemplateSendComponents(
  tpl: WhatsAppTemplate,
  values: Record<string, string>
): Array<Record<string, unknown>> {
  const fields = getTemplateSendFields(tpl);
  const value = (id: string) => values[id]?.trim() ?? '';
  const textParam = (f: TemplateSendField) => ({
    type: 'text',
    ...(f.paramName ? { parameter_name: f.paramName } : {}),
    text: value(f.id),
  });
  const components: Array<Record<string, unknown>> = [];

  const headerField = fields.find((f) => f.kind === 'header_text' || f.kind === 'header_media');
  if (headerField?.kind === 'header_text') {
    components.push({ type: 'header', parameters: [textParam(headerField)] });
  } else if (headerField?.kind === 'header_media' && headerField.mediaFormat) {
    const mediaType = headerField.mediaFormat.toLowerCase();
    components.push({ type: 'header', parameters: [{ type: mediaType, [mediaType]: { id: value(headerField.id) } }] });
  }

  const bodyFields = fields.filter((f) => f.kind === 'body');
  if (bodyFields.length > 0) {
    components.push({ type: 'body', parameters: bodyFields.map(textParam) });
  }

  for (const f of fields) {
    if (f.kind === 'button_url') {
      components.push({ type: 'button', sub_type: 'url', index: String(f.buttonIndex), parameters: [{ type: 'text', text: value(f.id) }] });
    } else if (f.kind === 'coupon_code') {
      components.push({
        type: 'button',
        sub_type: 'copy_code',
        index: String(f.buttonIndex),
        parameters: [{ type: 'coupon_code', coupon_code: value(f.id) }],
      });
    }
  }

  return components;
}

/** Replaces variables with their values; unfilled ones stay as `{{key}}` */
export function fillTemplateText(text: string | undefined, values: Record<string, string>, idPrefix: 'header' | 'body'): string {
  if (!text) return '';
  return text.replace(ANY_VARIABLE_RE, (match, key: string) => {
    const filled = values[idPrefix === 'header' ? 'header' : `body:${key}`]?.trim();
    return filled || match;
  });
}

/** Plain-text copy of the sent message (header, body, footer) for the conversation history */
export function renderTemplateMessage(tpl: WhatsAppTemplate, values: Record<string, string>): string {
  const header = component(tpl, 'HEADER');
  return [
    header?.format === 'TEXT' ? fillTemplateText(header.text, values, 'header') : '',
    fillTemplateText(component(tpl, 'BODY')?.text, values, 'body'),
    component(tpl, 'FOOTER')?.text ?? '',
  ]
    .filter((part) => part.trim())
    .join('\n\n');
}
