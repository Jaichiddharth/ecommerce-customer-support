export type TemplateCategory = 'UTILITY' | 'MARKETING' | 'AUTHENTICATION';

export type TemplateStatus = 'APPROVED' | 'PENDING' | 'REJECTED' | 'PAUSED' | 'DISABLED';

export type HeaderType = 'NONE' | 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT';

export type MediaHeaderType = Extract<HeaderType, 'IMAGE' | 'VIDEO' | 'DOCUMENT'>;

export type TemplateButtonType = 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER';

/** Editor-side button (has a local `id` for React keys) */
export interface TemplateButton {
  id: string;
  type: TemplateButtonType;
  text: string;
  url?: string;
  phone_number?: string;
  /** Sample for the {{1}} at the end of a dynamic URL */
  example?: string;
}

export interface TemplateComponent {
  type: 'HEADER' | 'BODY' | 'FOOTER' | 'BUTTONS';
  format?: 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT' | 'LOCATION';
  text?: string;
  example?: {
    header_text?: string[];
    header_handle?: string[];
    body_text?: string[][];
    /** Templates using named parameters ({{first_name}}) carry their samples here */
    header_text_named_params?: Array<{ param_name: string; example: string }>;
    body_text_named_params?: Array<{ param_name: string; example: string }>;
  };
  buttons?: Array<{
    type: 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER' | 'COPY_CODE' | 'OTP' | 'FLOW';
    text: string;
    url?: string;
    phone_number?: string;
    example?: string[];
  }>;
}

export interface WhatsAppTemplate {
  id?: string;
  name: string;
  category: TemplateCategory;
  language: string;
  status?: TemplateStatus;
  components: TemplateComponent[];
  quality_score?: { score: string };
  rejected_reason?: string;
}

/** Meta only accepts edits while a template is in one of these states */
export const EDITABLE_TEMPLATE_STATUSES: TemplateStatus[] = ['APPROVED', 'REJECTED', 'PAUSED'];

export const isTemplateEditable = (tpl: Pick<WhatsAppTemplate, 'id' | 'status'>) =>
  Boolean(tpl.id) && EDITABLE_TEMPLATE_STATUSES.includes((tpl.status?.toUpperCase() ?? '') as TemplateStatus);

/** Meta's limits for message templates */
export const TEMPLATE_LIMITS = {
  name: 80,
  headerText: 60,
  /** Body without variables; see `bodyCharLimit` */
  body: 1024,
  /** Extra body characters allowed per {{n}} placeholder (WhatsApp Manager: one variable → 1028, six → 1048) */
  bodyPerVariable: 4,
  footer: 60,
  buttonText: 25,
  buttons: 10,
  urlButtons: 2,
  phoneButtons: 1,
  url: 2000,
  /** "+" and up to 15 digits (E.164), with room for spaces */
  phoneNumber: 20,
} as const;

/** Accepted header media and Meta's size caps */
export const TEMPLATE_MEDIA_RULES: Record<MediaHeaderType, { accept: string[]; maxBytes: number; label: string }> = {
  IMAGE: { accept: ['image/jpeg', 'image/png'], maxBytes: 5 * 1024 * 1024, label: 'JPG or PNG, up to 5 MB' },
  VIDEO: { accept: ['video/mp4', 'video/3gpp'], maxBytes: 16 * 1024 * 1024, label: 'MP4 or 3GP, up to 16 MB' },
  DOCUMENT: { accept: ['application/pdf'], maxBytes: 100 * 1024 * 1024, label: 'PDF, up to 100 MB' },
};

export const isMediaHeader = (t?: string): t is MediaHeaderType => t === 'IMAGE' || t === 'VIDEO' || t === 'DOCUMENT';
