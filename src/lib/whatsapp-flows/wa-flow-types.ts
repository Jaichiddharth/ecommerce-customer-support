// ─── WhatsApp (Meta) Flow builder — internal editor model ───────────────────
// This is the editor's own representation. It is never sent to Meta directly;
// `buildFlowJson` (wa-flow-json.ts) transforms it into Meta Flow JSON.

export type WaComponentType =
  | 'heading'
  | 'subheading'
  | 'body'
  | 'caption'
  | 'text_input'
  | 'text_area'
  | 'dropdown'
  | 'radio'
  | 'checkbox'
  | 'date'
  | 'opt_in'
  | 'footer';

export type WaTextInputType = 'text' | 'number' | 'email' | 'password' | 'passcode' | 'phone';
export type WaFontWeight = 'normal' | 'bold' | 'italic' | 'bold_italic';

export interface WaOption {
  /** Stable key for React lists / dnd; not exported. */
  uid: string;
  /** Exported as data-source `id` (the value sent back in the response). */
  id: string;
  title: string;
  description?: string;
}

interface Base<T extends WaComponentType> {
  uid: string;
  type: T;
}

export interface WaTextComponent extends Base<'heading' | 'subheading' | 'body' | 'caption'> {
  text: string;
  fontWeight?: WaFontWeight; // body / caption only
  strikethrough?: boolean; // body / caption only
  markdown?: boolean; // body / caption only
}

interface WaInputBase {
  /** Field name — becomes the key in the response payload. */
  name: string;
  label: string;
  required: boolean;
}

export interface WaTextInputComponent extends Base<'text_input'>, WaInputBase {
  inputType: WaTextInputType;
  helperText?: string;
  minChars?: number;
  maxChars?: number;
  pattern?: string;
}

export interface WaTextAreaComponent extends Base<'text_area'>, WaInputBase {
  helperText?: string;
  maxLength?: number;
}

export interface WaDropdownComponent extends Base<'dropdown'>, WaInputBase {
  options: WaOption[];
}

export interface WaRadioComponent extends Base<'radio'>, WaInputBase {
  description?: string;
  options: WaOption[];
}

export interface WaCheckboxComponent extends Base<'checkbox'>, WaInputBase {
  description?: string;
  options: WaOption[];
  minSelected?: number;
  maxSelected?: number;
}

export interface WaDateComponent extends Base<'date'>, WaInputBase {
  helperText?: string;
  /** YYYY-MM-DD */
  minDate?: string;
  /** YYYY-MM-DD */
  maxDate?: string;
  /** YYYY-MM-DD values */
  unavailableDates?: string[];
}

export interface WaOptInComponent extends Base<'opt_in'>, WaInputBase {}

export type WaFooterAction = 'navigate' | 'complete';

export interface WaFooterComponent extends Base<'footer'> {
  label: string;
  action: WaFooterAction;
  /** Target screen `uid` (not the Meta screen id) so renames never break links. */
  nextScreenUid?: string;
  leftCaption?: string;
  centerCaption?: string;
  rightCaption?: string;
}

export type WaComponent =
  | WaTextComponent
  | WaTextInputComponent
  | WaTextAreaComponent
  | WaDropdownComponent
  | WaRadioComponent
  | WaCheckboxComponent
  | WaDateComponent
  | WaOptInComponent
  | WaFooterComponent;

export type WaInputComponent =
  | WaTextInputComponent
  | WaTextAreaComponent
  | WaDropdownComponent
  | WaRadioComponent
  | WaCheckboxComponent
  | WaDateComponent
  | WaOptInComponent;

export type WaOptionComponent = WaDropdownComponent | WaRadioComponent | WaCheckboxComponent;

export interface WaScreen {
  uid: string;
  /** Meta screen id, e.g. SELECT_BRAND. */
  id: string;
  title: string;
  /** Terminal screens only: whether finishing here is a successful outcome. */
  success: boolean;
  components: WaComponent[];
}

export interface WaFlow {
  id: string;
  name: string;
  version: string;
  screens: WaScreen[];
  createdAt: string;
  updatedAt: string;
}

// ─── Validation ──────────────────────────────────────────────────────────────

export interface WaIssue {
  severity: 'error' | 'warning';
  message: string;
  screenUid?: string;
  componentUid?: string;
  /** Property key on the component/screen, for inline highlighting. */
  field?: string;
}

// ─── Meta Flow JSON (output) ─────────────────────────────────────────────────

export type MetaComponent = { type: string } & Record<string, unknown>;

export interface MetaScreen {
  id: string;
  title?: string;
  terminal?: boolean;
  success?: boolean;
  data?: Record<string, unknown>;
  layout: { type: 'SingleColumnLayout'; children: MetaComponent[] };
}

export interface MetaFlowJson {
  version: string;
  screens: MetaScreen[];
}

// ─── Type guards ─────────────────────────────────────────────────────────────

const INPUT_TYPES = new Set<WaComponentType>([
  'text_input', 'text_area', 'dropdown', 'radio', 'checkbox', 'date', 'opt_in',
]);

export const isInputComponent = (c: WaComponent): c is WaInputComponent => INPUT_TYPES.has(c.type);

export const isOptionComponent = (c: WaComponent): c is WaOptionComponent =>
  c.type === 'dropdown' || c.type === 'radio' || c.type === 'checkbox';

export const isTextComponent = (c: WaComponent): c is WaTextComponent =>
  c.type === 'heading' || c.type === 'subheading' || c.type === 'body' || c.type === 'caption';
