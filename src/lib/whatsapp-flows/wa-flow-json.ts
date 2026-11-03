import type {
  MetaComponent,
  MetaFlowJson,
  MetaScreen,
  WaComponent,
  WaFlow,
  WaFooterComponent,
  WaOption,
  WaScreen,
} from './wa-flow-types';
import { isInputComponent } from './wa-flow-types';
import { normalizeOrder } from './wa-component-registry';

// ─── Navigation graph ────────────────────────────────────────────────────────

export const footerOf = (s: WaScreen) =>
  s.components.find((c): c is WaFooterComponent => c.type === 'footer');

export interface NavigationInfo {
  /** screenUid → target screenUid (navigate footers only). */
  next: Map<string, string>;
  /** Screens reachable from the entry (first) screen. */
  reachable: Set<string>;
  /** screenUid → screens that can reach it, in flow order (excludes itself). */
  ancestors: Map<string, WaScreen[]>;
  /** Screens that are part of a navigation loop. */
  inCycle: Set<string>;
}

export function analyzeNavigation(flow: WaFlow): NavigationInfo {
  const byUid = new Map(flow.screens.map((s) => [s.uid, s]));
  const next = new Map<string, string>();
  for (const s of flow.screens) {
    const f = footerOf(s);
    if (f?.action === 'navigate' && f.nextScreenUid && byUid.has(f.nextScreenUid)) {
      next.set(s.uid, f.nextScreenUid);
    }
  }

  const walk = (from: string) => {
    const seen: string[] = [];
    let cur = next.get(from);
    while (cur && !seen.includes(cur)) {
      seen.push(cur);
      cur = next.get(cur);
    }
    return seen;
  };

  const reachable = new Set<string>();
  const entry = flow.screens[0];
  if (entry) {
    reachable.add(entry.uid);
    walk(entry.uid).forEach((u) => reachable.add(u));
  }

  const inCycle = new Set<string>();
  const ancestorsUid = new Map<string, Set<string>>(flow.screens.map((s) => [s.uid, new Set()]));
  for (const s of flow.screens) {
    const downstream = walk(s.uid);
    if (downstream.includes(s.uid)) inCycle.add(s.uid);
    for (const d of downstream) if (d !== s.uid) ancestorsUid.get(d)?.add(s.uid);
  }

  const ancestors = new Map<string, WaScreen[]>();
  for (const s of flow.screens) {
    const set = ancestorsUid.get(s.uid)!;
    ancestors.set(s.uid, flow.screens.filter((x) => set.has(x.uid)));
  }

  return { next, reachable, ancestors, inCycle };
}

// ─── Component mapping ───────────────────────────────────────────────────────

const dataSource = (options: WaOption[]) =>
  options.map((o) => ({
    id: o.id,
    title: o.title,
    ...(o.description?.trim() ? { description: o.description } : {}),
  }));

/** Drops undefined / empty-string values so the output only carries what was configured. */
function compact(obj: Record<string, unknown>): MetaComponent {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) continue;
    out[k] = v;
  }
  return out as MetaComponent;
}

/**
 * Meta types these props as Integer (`min-chars`, `max-chars`, `max-length`,
 * `min/max-selected-items`) and rejects strings. Coerces legacy drafts that
 * stored them as strings and drops anything non-finite.
 */
const int = (n: unknown) => {
  if (n === undefined || n === null || n === '') return undefined;
  const v = Math.trunc(Number(n));
  return Number.isFinite(v) ? v : undefined;
};

