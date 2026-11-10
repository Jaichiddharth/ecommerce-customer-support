import type { ChannelType } from '@/types';
import { isClosedTicketStatus } from '@/types/ticket';

/**
 * Row returned by GET /api/conversations. Contacts without a ticket are listed too: `hasConversation` is false,
 * `id` is -customerId (not a ticket, so it can't be updated) and the first message sent creates the ticket.
 */
export interface InboxConversation {
  id: number;
  hasConversation: boolean;
  ticketNumber: string;
  status: string | null;
  handledBy: 'ai' | 'human' | string;
  needsHuman: boolean;
  assigneeId: number | null;
  assigneeName: string | null;
  tags: string[];
  aiSummary: string | null;
  aiIntent: string | null;
  aiConfidence: number | null;
  aiActionsCount: number;
  aiModel: string | null;
  aiSuggestions: string[];
  language: string | null;
  lastMessageText: string | null;
  lastMessageAt: string | null;
  createdAt: string;
  resolvedAt: string | null;
  unreadCount: number;
  lastReceivedMessageAt?: string | null;
  /** Latest customer message on this ticket (earlier tickets don't count); null = the customer hasn't written on it */
  ticketCustomerMessageAt?: string | null;
  /** Mock billing: when the first teammate reply made this ticket billable (one ticket credit) */
  billableAt?: string | null;
  lastMessage: {
    senderType: string;
    mediaType: string | null;
    status: number;
    metadata: { aiAction?: string } | null;
  } | null;
  customer: {
    id: number;
    name: string;
    phone: string | null;
    email: string | null;
    handle: string | null;
    avatarUrl: string | null;
    language: string | null;
    tags: string[] | null;
    channelId: number | null;
    /** WhatsApp marketing consent for this contact on its number (opted out = no marketing templates) */
    isOptedOut?: boolean;
    createdAt: string;
  };
  channel: {
    id: number;
    type: string;
    name: string;
    handle: string | null;
    phoneNumber: string | null;
    status?: string | null;
  } | null;
}

/** Row returned by GET /api/channels (disconnected channels are never returned) */
export interface InboxChannel {
  id: number;
  type: string;
  verified_name: string | null;
  handle: string | null;
  phoneNumber: string | null;
  metaPhoneNumberId?: string | null;
  status: 'connected' | 'token_expired' | 'error' | 'disconnected' | string;
  tokenExpiresAt?: string | null;
  lastError?: string | null;
  isActive?: boolean;
  /** Contacts on this channel, with or without a conversation */
  contactCount?: number;
  /** Contacts on this channel who opted out (STOP) */
  optedOutCount?: number;
}

export type ListTab = 'all' | 'ai' | 'needs_human' | 'mine';

/**
 * Which tickets the list shows: the inbox (open tickets, split by the tabs), open tickets nobody owns yet,
 * or resolved tickets
 */
export type TicketView = 'inbox' | 'unassigned' | 'closed';

export const isTicketClosed = (conv: Pick<InboxConversation, 'status'>) => isClosedTicketStatus(conv.status);

/**
 * Unassigned: an open ticket the customer wrote on, that no teammate owns and the AI agent isn't handling
 * (an AI conversation that escalated to a human counts). A teammate's first reply claims it.
 */
export const isTicketUnassigned = (conv: InboxConversation) =>
  conv.hasConversation &&
  !isTicketClosed(conv) &&
  conv.assigneeId == null &&
  Boolean(conv.ticketCustomerMessageAt) &&
  (conv.handledBy !== 'ai' || conv.needsHuman);

/** Channel types the inbox knows how to show; only WhatsApp can send today */
export const CHANNEL_TYPES: ChannelType[] = ['whatsapp', 'instagram', 'messenger', 'email'];
export const SENDABLE_CHANNEL_TYPES = ['whatsapp'];

/** Channels in the order the Channels pane lists them: by type, then as the API returned them */
export const channelsInPaneOrder = <T extends { type: string }>(channels: T[]): T[] =>
  CHANNEL_TYPES.flatMap((type) => channels.filter((c) => c.type === type));

export const CHANNEL_LABELS: Record<string, string> = {
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
  messenger: 'Messenger',
  email: 'Email',
  sms: 'SMS',
};

/** Label used in the chat header, e.g. "Instagram DM" */
export const CHANNEL_THREAD_LABELS: Record<string, string> = {
  whatsapp: 'WhatsApp',
  instagram: 'Instagram DM',
  messenger: 'Messenger',
  email: 'Email',
};

export const isChannelHealthy = (c: Pick<InboxChannel, 'status' | 'isActive'>) =>
  c.status === 'connected' && c.isActive !== false;

export const channelNeedsReconnect = (c: Pick<InboxChannel, 'status'>) =>
  c.status === 'token_expired' || c.status === 'error';

export const formatHandle = (handle?: string | null) =>
  handle ? (handle.startsWith('@') ? handle : `@${handle}`) : '';

/** "+91 98430 41234" for Indian numbers stored as digits; other numbers get a leading "+" */
export function formatPhone(phone?: string | null): string {
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) {
    return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`;
  }
  return digits ? `+${digits}` : phone;
}

/** How a contact is identified on its channel: Instagram handle, phone number or email */
export function contactIdentifier(conv: InboxConversation): string {
  return formatHandle(conv.customer.handle) || formatPhone(conv.customer.phone) || conv.customer.email || '';
}

export function getInitials(name?: string | null): string {
  if (!name) return '?';
  const parts = name.replace(/[._@-]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return (parts[0] || name).slice(0, 2).toUpperCase();
}

const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  hi: 'Hindi',
  ta: 'Tamil',
  te: 'Telugu',
  kn: 'Kannada',
  ml: 'Malayalam',
  mr: 'Marathi',
  bn: 'Bengali',
  gu: 'Gujarati',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  ar: 'Arabic',
};

export function languageName(code?: string | null): string {
  if (!code) return '';
  return LANGUAGE_NAMES[code.toLowerCase().split('-')[0]] || code;
}

/** List timestamp: "10:02" today, "Yesterday", weekday within a week, otherwise "Oct 3" */
export function formatListTime(iso?: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (isNaN(date.getTime())) return '';
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dayMs = 24 * 60 * 60 * 1000;

  if (date.getTime() >= startOfToday) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  }
  if (date.getTime() >= startOfToday - dayMs) return 'Yesterday';
  if (date.getTime() >= startOfToday - 6 * dayMs) return date.toLocaleDateString([], { weekday: 'short' });
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function confidenceLabel(value?: number | null): string {
  if (value === null || value === undefined) return '—';
  const level = value >= 0.75 ? 'High' : value >= 0.5 ? 'Medium' : 'Low';
  return `${level} · ${value.toFixed(2)}`;
}

/** Preview line for the conversation list */
export function lastMessagePreview(conv: InboxConversation): string {
  if (!conv.hasConversation && !conv.lastMessage && !conv.lastMessageText) return 'No conversation yet';
  const text = conv.lastMessageText?.trim();
  if (text && !/^\[(Image|Video|Audio|Document|Voice|Sticker)\](\s*(No caption|attachment)?)?$/i.test(text)) {
    return text;
  }
  const type = (conv.lastMessage?.mediaType || '').toLowerCase();
  if (type === 'image') return 'Photo';
  if (type === 'video') return 'Video';
  if (type === 'audio' || type === 'voice') return 'Voice note';
  if (type === 'document') return 'Document';
  if (type === 'sticker') return 'Sticker';
  return text || 'No messages yet';
}

export function conversationChannelType(conv: InboxConversation): string {
  return conv.channel?.type || 'whatsapp';
}
