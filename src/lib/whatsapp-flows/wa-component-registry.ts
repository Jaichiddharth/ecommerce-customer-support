import type {
  WaComponent,
  WaComponentType,
  WaFlow,
  WaOption,
  WaScreen,
} from './wa-flow-types';

// ─── Meta Flow JSON limits (developers.facebook.com/docs/whatsapp/flows/reference/components) ──

export const FLOW_JSON_VERSIONS = ['7.1', '7.0', '6.3'] as const;
export const DEFAULT_FLOW_VERSION = '7.1';

export const LIMITS = {
  componentsPerScreen: 50,
  optInsPerScreen: 5,
  heading: 80,
  subheading: 80,
  body: 4096,
  caption: 409,
  textInputLabel: 20,
  textAreaLabel: 20,
  dropdownLabel: 20,
  selectionLabel: 30, // RadioButtonsGroup / CheckboxGroup
  dateLabel: 40,
  optInLabel: 120,
  footerLabel: 35,
  footerCaption: 15,
  helperText: 80,
  optionTitle: 30,
  optionDescription: 300,
  selectionDescription: 300,
  dropdownMaxOptions: 200,
  selectionMaxOptions: 20,
  textAreaMaxLength: 600,
} as const;

// ─── Palette ─────────────────────────────────────────────────────────────────

export type WaPaletteGroup = 'text' | 'inputs' | 'selection' | 'actions';

export interface WaPaletteItem {
  type: WaComponentType;
  label: string;
  /** Meta component type the item maps to. */
  metaType: string;
  group: WaPaletteGroup;
  description: string;
  icon: string; // lucide icon name, resolved in WaComponentPalette
}

export const WA_GROUP_LABELS: Record<WaPaletteGroup, string> = {
  text: 'Text',
  inputs: 'Inputs',
  selection: 'Selection',
  actions: 'Actions',
};

export const WA_PALETTE_ITEMS: WaPaletteItem[] = [
  { type: 'heading', label: 'Heading', metaType: 'TextHeading', group: 'text', description: 'Large screen title text', icon: 'Heading1' },
  { type: 'subheading', label: 'Subheading', metaType: 'TextSubheading', group: 'text', description: 'Section heading', icon: 'Heading2' },
  { type: 'body', label: 'Body Text', metaType: 'TextBody', group: 'text', description: 'Paragraph / description', icon: 'AlignLeft' },
  { type: 'caption', label: 'Caption', metaType: 'TextCaption', group: 'text', description: 'Small supporting text', icon: 'Type' },
  { type: 'text_input', label: 'Text Input', metaType: 'TextInput', group: 'inputs', description: 'Single-line text, number, email, phone…', icon: 'TextCursorInput' },
  { type: 'text_area', label: 'Text Area', metaType: 'TextArea', group: 'inputs', description: 'Multi-line text', icon: 'FileText' },
  { type: 'date', label: 'Date Picker', metaType: 'DatePicker', group: 'inputs', description: 'Pick a date', icon: 'Calendar' },
  { type: 'dropdown', label: 'Dropdown', metaType: 'Dropdown', group: 'selection', description: 'Pick one from a list', icon: 'ChevronDownSquare' },
  { type: 'radio', label: 'Radio Buttons', metaType: 'RadioButtonsGroup', group: 'selection', description: 'Pick exactly one option', icon: 'CircleDot' },
  { type: 'checkbox', label: 'Checkboxes', metaType: 'CheckboxGroup', group: 'selection', description: 'Pick one or more options', icon: 'CheckSquare' },
  { type: 'opt_in', label: 'Opt-in', metaType: 'OptIn', group: 'actions', description: 'Consent checkbox', icon: 'ShieldCheck' },
  { type: 'footer', label: 'Footer Button', metaType: 'Footer', group: 'actions', description: 'Continue / Submit button', icon: 'RectangleHorizontal' },
];

export const paletteItem = (type: WaComponentType) =>
  WA_PALETTE_ITEMS.find((i) => i.type === type)!;

// ─── Id helpers ──────────────────────────────────────────────────────────────