function toMetaComponent(
  c: WaComponent,
  screensByUid: Map<string, WaScreen>,
  completePayload: Record<string, string>,
): MetaComponent {
  switch (c.type) {
    case 'heading':
      return { type: 'TextHeading', text: c.text };
    case 'subheading':
      return { type: 'TextSubheading', text: c.text };
    case 'body':
    case 'caption':
      return compact({
        type: c.type === 'body' ? 'TextBody' : 'TextCaption',
        text: c.text,
        'font-weight': c.fontWeight && c.fontWeight !== 'normal' ? c.fontWeight : undefined,
        strikethrough: c.strikethrough || undefined,
        markdown: c.markdown || undefined,
      });
    case 'text_input':
      return compact({
        type: 'TextInput',
        name: c.name,
        label: c.label,
        'input-type': c.inputType,
        required: c.required,
        'min-chars': int(c.minChars),
        'max-chars': int(c.maxChars),
        pattern: c.pattern,
        'helper-text': c.helperText,
      });
    case 'text_area':
      return compact({
        type: 'TextArea',
        name: c.name,
        label: c.label,
        required: c.required,
        'max-length': int(c.maxLength),
        'helper-text': c.helperText,
      });
    case 'dropdown':
      return { type: 'Dropdown', name: c.name, label: c.label, required: c.required, 'data-source': dataSource(c.options) };
    case 'radio':
      return compact({
        type: 'RadioButtonsGroup',
        name: c.name,
        label: c.label,
        description: c.description,
        required: c.required,
        'data-source': dataSource(c.options),
      });
    case 'checkbox':
      return compact({
        type: 'CheckboxGroup',
        name: c.name,
        label: c.label,
        description: c.description,
        required: c.required,
        'min-selected-items': int(c.minSelected),
        'max-selected-items': int(c.maxSelected),
        'data-source': dataSource(c.options),
      });
    case 'date':
      return compact({
        type: 'DatePicker',
        name: c.name,
        label: c.label,
        required: c.required,
        'min-date': c.minDate,
        'max-date': c.maxDate,
        'unavailable-dates': c.unavailableDates,
        'helper-text': c.helperText,
      });
    case 'opt_in':
      return { type: 'OptIn', name: c.name, label: c.label, required: c.required };
    case 'footer': {
      const target = c.nextScreenUid ? screensByUid.get(c.nextScreenUid) : undefined;
      const action =
        c.action === 'navigate'
          ? { name: 'navigate', next: { type: 'screen', name: target?.id ?? '' }, payload: {} }
          : { name: 'complete', payload: completePayload };
      return compact({
        type: 'Footer',
        label: c.label,
        'left-caption': c.leftCaption,
        'center-caption': c.centerCaption,
        'right-caption': c.rightCaption,
        'on-click-action': action,
      });
    }
  }
}

// ─── Flow → Meta Flow JSON ───────────────────────────────────────────────────

/**
 * Transforms the editor model into Meta Flow JSON (Form-less layout, Flow JSON 4.0+).
 * The `complete` payload collects every input on the terminal screen (`${form.x}`)
 * plus every input on the screens leading to it (`${screen.ID.form.x}`), so the
 * business receives all answers in the flow response webhook.
 */
export function buildFlowJson(flow: WaFlow): MetaFlowJson {
  const nav = analyzeNavigation(flow);
  const screensByUid = new Map(flow.screens.map((s) => [s.uid, s]));

  const screens: MetaScreen[] = flow.screens.map((s) => {
    const payload: Record<string, string> = {};
    for (const prev of nav.ancestors.get(s.uid) ?? []) {
      for (const c of prev.components) {
        if (isInputComponent(c)) payload[c.name] = `\${screen.${prev.id}.form.${c.name}}`;
      }
    }
    for (const c of s.components) {
      if (isInputComponent(c)) payload[c.name] = `\${form.${c.name}}`;
    }

    const terminal = footerOf(s)?.action === 'complete';
    return {
      id: s.id,
      title: s.title,
      ...(terminal ? { terminal: true, success: s.success } : {}),
      layout: {
        type: 'SingleColumnLayout',
        children: normalizeOrder(s.components).map((c) => toMetaComponent(c, screensByUid, payload)),
      },
    };
  });

  return { version: flow.version, screens };
}
