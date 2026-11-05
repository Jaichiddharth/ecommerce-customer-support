/**
 * Contacts page (Workspace → Contacts), shared by server and browser.
 *
 * A contact row belongs to one channel (one WhatsApp number, Instagram account, ...), so the same person on two
 * numbers is two rows, each with its own consent. The page lists one channel at a time.
 */

/** Only opt-outs are marked; everyone else is a normal contact */
export type ContactConsentFilter = 'any' | 'opted_out';

/** "Last active" filter, in days; 0 means any time */
export const CONTACT_ACTIVITY_WINDOWS = [0, 7, 30, 90] as const;
export type ContactActivityWindow = (typeof CONTACT_ACTIVITY_WINDOWS)[number];

export const CONTACTS_PAGE_SIZE = 25;

export interface ContactListItem {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  handle: string | null;
  avatarUrl: string | null;
  isOptedOut: boolean;
  channel: { id: number; type: string; name: string };
  /** Latest message in any of the contact's conversations, ISO 8601; null when nothing was exchanged yet */
  lastActiveAt: string | null;
  /** Has a ticket: only then can the contact's chat be opened in the inbox */
  hasConversation: boolean;
  createdAt: string;
}

/** A live channel with how many contacts it has and how many of them opted out */
export interface ContactChannelSummary {
  id: number;
  type: string;
  name: string;
  phoneNumber: string | null;
  handle: string | null;
  total: number;
  optedOut: number;
}

export interface ContactListResponse {
  success: true;
  /** The channel listed: the one asked for, or the first live channel; null when none is connected */
  channelId: number | null;
  contacts: ContactListItem[];
  /** Contacts matching the filters, across all pages */
  total: number;
  page: number;
  pageSize: number;
  channels: ContactChannelSummary[];
}