export const uid = (prefix = 'c') =>
  `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/** Meta screen ids: letters and underscores only (we use upper-case by convention). */
export const SCREEN_ID_PATTERN = /^[A-Za-z_]+$/;
/** Field names: start with a letter, then letters, digits, underscores. */
export const FIELD_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;

export const toScreenId = (s: string) =>
  s.toUpperCase().replace(/[^A-Z_]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'SCREEN';

export const toFieldName = (s: string) => {
  const n = s.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  return /^[a-z]/.test(n) ? n : `field_${n || 'value'}`;
};

export const toOptionId = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_|_$/g, '') || 'option';

/** Appends _2, _3… until `base` is not in `taken`. */
export function uniqueName(base: string, taken: Iterable<string>) {
  const set = new Set(taken);
  if (!set.has(base)) return base;
  let i = 2;
  while (set.has(`${base}_${i}`)) i++;
  return `${base}_${i}`;
}

export const allFieldNames = (flow: WaFlow) =>
  flow.screens.flatMap((s) => s.components.flatMap((c) => ('name' in c ? [c.name] : [])));

// ─── Factories ───────────────────────────────────────────────────────────────

export const makeOption = (title: string): WaOption => ({ uid: uid('o'), id: toOptionId(title), title });

const DEFAULT_NAMES: Partial<Record<WaComponentType, string>> = {
  text_input: 'text_input',
  text_area: 'message',
  dropdown: 'selection',
  radio: 'choice',
  checkbox: 'options',
  date: 'date',
  opt_in: 'consent',
};

/** Creates a component with sensible defaults; `takenNames` keeps field names unique flow-wide. */
export function createComponent(type: WaComponentType, takenNames: Iterable<string> = []): WaComponent {
  const id = uid();
  const name = uniqueName(DEFAULT_NAMES[type] ?? 'field', takenNames);
  switch (type) {
    case 'heading':
      return { uid: id, type, text: 'Heading' };
    case 'subheading':
      return { uid: id, type, text: 'Subheading' };
    case 'body':
      return { uid: id, type, text: 'Add a description for this screen.' };
    case 'caption':
      return { uid: id, type, text: 'Caption text' };
    case 'text_input':
      return { uid: id, type, name, label: 'Text input', required: false, inputType: 'text' };
    case 'text_area':
      return { uid: id, type, name, label: 'Message', required: false };
    case 'dropdown':
      return { uid: id, type, name, label: 'Select an option', required: true, options: [makeOption('Option 1'), makeOption('Option 2')] };
    case 'radio':
      return { uid: id, type, name, label: 'Choose one', required: true, options: [makeOption('Option 1'), makeOption('Option 2')] };
    case 'checkbox':
      return { uid: id, type, name, label: 'Choose any', required: false, options: [makeOption('Option 1'), makeOption('Option 2')] };
    case 'date':
      return { uid: id, type, name, label: 'Select a date', required: false };
    case 'opt_in':
      return { uid: id, type, name, label: 'I agree to the terms and conditions', required: false };
    case 'footer':
      return { uid: id, type, label: 'Continue', action: 'complete' };
  }
}

/** Deep-copies a component with fresh uids and a unique field name. */
export function cloneComponent(c: WaComponent, takenNames: Iterable<string>): WaComponent {
  const copy = JSON.parse(JSON.stringify(c)) as WaComponent;
  copy.uid = uid();
  if ('name' in copy) copy.name = uniqueName(copy.name, takenNames);
  if ('options' in copy) copy.options = copy.options.map((o) => ({ ...o, uid: uid('o') }));
  return copy;
}

export function createScreen(existing: WaScreen[], title = 'New Screen'): WaScreen {
  const screenId = uniqueName(toScreenId(title), [...existing.map((s) => s.id), 'SUCCESS']);
  return {
    uid: uid('s'),
    id: screenId,
    title,
    success: true,
    components: [
      { uid: uid(), type: 'heading', text: title },
      { uid: uid(), type: 'footer', label: 'Continue', action: 'complete' },
    ],
  };
}

/** Footer always renders at the bottom of a Meta screen; keep it last in the editor too. */
export function normalizeOrder(components: WaComponent[]): WaComponent[] {
  const footer = components.filter((c) => c.type === 'footer');
  return footer.length ? [...components.filter((c) => c.type !== 'footer'), ...footer] : components;
}

/** Starter flow modelled on the brand → product → details example. */
export function createSampleFlow(name = 'Product Order Flow'): WaFlow {
  const now = new Date().toISOString();
  const s1 = uid('s');
  const s2 = uid('s');
  const s3 = uid('s');
  return {
    id: uid('flow'),
    name,
    version: DEFAULT_FLOW_VERSION,
    createdAt: now,
    updatedAt: now,
    screens: [
      {
        uid: s1, id: 'SELECT_BRAND', title: 'Select Brand', success: true,
        components: [
          { uid: uid(), type: 'heading', text: 'Choose Your Brand' },
          { uid: uid(), type: 'body', text: 'Select your preferred brand.' },
          { uid: uid(), type: 'dropdown', name: 'brand', label: 'Brand', required: true, options: ['Nike', 'Adidas', 'Puma'].map(makeOption) },
          { uid: uid(), type: 'footer', label: 'Continue', action: 'navigate', nextScreenUid: s2 },
        ],
      },
      {
        uid: s2, id: 'SELECT_PRODUCT', title: 'Select Product', success: true,
        components: [
          { uid: uid(), type: 'heading', text: 'Choose Your Product' },
          { uid: uid(), type: 'radio', name: 'product', label: 'Product', required: true, options: ['Running Shoes', 'T-Shirt', 'Track Pants'].map(makeOption) },
          { uid: uid(), type: 'footer', label: 'Continue', action: 'navigate', nextScreenUid: s3 },
        ],
      },
      {
        uid: s3, id: 'CUSTOMER_DETAILS', title: 'Customer Details', success: true,
        components: [
          { uid: uid(), type: 'heading', text: 'Your Details' },
          { uid: uid(), type: 'text_input', name: 'full_name', label: 'Full Name', required: true, inputType: 'text' },
          { uid: uid(), type: 'text_input', name: 'phone_number', label: 'Phone Number', required: true, inputType: 'phone' },
          { uid: uid(), type: 'text_area', name: 'delivery_address', label: 'Delivery Address', required: true },
          { uid: uid(), type: 'footer', label: 'Submit', action: 'complete' },
        ],
      },
    ],
  };
}

export function createBlankFlow(name = 'Untitled Flow'): WaFlow {
  const now = new Date().toISOString();
  return {
    id: uid('flow'),
    name,
    version: DEFAULT_FLOW_VERSION,
    createdAt: now,
    updatedAt: now,
    screens: [createScreen([], 'Welcome')],
  };
}
