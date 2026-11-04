/**
 * WhatsApp marketing consent, shared by server and browser.
 *
 * The current status is `customers.is_opted_out`. A contact row belongs to one workspace (store) and one WhatsApp
 * number, so consent is kept separately per store and per number. Every change is also written to the contact's
 * thread as a team-only system note whose `metadata.consent` is a ConsentChange: that is the consent log.
 */

export type ConsentStatus = 'opted_in' | 'opted_out';

export type ConsentSource =
  /** The customer sent an opt-out / opt-in keyword (STOP, START, …) or tapped a quick reply with that text */
  | 'keyword'
  /** Meta's `user_preferences` webhook: the customer stopped or resumed marketing messages inside WhatsApp */
  | 'meta_preferences'
  /** Meta rejected a marketing message with error 131050: the customer had stopped marketing messages */
  | 'meta_delivery_error'
  /** A teammate changed it from the inbox */
  | 'agent';

/** One status change, stored in `messages.metadata.consent` of the system note that records it */
export interface ConsentChange {
  status: ConsentStatus;
  previousStatus: ConsentStatus;
  source: ConsentSource;
  /** Why it changed, e.g. 'Customer sent "STOP"' */
  reason: string;
  /** The keyword that matched, when source is `keyword` */
  keyword?: string | null;
  /** wamid of the customer message or failed message behind the change */
  metaMessageId?: string | null;
  changedById?: number | null;
  changedByName?: string | null;
  /** When the customer acted (Meta's timestamp), ISO 8601 */
  occurredAt: string;
}

/*
 * Consent & privacy settings. Fixed for now (shown read-only in Settings → Consent & privacy); the webhook's
 * keyword check and the Settings page both read these, so they always match.
 */

/**
 * Messages that opt the customer out. An opted-out customer receives nothing from us (no replies, media, reactions
 * or templates of any category) until they opt back in; only the opt-out confirmation itself is sent.
 * The whole message must be the keyword (case-insensitive, surrounding punctuation ignored), so "please don't stop"
 * never opts anyone out.
 * நிறுத்து = "stop" (Tamil).
 */
export const OPT_OUT_KEYWORDS = ['STOP', 'UNSUBSCRIBE', 'நிறுத்து'];

/** Messages that opt the customer back in */
export const OPT_IN_KEYWORDS = ['START'];

/** Automatic replies sent when a customer opts out / in (only inside WhatsApp's 24-hour window) */
export const CONSENT_CONFIRMATIONS: Record<ConsentStatus, string> = {
  opted_out:
    "You're unsubscribed. You won't receive any more messages from us on WhatsApp. Reply START anytime to subscribe again.",
  opted_in: "You're subscribed again. You'll receive messages and updates from us on WhatsApp. Reply STOP anytime to unsubscribe.",
};

/** Data retention policy shown in Settings. Display only: no contacts are erased automatically yet. */
export const INACTIVE_CONTACT_RETENTION_MONTHS = 24;

/** Breach contact (Data Protection Officer) shown in Settings */
export const BREACH_CONTACT_EMAIL = 'privacy@noctylle.in';

/** India's DPDP Rules: full compliance deadline */
export const DPDP_COMPLIANCE_DEADLINE = '13 May 2027';

export const CONSENT_STATUS_LABELS: Record<ConsentStatus, string> = {
  opted_in: 'Opted-in',
  opted_out: 'Opted-out',
};

export const CONSENT_SOURCE_LABELS: Record<ConsentSource, string> = {
  keyword: 'Keyword',
  meta_preferences: 'WhatsApp preferences',
  meta_delivery_error: 'WhatsApp delivery error',
  agent: 'Changed by teammate',
};

export const consentStatusOf = (isOptedOut: boolean | null | undefined): ConsentStatus =>
  isOptedOut ? 'opted_out' : 'opted_in';
