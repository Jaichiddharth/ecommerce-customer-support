import type { WaComponent, WaFlow, WaIssue, WaOption, WaScreen } from './wa-flow-types';
import { isInputComponent } from './wa-flow-types';
import {
  FIELD_NAME_PATTERN,
  FLOW_JSON_VERSIONS,
  LIMITS,
  SCREEN_ID_PATTERN,
  paletteItem,
} from './wa-component-registry';
import { analyzeNavigation, footerOf } from './wa-flow-json';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const PATTERN_INPUT_TYPES = new Set(['text', 'number', 'password', 'passcode']);

const isValidDate = (d: string) => DATE_PATTERN.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`));
const blank = (s: string | undefined) => !s || !s.trim();

/**
 * Validates the editor model against the Meta WhatsApp Flow JSON rules we generate for.
 * Errors block export; warnings are advisory.
 */
export function validateFlow(flow: WaFlow): WaIssue[] {
  const issues: WaIssue[] = [];

  if (blank(flow.name)) issues.push({ severity: 'error', message: 'Flow name is required.', field: 'flowName' });
  if (!(FLOW_JSON_VERSIONS as readonly string[]).includes(flow.version)) {
    issues.push({ severity: 'error', message: `Unsupported Flow JSON version "${flow.version}".` });
  }
  if (flow.screens.length === 0) {
    issues.push({ severity: 'error', message: 'Add at least one screen.' });
    return issues;
  }

  // ── Flow-wide field names (they become keys in the response payload) ──
  const nameOwners = new Map<string, number>();
  for (const s of flow.screens) for (const c of s.components) {
    if (isInputComponent(c)) nameOwners.set(c.name, (nameOwners.get(c.name) ?? 0) + 1);
  }

  // ── Screens ────────────────────────────────────────────────────────────
  const screenIds = new Map<string, number>();
  for (const s of flow.screens) screenIds.set(s.id, (screenIds.get(s.id) ?? 0) + 1);

  for (const s of flow.screens) {
    const at = (message: string, field?: string, severity: WaIssue['severity'] = 'error') =>
      issues.push({ severity, message: `${s.id || 'Screen'}: ${message}`, screenUid: s.uid, field });

    if (blank(s.id)) at('Screen ID is required.', 'id');
    else if (!SCREEN_ID_PATTERN.test(s.id)) at('Screen ID may only contain letters and underscores.', 'id');
    else if (s.id === 'SUCCESS') at('"SUCCESS" is a reserved screen ID.', 'id');
    else if ((screenIds.get(s.id) ?? 0) > 1) at('Screen ID must be unique.', 'id');
    if (blank(s.title)) at('Screen title is required.', 'title');

    const nonFooter = s.components.filter((c) => c.type !== 'footer');
    if (nonFooter.length === 0) at('Screen has no content.', undefined, 'warning');
    if (s.components.length > LIMITS.componentsPerScreen) {
      at(`A screen can have at most ${LIMITS.componentsPerScreen} components.`);
    }
    const footers = s.components.filter((c) => c.type === 'footer');
    if (footers.length === 0) at('Add a Footer button so customers can continue or submit.');
    if (footers.length > 1) at('Only one Footer is allowed per screen.');
    if (s.components.filter((c) => c.type === 'opt_in').length > LIMITS.optInsPerScreen) {
      at(`A screen can have at most ${LIMITS.optInsPerScreen} Opt-ins.`);
    }

    for (const c of s.components) validateComponent(c, s, flow, nameOwners, issues);
  }

  // ── Navigation ─────────────────────────────────────────────────────────
  const nav = analyzeNavigation(flow);
  const entry = flow.screens[0];
  for (const s of flow.screens) {
    const f = footerOf(s);
    if (f?.action === 'navigate' && f.nextScreenUid === entry.uid) {
      issues.push({
        severity: 'error',
        message: `${s.id}: cannot navigate back to the first screen (${entry.id}); routes must move forward.`,
        screenUid: s.uid, componentUid: f.uid, field: 'nextScreenUid',
      });
    }
    if (!nav.reachable.has(s.uid)) {
      issues.push({
        severity: 'error',
        message: `${s.id}: not reachable from the first screen. Point a Footer at it or remove it.`,
        screenUid: s.uid,
      });
    }
  }
  const loopScreens = flow.screens.filter((s) => nav.inCycle.has(s.uid) && s.uid !== entry.uid);
  if (loopScreens.length) {
    issues.push({
      severity: 'error',
      message: `Navigation loops between ${loopScreens.map((s) => s.id).join(' → ')}. Routes must move forward and end on a submit screen.`,
      screenUid: loopScreens[0].uid,
    });
  }
  const hasTerminal = flow.screens.some((s) => nav.reachable.has(s.uid) && footerOf(s)?.action === 'complete');
  if (!hasTerminal) {
    issues.push({ severity: 'error', message: 'The flow needs a final screen whose Footer submits (Complete flow).' });
  }

  return issues;
}

// ─── Per-component rules ─────────────────────────────────────────────────────

function validateComponent(
  c: WaComponent,
  s: WaScreen,
  flow: WaFlow,
  nameOwners: Map<string, number>,
  issues: WaIssue[],
) {
  const label = paletteItem(c.type).label;
  const at = (message: string, field?: string, severity: WaIssue['severity'] = 'error') =>
    issues.push({ severity, message: `${s.id} › ${label}: ${message}`, screenUid: s.uid, componentUid: c.uid, field });
  const maxLen = (value: string | undefined, max: number, field: string, what: string) => {
    if (value && value.length > max) at(`${what} must be ${max} characters or fewer (${value.length}).`, field);
  };

  if (isInputComponent(c)) {
    if (blank(c.name)) at('Field name is required.', 'name');
    else if (!FIELD_NAME_PATTERN.test(c.name)) at('Field name must start with a letter and use only letters, numbers and underscores.', 'name');
    else if ((nameOwners.get(c.name) ?? 0) > 1) at(`Field name "${c.name}" is used more than once in this flow.`, 'name');
    if (blank(c.label)) at('Label is required.', 'label');
  }

  switch (c.type) {
    case 'heading':
    case 'subheading':
    case 'body':
    case 'caption':
      if (blank(c.text)) at('Text cannot be empty.', 'text');
      maxLen(c.text, LIMITS[c.type], 'text', 'Text');
      break;

    case 'text_input':
      maxLen(c.label, LIMITS.textInputLabel, 'label', 'Label');
      maxLen(c.helperText, LIMITS.helperText, 'helperText', 'Helper text');
      if (c.minChars !== undefined && c.minChars < 0) at('Min characters cannot be negative.', 'minChars');
      if (c.maxChars !== undefined && c.maxChars < 1) at('Max characters must be at least 1.', 'maxChars');
      if (c.minChars !== undefined && c.maxChars !== undefined && c.minChars > c.maxChars) {
        at('Min characters cannot exceed max characters.', 'minChars');
      }
      if (c.pattern) {
        if (!PATTERN_INPUT_TYPES.has(c.inputType)) at('A pattern is only supported for text, number, password and passcode inputs.', 'pattern');
        if (blank(c.helperText)) at('Helper text is required when a pattern is set.', 'helperText');
        try { new RegExp(c.pattern); } catch { at('Pattern is not a valid regular expression.', 'pattern'); }
      }
      break;

    case 'text_area':
      maxLen(c.label, LIMITS.textAreaLabel, 'label', 'Label');
      maxLen(c.helperText, LIMITS.helperText, 'helperText', 'Helper text');
      if (c.maxLength !== undefined && (c.maxLength < 1 || c.maxLength > LIMITS.textAreaMaxLength)) {
        at(`Max length must be between 1 and ${LIMITS.textAreaMaxLength}.`, 'maxLength');
      }
      break;

    case 'dropdown':
      maxLen(c.label, LIMITS.dropdownLabel, 'label', 'Label');
      validateOptions(c.options, LIMITS.dropdownMaxOptions, at);
      break;

    case 'radio':
    case 'checkbox':
      maxLen(c.label, LIMITS.selectionLabel, 'label', 'Label');
      maxLen(c.description, LIMITS.selectionDescription, 'description', 'Description');
      validateOptions(c.options, LIMITS.selectionMaxOptions, at);
      if (c.type === 'checkbox') {
        const { minSelected: min, maxSelected: max } = c;
        if (min !== undefined && (min < 0 || min > c.options.length)) at('Min selections must be between 0 and the number of options.', 'minSelected');
        if (max !== undefined && (max < 1 || max > c.options.length)) at('Max selections must be between 1 and the number of options.', 'maxSelected');
        if (min !== undefined && max !== undefined && min > max) at('Min selections cannot exceed max selections.', 'minSelected');
      }
      break;

    case 'date':
      maxLen(c.label, LIMITS.dateLabel, 'label', 'Label');
      maxLen(c.helperText, LIMITS.helperText, 'helperText', 'Helper text');
      if (c.minDate && !isValidDate(c.minDate)) at('Min date must be YYYY-MM-DD.', 'minDate');
      if (c.maxDate && !isValidDate(c.maxDate)) at('Max date must be YYYY-MM-DD.', 'maxDate');
      if (c.minDate && c.maxDate && isValidDate(c.minDate) && isValidDate(c.maxDate) && c.minDate > c.maxDate) {
        at('Min date cannot be after max date.', 'minDate');
      }
      if (c.unavailableDates?.some((d) => !isValidDate(d))) at('Unavailable dates must be YYYY-MM-DD.', 'unavailableDates');
      break;

    case 'opt_in':
      maxLen(c.label, LIMITS.optInLabel, 'label', 'Label');
      break;

    case 'footer': {
      if (blank(c.label)) at('Button label is required.', 'label');
      maxLen(c.label, LIMITS.footerLabel, 'label', 'Button label');
      maxLen(c.leftCaption, LIMITS.footerCaption, 'leftCaption', 'Left caption');
      maxLen(c.centerCaption, LIMITS.footerCaption, 'centerCaption', 'Center caption');
      maxLen(c.rightCaption, LIMITS.footerCaption, 'rightCaption', 'Right caption');
      if (c.centerCaption && (c.leftCaption || c.rightCaption)) {
        at('Use either a center caption or left/right captions, not both.', 'centerCaption');
      }
      if (c.action === 'navigate') {
        const target = flow.screens.find((x) => x.uid === c.nextScreenUid);
        if (!target) at('Choose the screen to navigate to.', 'nextScreenUid');
        else if (target.uid === s.uid) at('A screen cannot navigate to itself.', 'nextScreenUid');
      }
      break;
    }
  }
}

function validateOptions(
  options: WaOption[],
  max: number,
  at: (message: string, field?: string) => void,
) {
  if (options.length === 0) at('Add at least one option.', 'options');
  if (options.length > max) at(`At most ${max} options are allowed.`, 'options');
  const ids = new Set<string>();
  options.forEach((o, i) => {
    const n = i + 1;
    if (blank(o.id)) at(`Option ${n} needs a value (ID).`, 'options');
    else if (ids.has(o.id)) at(`Option value "${o.id}" is duplicated.`, 'options');
    ids.add(o.id);
    if (blank(o.title)) at(`Option ${n} needs a title.`, 'options');
    if (o.title.length > LIMITS.optionTitle) at(`Option ${n} title must be ${LIMITS.optionTitle} characters or fewer.`, 'options');
    if (o.description && o.description.length > LIMITS.optionDescription) {
      at(`Option ${n} description must be ${LIMITS.optionDescription} characters or fewer.`, 'options');
    }
  });
}

/**
 * Structural check on generated Meta JSON — a final guard that the transform
 * produced something Meta will accept (independent of the editor model).
 */
export function validateMetaJson(json: { version?: unknown; screens?: unknown }): string[] {
  const errors: string[] = [];
  if (typeof json.version !== 'string') errors.push('Missing "version".');
  if (!Array.isArray(json.screens) || json.screens.length === 0) {
    errors.push('"screens" must be a non-empty array.');
    return errors;
  }
  const ids = new Set<string>();
  let terminal = 0;
  for (const sc of json.screens as Record<string, unknown>[]) {
    const id = String(sc.id ?? '');
    if (!id || ids.has(id)) errors.push(`Screen id "${id}" is missing or duplicated.`);
    ids.add(id);
    const layout = sc.layout as { type?: string; children?: Record<string, unknown>[] } | undefined;
    if (layout?.type !== 'SingleColumnLayout' || !Array.isArray(layout.children)) {
      errors.push(`Screen "${id}" needs a SingleColumnLayout with children.`);
      continue;
    }
    const footers = layout.children.filter((c) => c.type === 'Footer');
    if (footers.length > 1) errors.push(`Screen "${id}" has more than one Footer.`);
    if (sc.terminal) {
      terminal++;
      const action = footers[0]?.['on-click-action'] as { name?: string } | undefined;
      if (action?.name !== 'complete') errors.push(`Terminal screen "${id}" must end with a complete Footer.`);
    }
  }
  for (const sc of json.screens as Record<string, unknown>[]) {
    const children = (sc.layout as { children?: Record<string, unknown>[] })?.children ?? [];
    for (const c of children) {
      const action = c['on-click-action'] as { name?: string; next?: { name?: string } } | undefined;
      if (action?.name === 'navigate' && !ids.has(action.next?.name ?? '')) {
        errors.push(`Screen "${String(sc.id)}" navigates to unknown screen "${action.next?.name ?? ''}".`);
      }
    }
  }
  if (terminal === 0) errors.push('At least one terminal screen is required.');
  return errors;
}
