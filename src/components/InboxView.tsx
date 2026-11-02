'use client';

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import apiClient from '@/lib/api/client';

import {
  Send,
  Paperclip,
  Smile,
  Plus,
  ChevronDown,
  MessageSquare,
  ExternalLink,
  X,
  Check,
  User,
  Sparkles,
  CheckCheck,
  AlertCircle,
  Loader2,
  FileText,
  Image as ImageIcon,
  Film,
  Music,
  Download,
  CircleCheck,
  RotateCcw,
  ShoppingBag,
  Clock,
  AlertTriangle,
  Search,
  RefreshCw,
} from 'lucide-react';
import { Message, MessageStatus, normalizeMessageStatus } from '../types';
import { useAuth } from '../context/AuthContext';
import { AddChannelModal } from './channels/AddChannelModal';
import { WhatsAppMediaAttachment } from './whatsapp/WhatsAppMediaAttachment';
import { gooeyToast } from '@/components/ui/goey-toaster';
import { Modal } from '@/components/ui/Modal';
import {
  EmojiPicker,
  EmojiPickerSearch,
  EmojiPickerContent,
  EmojiPickerFooter,
} from './ui/emoji-picker';
import { useRealtime } from '@/lib/hooks/useRealtime';
import { ApiError, toApiError } from '@/lib/api/api-error';
import { notifyError, notifyWarning } from '@/lib/api/notify';
import { clientLogger } from '@/lib/client-logger';
import { ErrorState } from '@/components/ui/states';
import { describeMessageFailure, getMetaErrorInfo } from '@/lib/errors/meta-errors';
import { validateWhatsAppMedia } from '@/lib/media-limits';
import { ChannelsPane } from './inbox/ChannelsPane';
import { ConversationList, Avatar, StatusFilter } from './inbox/ConversationList';
import { CustomerPanel } from './inbox/CustomerPanel';
import { VirtualMessageList } from './inbox/VirtualMessageList';
import { InboxTopBar } from './inbox/InboxTopBar';
import { ProductBrowser, type ShareProductArgs } from './shopify/ProductBrowser';
import { useShopifyStore } from './shopify/useShopifyStore';
import { TemplateComposer, forgetCachedTemplates, type TemplateDraft } from './inbox/TemplateComposer';
import {
  buildTemplateSendComponents,
  getTemplateSendFields,
  getTemplateValueErrors,
  renderTemplateMessage,
} from '@/lib/whatsapp-templates';
import {
  CHANNEL_LABELS,
  CHANNEL_THREAD_LABELS,
  ChannelFilter,
  InboxChannel,
  InboxConversation,
  ListTab,
  SENDABLE_CHANNEL_TYPES,
  conversationChannelType,
  formatHandle,
  formatPhone,
  isChannelHealthy,
  languageName,
} from './inbox/inbox-types';

/**
 * Render Status Indicator for an outbound message
 * 0 (Sent): Single check
 * 1 (Delivered): Double check (neutral)
 * 2 (Read): Double check (sky blue)
 * 3 (Failed): Red alert icon with label / error code
 */
const renderMessageStatusIndicator = (statusVal: unknown, errorCode?: number | null, errorMessage?: string | null) => {
  const norm = normalizeMessageStatus(statusVal);
  switch (norm) {
    case MessageStatus.SENT:
      return (
        <span title="Sent" className="inline-flex items-center">
          <Check className="w-3.5 h-3.5 text-slate-400" />
        </span>
      );
    case MessageStatus.DELIVERED:
      return (
        <span title="Delivered" className="inline-flex items-center">
          <CheckCheck className="w-3.5 h-3.5 text-slate-400" />
        </span>
      );
    case MessageStatus.READ:
      return (
        <span title="Read" className="inline-flex items-center">
          <CheckCheck className="w-3.5 h-3.5 text-sky-500" />
        </span>
      );
    case MessageStatus.FAILED: { // short reason on the badge, full explanation on hover
      const info = getMetaErrorInfo(errorCode);
      const reason = errorMessage || describeMessageFailure(errorCode);
      const tooltip = [info?.title, reason, errorCode ? `(WhatsApp error ${errorCode})` : null].filter(Boolean).join(' — ');
      return (
        <span
          title={tooltip}
          className="inline-flex items-center gap-1 text-[10px] font-semibold text-red-600 bg-red-50 px-1.5 py-0.5 rounded border border-red-200 cursor-help max-w-[240px]"
        >
          <AlertCircle className="w-3 h-3 shrink-0" />
          <span className="truncate">Failed · {info?.title ?? reason}</span>
        </span>
      );
    }
    default:
      return null;
  }
};

/**
 * Detects URLs in text (http, https, www) and renders them as clickable links.
 */
const renderMessageWithLinks = (text: string) => {
  if (!text) return null;

  const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+)/gi;
  const parts = text.split(urlRegex);

  return parts.map((part, index) => {
    if (part.match(urlRegex)) {
      let cleanUrl = part;
      let trailingPunctuation = '';
      const trailingMatch = cleanUrl.match(/[.,!?:;)]+$/);
      if (trailingMatch) {
        trailingPunctuation = trailingMatch[0];
        cleanUrl = cleanUrl.slice(0, -trailingPunctuation.length);
      }

      const href = cleanUrl.startsWith('http://') || cleanUrl.startsWith('https://') ? cleanUrl : `https://${cleanUrl}`;

      return (
        <React.Fragment key={index}>
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="underline underline-offset-2 break-all text-[#3440a8] font-medium hover:text-[#2b3590]"
          >
            {cleanUrl}
          </a>
          {trailingPunctuation}
        </React.Fragment>
      );
    }
    return part;
  });
};

/** WhatsApp placeholder captions that should not be shown as message text */
const isPlaceholderText = (text?: string) =>
  !text ||
  !text.trim() ||
  /^\[(Image|Video|Audio|Document|Voice)\](\s*(No caption|attachment)?)?$/i.test(text) ||
  text === '[Image] No caption' ||
  text === '[Video] No caption';

const formatTime = (iso?: string | Date) => {
  const d = iso ? new Date(iso) : new Date();
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
};

const dayKey = (iso?: string | Date) => {
  const d = iso ? new Date(iso) : new Date();
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

const formatDayLabel = (iso?: string | Date) => {
  const d = iso ? new Date(iso) : new Date();
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (dayKey(d) === dayKey(today)) return 'Today';
  if (dayKey(d) === dayKey(yesterday)) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
};

/** Maps a message row from the API (or a realtime event) to the UI message shape */
const mapApiMessage = (m: any, channel: string): Message => {
  const dateObj = m.createdAt ? new Date(m.createdAt) : new Date();
  return {
    id: String(m.id),
    sender: m.senderType === 'customer' ? 'customer' : m.senderType === 'ai' ? 'bot' : 'agent',
    senderId: m.senderId ?? null,
    senderName: m.senderName ?? null,
    channel: channel as Message['channel'],
    text: m.textContent || '',
    timestamp: formatTime(dateObj),
    createdAt: dateObj.toISOString(),
    status: m.status !== undefined ? normalizeMessageStatus(m.status) : MessageStatus.DELIVERED,
    errorCode: m.errorCode || undefined,
    type: m.mediaType || (m.mediaUrl ? 'image' : 'text'),
    // A template's header file is stored as its media; show it as the header's kind (image/video/document)
    mediaType: m.metadata?.template?.headerFormat || m.mediaType || undefined,
    mediaUrl: m.mediaUrl || undefined,
    metaMessageId: m.metaMessageId || undefined,
    isInternalNote: Boolean(m.isInternalNote),
    aiAction: m.metadata?.aiAction ?? null,
    reactions: m.reactions || [],
  };
};

const convKeyFor = (customerId: number | string) => `cust-${customerId}`;

/** Messages fetched per batch when opening a thread or scrolling up */
const MESSAGE_PAGE_SIZE = 10;

/** Optimistic bubbles get a temporary `msg-<timestamp>` id until the server returns the stored row */
const isTempMessage = (m: Message) => m.id.startsWith('msg-');

const isOlderThan = (a: Message, b: Message) =>
  a.createdAt === b.createdAt ? Number(a.id) < Number(b.id) : (a.createdAt ?? '') < (b.createdAt ?? '');

/** Puts a freshly fetched newest batch in place while keeping the older batches already loaded above it */
const mergeLatestPage = (existing: Message[], page: Message[]): Message[] => {
  if (page.length === 0) return page;
  const pageIds = new Set(page.map((m) => m.id));
  const older = existing.filter((m) => !isTempMessage(m) && !pageIds.has(m.id) && isOlderThan(m, page[0]));
  return [...older, ...page];
};

interface ThreadPaging {
  /** The newest batch has arrived at least once */
  loaded: boolean;
  /** Older messages exist above the oldest loaded one */
  hasMore: boolean;
}

type ComposerMode = 'reply' | 'note' | 'template';

export interface MetaTemplateComponent {
  type: string;
  format?: string;
  text?: string;
  example?: {
    body_text?: string[][];
    header_text?: string[];
    header_handle?: string[];
  };
  buttons?: Array<{
    type: string;
    text: string;
    url?: string;
    phone_number?: string;
  }>;
}

export interface MetaTemplate {
  id: string;
  name: string;
  status: string;
  category: string;
  language: string;
  components?: MetaTemplateComponent[];
}

export interface InboxCounts {
  unread: number;
  ai: number;
}

interface InboxViewProps {
  selectedConversationId?: string;
  onSelectConversation?: (id: string) => void;
  onCountsChange?: (counts: InboxCounts) => void;
}

export const InboxView: React.FC<InboxViewProps> = ({ selectedConversationId, onSelectConversation, onCountsChange }) => {
  const { dbUser } = useAuth();

  // Channels & conversations from DB
  const [channels, setChannels] = useState<InboxChannel[]>([]);
  const [isLoadingChannels, setIsLoadingChannels] = useState(true);
  const [conversations, setConversations] = useState<InboxConversation[]>([]);
  const [isLoadingConversations, setIsLoadingConversations] = useState(true);
  const [conversationsError, setConversationsError] = useState<ApiError | null>(null);

  // Navigation & filtering
  const [isChannelsCollapsed, setIsChannelsCollapsed] = useState(false);
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>({ kind: 'all' });
  const [listTab, setListTab] = useState<ListTab>('all');
  const [listSearch, setListSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('open');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [internalSelectedId, setInternalSelectedId] = useState<string>('');

  // Modals & popovers
  const [showAddChannelModal, setShowAddChannelModal] = useState(false);
  const [showNewContactModal, setShowNewContactModal] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showCopilot, setShowCopilot] = useState(false);
  const [showModeMenu, setShowModeMenu] = useState(false);
  const [showProductPicker, setShowProductPicker] = useState(false);
  const [previewMedia, setPreviewMedia] = useState<{
    url: string;
    type: 'image' | 'video' | 'audio' | 'document' | string;
    senderName?: string;
    timestamp?: string;
    caption?: string;
  } | null>(null);

  // Messages
  const [messagesMap, setMessagesMap] = useState<Record<string, Message[]>>({});
  const [messagesLoadError, setMessagesLoadError] = useState<{ convId: string; error: ApiError } | null>(null);
  const [threadPaging, setThreadPaging] = useState<Record<string, ThreadPaging>>({});
  const [loadingOlderConvId, setLoadingOlderConvId] = useState<string | null>(null);
  const [reactionPickerMsgId, setReactionPickerMsgId] = useState<string | null>(null);
  const [reactionPickerPlacement, setReactionPickerPlacement] = useState<'top' | 'bottom'>('top');
  const [showFullReactionPicker, setShowFullReactionPicker] = useState(false);

  // Composer
  const [composerMode, setComposerMode] = useState<ComposerMode>('reply');
  const [inputMessage, setInputMessage] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [filePreviewUrl, setFilePreviewUrl] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [templateDraft, setTemplateDraft] = useState<TemplateDraft | null>(null);
  const [templateRevision, setTemplateRevision] = useState(0);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const loadingOlderRef = useRef<Set<string>>(new Set());
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const reactionPickerRef = useRef<HTMLDivElement>(null);
  const copilotRef = useRef<HTMLDivElement>(null);
  const modeMenuRef = useRef<HTMLDivElement>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const markReadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const whatsappChannels = useMemo(() => channels.filter((c) => c.type === 'whatsapp'), [channels]);

  const currentSelectedId = selectedConversationId || internalSelectedId;
  const selectedCustomerId = currentSelectedId.startsWith('cust-') ? Number(currentSelectedId.replace('cust-', '')) : null;

  const activeConv = useMemo(
    () => (selectedCustomerId ? conversations.find((c) => c.customer.id === selectedCustomerId) ?? null : null),
    [conversations, selectedCustomerId]
  );
  const activeChannelType = activeConv ? conversationChannelType(activeConv) : 'whatsapp';
  const activeMessages = activeConv ? messagesMap[convKeyFor(activeConv.customer.id)] || [] : [];
  const isChannelDisconnected = activeConv?.channel?.status === 'disconnected';
  const canSendOnChannel = SENDABLE_CHANNEL_TYPES.includes(activeChannelType) && !isChannelDisconnected;

  // -------------------------------------------------------------
  // DATA LOADING
  // -------------------------------------------------------------
  const fetchConversations = useCallback(async (): Promise<ApiError | null> => {
    try {
      const res = await apiClient.get('/api/conversations');
      if (res.data?.success && Array.isArray(res.data.conversations)) {
        setConversations(res.data.conversations);
      }
      setConversationsError(null);
      return null;
    } catch (err) {
      const apiError = toApiError(err);
      setConversationsError(apiError);
      return apiError;
    } finally {
      setIsLoadingConversations(false);
    }
  }, []);

  /** Coalesces bursts of realtime events into one list refresh */
  const refreshConversationsSoon = useCallback(() => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => {
      fetchConversations();
    }, 400);
  }, [fetchConversations]);

  const fetchChannels = useCallback(async () => {
    try {
      setIsLoadingChannels(true);
      const res = await apiClient.get('/api/channels');
      if (res.data?.success && Array.isArray(res.data.channels)) {
        setChannels(res.data.channels);
      }
    } catch (err) {
      notifyError(err, { where: 'InboxView.fetchChannels', title: "Couldn't load channels" });
    } finally {
      setIsLoadingChannels(false);
    }
  }, []);

  // Fetches the newest batch (merged under any older batches already loaded).
  // It also marks the customer's unread messages as read on the server.
  const fetchMessagesForCustomer = useCallback(async (customerId: number, channelType = 'whatsapp'): Promise<ApiError | null> => {
    const convId = convKeyFor(customerId);
    try {
      const res = await apiClient.get(`/api/messages?customerId=${customerId}&limit=${MESSAGE_PAGE_SIZE}`);
      if (res.data?.success && Array.isArray(res.data.messages)) {
        const mapped: Message[] = res.data.messages.map((m: any) => mapApiMessage(m, channelType));
        setMessagesMap((prev) => ({ ...prev, [convId]: mergeLatestPage(prev[convId] || [], mapped) }));
        // Once older batches are loaded, their hasMore is the one that matters
        setThreadPaging((prev) => ({
          ...prev,
          [convId]: { loaded: true, hasMore: prev[convId]?.loaded ? prev[convId].hasMore : Boolean(res.data.hasMore) },
        }));
        setMessagesLoadError((prev) => (prev?.convId === convId ? null : prev));
      }
      return null;
    } catch (err) {
      const apiError = toApiError(err);
      setMessagesLoadError({ convId, error: apiError });
      return apiError;
    }
  }, []);

  // Fetches the batch above the oldest loaded message, triggered by scrolling to the top of the thread
  const loadOlderMessages = useCallback(async (customerId: number, beforeId: number, channelType = 'whatsapp') => {
    const convId = convKeyFor(customerId);
    if (loadingOlderRef.current.has(convId)) return;
    loadingOlderRef.current.add(convId);
    setLoadingOlderConvId(convId);
    try {
      const res = await apiClient.get(`/api/messages?customerId=${customerId}&limit=${MESSAGE_PAGE_SIZE}&before=${beforeId}`);
      if (res.data?.success && Array.isArray(res.data.messages)) {
        const older: Message[] = res.data.messages.map((m: any) => mapApiMessage(m, channelType));
        setMessagesMap((prev) => {
          const existing = prev[convId] || [];
          const knownIds = new Set(existing.map((m) => m.id));
          return { ...prev, [convId]: [...older.filter((m) => !knownIds.has(m.id)), ...existing] };
        });
        setThreadPaging((prev) => ({ ...prev, [convId]: { loaded: true, hasMore: Boolean(res.data.hasMore) } }));
      }
    } catch (err) {
      notifyError(err, { where: 'InboxView.loadOlderMessages', title: "Couldn't load earlier messages" });
    } finally {
      loadingOlderRef.current.delete(convId);
      setLoadingOlderConvId((prev) => (prev === convId ? null : prev));
    }
  }, []);

  useEffect(() => {
    fetchConversations();
    fetchChannels();

    // Reconnecting a number brings its contacts and threads back, so conversations are refreshed too
    const handleChannelConnected = () => {
      fetchChannels();
      fetchConversations();
    };
    window.addEventListener('whatsapp-channel-connected', handleChannelConnected);
    return () => {
      window.removeEventListener('whatsapp-channel-connected', handleChannelConnected);
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      if (markReadTimerRef.current) clearTimeout(markReadTimerRef.current);
    };
  }, [fetchConversations, fetchChannels]);

  // Load messages whenever a conversation is opened
  useEffect(() => {
    if (!selectedCustomerId) return;
    fetchMessagesForCustomer(selectedCustomerId, activeChannelType);
    // Opening the thread reads it
    setConversations((prev) =>
      prev.map((c) => (c.customer.id === selectedCustomerId && c.unreadCount > 0 ? { ...c, unreadCount: 0 } : c))
    );
    setComposerMode('reply');
    setTemplateDraft(null);
    setShowModeMenu(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCustomerId, fetchMessagesForCustomer]);

  // If the selected customer is no longer listed in conversations, close the thread
  useEffect(() => {
    if (isLoadingConversations || !selectedCustomerId || activeConv) return;
    setInternalSelectedId('');
    onSelectConversation?.('');
  }, [isLoadingConversations, selectedCustomerId, activeConv, onSelectConversation]);

  // Rail badges: unread conversations total and conversations the AI agent is handling
  useEffect(() => {
    if (!onCountsChange) return;
    const unread = conversations.reduce((sum, c) => sum + (c.customer.id === selectedCustomerId ? 0 : c.unreadCount), 0);
    const ai = conversations.filter((c) => c.handledBy === 'ai' && c.status !== 'RESOLVED' && c.status !== 'CLOSED').length;
    onCountsChange({ unread, ai });
  }, [conversations, selectedCustomerId, onCountsChange]);

  // Close popovers when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(target)) setShowEmojiPicker(false);
      if (copilotRef.current && !copilotRef.current.contains(target)) setShowCopilot(false);
      if (modeMenuRef.current && !modeMenuRef.current.contains(target)) setShowModeMenu(false);
      if (reactionPickerRef.current && !reactionPickerRef.current.contains(target)) {
        setReactionPickerMsgId(null);
        setShowFullReactionPicker(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelectConversation = (conv: InboxConversation) => {
    const id = convKeyFor(conv.customer.id);
    setInternalSelectedId(id);
    onSelectConversation?.(id);
  };

  // -------------------------------------------------------------
  // REAL-TIME SSE SYNC HANDLERS
  // -------------------------------------------------------------

  /** Inserts or replaces a message, matching by DB id, Meta id, or the optimistic temp bubble */
  const upsertMessage = useCallback((convId: string, incoming: Message, tempId?: string) => {
    setMessagesMap((prev) => {
      const existing = prev[convId] || [];
      const idx = existing.findIndex((m) => {
        if (m.id === incoming.id) return true;
        if (tempId && m.id === tempId) return true;
        if (incoming.metaMessageId && m.metaMessageId === incoming.metaMessageId) return true;
        return (
          m.id.startsWith('msg-') &&
          m.sender === incoming.sender &&
          m.text === incoming.text &&
          Boolean(m.isInternalNote) === Boolean(incoming.isInternalNote)
        );
      });
      if (idx < 0) return { ...prev, [convId]: [...existing, incoming] };
      const updated = existing
        .map((m, i) => (i === idx ? { ...m, ...incoming, mediaUrl: incoming.mediaUrl || m.mediaUrl } : m))
        // Drop a leftover temp bubble once the real message is in place
        .filter((m, i) => !(tempId && i !== idx && m.id === tempId));
      return { ...prev, [convId]: updated };
    });
  }, []);

  const handleRealtimeNewMessage = useCallback(
    (event: { customerId: number; customer?: any; message: any }) => {
      const { customerId, customer, message: rawMsg } = event;
      if (!rawMsg || !customerId) return;

      const known = conversations.find((c) => c.customer.id === customerId);
      const channelType = known ? conversationChannelType(known) : 'whatsapp';
      const incomingMsg = mapApiMessage(rawMsg, channelType);
      const isOpen = selectedCustomerId === customerId;

      upsertMessage(convKeyFor(customerId), incomingMsg);

      if (!known) {
        refreshConversationsSoon();
      } else {
        // Bump the conversation to the top with the new preview
        setConversations((prev) => {
          const idx = prev.findIndex((c) => c.customer.id === customerId);
          if (idx < 0) return prev;
          const conv = prev[idx];
          const updated: InboxConversation = incomingMsg.isInternalNote
            ? conv
            : {
              ...conv,
              lastMessageText: rawMsg.textContent ?? null,
              lastMessageAt: rawMsg.createdAt || new Date().toISOString(),
              lastMessage: {
                senderType: rawMsg.senderType,
                mediaType: rawMsg.mediaType ?? null,
                status: rawMsg.status ?? 0,
                metadata: rawMsg.metadata ?? null,
              },
              unreadCount: rawMsg.senderType === 'customer' && !isOpen ? conv.unreadCount + 1 : conv.unreadCount,
            };
          return [updated, ...prev.slice(0, idx), ...prev.slice(idx + 1)];
        });
        // Agent replies can change who handles the conversation (human takes over from AI)
        if (rawMsg.senderType === 'agent') refreshConversationsSoon();
      }

      if (isOpen && rawMsg.senderType === 'customer') {
        // The agent is looking at it: let the server mark it read
        if (markReadTimerRef.current) clearTimeout(markReadTimerRef.current);
        markReadTimerRef.current = setTimeout(() => fetchMessagesForCustomer(customerId, channelType), 800);
      } else if (!isOpen && rawMsg.senderType === 'customer') {
        const senderName = customer?.name || customer?.phone || 'Customer';
        gooeyToast.info(`New message from ${senderName}`, {
          description: rawMsg.textContent || `[${(rawMsg.mediaType || 'media').toUpperCase()}] New attachment`,
        });
      }
    },
    [conversations, selectedCustomerId, upsertMessage, refreshConversationsSoon, fetchMessagesForCustomer]
  );

  const handleRealtimeStatus = useCallback(
    (event: { customerId?: number; metaMessageId: string; status: number | string; errorCode?: number | null }) => {
      const { customerId, metaMessageId, status: newStatusVal, errorCode } = event;
      if (!metaMessageId) return;
      const normStatus = normalizeMessageStatus(newStatusVal);

      setMessagesMap((prev) => {
        const next = { ...prev };
        const targetConvKeys = customerId ? [convKeyFor(customerId)] : Object.keys(next);
        for (const convKey of targetConvKeys) {
          const msgs = next[convKey];
          if (!msgs || msgs.length === 0) continue;
          const msgIndex = msgs.findIndex((m) => m.metaMessageId === metaMessageId);
          if (msgIndex >= 0) {
            const updatedMsgs = [...msgs];
            updatedMsgs[msgIndex] = {
              ...updatedMsgs[msgIndex],
              status: normStatus,
              errorCode: errorCode !== undefined ? errorCode : updatedMsgs[msgIndex].errorCode,
            };
            next[convKey] = updatedMsgs;
            return next;
          }
        }
        return prev;
      });
    },
    []
  );

  const handleRealtimeReaction = useCallback(
    (event: { customerId?: number; messageId: number; emoji: string | null; userId?: number | null }) => {
      const { customerId, messageId, emoji, userId } = event;
      if (!messageId) return;
      const targetMsgIdStr = String(messageId);

      setMessagesMap((prev) => {
        const next = { ...prev };
        const targetConvKeys = customerId ? [convKeyFor(customerId)] : Object.keys(next);
        for (const convKey of targetConvKeys) {
          const msgs = next[convKey];
          if (!msgs || msgs.length === 0) continue;
          const msgIdx = msgs.findIndex((m) => m.id === targetMsgIdStr);
          if (msgIdx < 0) continue;

          const targetMsg = msgs[msgIdx];
          let reactions = [...(targetMsg.reactions || [])];
          if (emoji) {
            const existingIdx = reactions.findIndex((r) =>
              userId ? r.userId === userId : Boolean(r.customerId && r.customerId === customerId)
            );
            if (existingIdx >= 0) {
              reactions[existingIdx] = { ...reactions[existingIdx], emoji };
            } else {
              reactions.push({ id: Date.now(), emoji, userId: userId || null, customerId: customerId || null });
            }
          } else {
            reactions = reactions.filter((r) => {
              if (userId) return r.userId !== userId;
              if (customerId) return r.customerId !== customerId;
              return true;
            });
          }
          const updatedMsgs = [...msgs];
          updatedMsgs[msgIdx] = { ...targetMsg, reactions };
          next[convKey] = updatedMsgs;
          return next;
        }
        return prev;
      });
    },
    []
  );

  const { isConnected: isRealtimeConnected } = useRealtime({
    onMessageNew: handleRealtimeNewMessage,
    onMessageStatus: handleRealtimeStatus,
    onMessageReaction: handleRealtimeReaction,
    onConversationUpdated: refreshConversationsSoon,
    onChannelUpdated: () => {
      fetchChannels();
      refreshConversationsSoon();
    },
    // A newly approved (or paused) template must show up in, or drop out of, the Template tab
    onTemplateStatus: () => {
      forgetCachedTemplates();
      setTemplateRevision((r) => r + 1);
    },
  });

  // -------------------------------------------------------------
  // FILTERING
  // -------------------------------------------------------------
  // A disconnected channel drops out of the Channels pane; don't leave the inbox filtered to it
  useEffect(() => {
    if (isLoadingChannels) return;
    const stale =
      (channelFilter.kind === 'channel' && !channels.some((c) => c.id === channelFilter.id)) ||
      (channelFilter.kind === 'type' && !channels.some((c) => c.type === channelFilter.type));
    if (stale) setChannelFilter({ kind: 'all' });
  }, [channels, channelFilter, isLoadingChannels]);

  const channelScoped = useMemo(
    () =>
      conversations.filter((conv) => {
        if (channelFilter.kind === 'all') return true;
        if (channelFilter.kind === 'type') return conversationChannelType(conv) === channelFilter.type;
        return conv.channel?.id === channelFilter.id;
      }),
    [conversations, channelFilter]
  );

  const statusScoped = useMemo(
    () =>
      channelScoped.filter((conv) => {
        const resolved = conv.status === 'RESOLVED' || conv.status === 'CLOSED';
        if (statusFilter === 'open') return !resolved;
        if (statusFilter === 'resolved') return resolved;
        return true;
      }),
    [channelScoped, statusFilter]
  );

  const tabCounts = useMemo<Record<ListTab, number>>(
    () => ({
      all: statusScoped.length,
      ai: statusScoped.filter((c) => c.handledBy === 'ai').length,
      needs_human: statusScoped.filter((c) => c.needsHuman).length,
      mine: statusScoped.filter((c) => dbUser?.id != null && c.assigneeId === dbUser.id).length,
    }),
    [statusScoped, dbUser?.id]
  );

  const visibleConversations = useMemo(() => {
    const q = listSearch.trim().toLowerCase();
    const digits = q.replace(/\D/g, '');
    return statusScoped.filter((conv) => {
      if (listTab === 'ai' && conv.handledBy !== 'ai') return false;
      if (listTab === 'needs_human' && !conv.needsHuman) return false;
      if (listTab === 'mine' && (dbUser?.id == null || conv.assigneeId !== dbUser.id)) return false;
      if (unreadOnly && conv.unreadCount === 0) return false;
      if (!q) return true;
      const { name, handle, phone, email } = conv.customer;
      return (
        name.toLowerCase().includes(q) ||
        (handle ?? '').toLowerCase().includes(q.replace(/^@/, '')) ||
        (email ?? '').toLowerCase().includes(q) ||
        (digits.length > 2 && (phone ?? '').includes(digits)) ||
        (conv.lastMessageText ?? '').toLowerCase().includes(q) ||
        conv.ticketNumber.toLowerCase().includes(q)
      );
    });
  }, [statusScoped, listTab, listSearch, unreadOnly, dbUser?.id]);

  // Top bar context chip, e.g. "Instagram · @noctylle"
  const scope = useMemo(() => {
    if (channelFilter.kind === 'all') return { type: null, label: 'All channels' };
    if (channelFilter.kind === 'channel') {
      const ch = channels.find((c) => c.id === channelFilter.id);
      if (!ch) return { type: null, label: 'All channels' };
      return {
        type: ch.type,
        label: `${CHANNEL_LABELS[ch.type] || ch.type} · ${ch.verified_name || formatPhone(ch.phoneNumber) || formatHandle(ch.handle)}`,
      };
    }
    const items = channels.filter((c) => c.type === channelFilter.type);
    const label = CHANNEL_LABELS[channelFilter.type] || channelFilter.type;
    if (items.length === 1) {
      const detail = formatHandle(items[0].handle) || formatPhone(items[0].phoneNumber) || items[0].verified_name;
      return { type: channelFilter.type, label: detail ? `${label} · ${detail}` : label };
    }
    return { type: channelFilter.type, label: items.length > 1 ? `${label} · ${items.length} accounts` : label };
  }, [channelFilter, channels]);

  // Number shown in the top bar: the selected WhatsApp number, else the first healthy one
  const primaryNumber = useMemo(() => {
    if (channelFilter.kind === 'channel') {
      const ch = channels.find((c) => c.id === channelFilter.id);
      if (ch?.type === 'whatsapp' && ch.phoneNumber) return ch.phoneNumber;
    }
    return (whatsappChannels.find(isChannelHealthy) || whatsappChannels[0])?.phoneNumber ?? null;
  }, [channelFilter, channels, whatsappChannels]);

  // WhatsApp number used to reply in the open conversation
  const conversationSendChannel = useMemo(() => {
    if (!activeConv) return null;
    const preferredId = activeConv.channel?.id ?? activeConv.customer.channelId;
    return (
      whatsappChannels.find((c) => c.id === preferredId) ||
      whatsappChannels.find(isChannelHealthy) ||
      whatsappChannels[0] ||
      null
    );
  }, [activeConv, whatsappChannels]);

  // -------------------------------------------------------------
  // 24-HOUR CUSTOMER CARE WINDOW (WhatsApp Policy)
  // -------------------------------------------------------------
  const lastCustomerMessageTime = useMemo(() => {
    for (let i = activeMessages.length - 1; i >= 0; i--) {
      const msg = activeMessages[i];
      const raw = msg.createdAt;
      if (msg.sender === 'customer' && raw) {
        const time = new Date(raw).getTime();
        if (!isNaN(time)) return time;
      }
    }
    if (activeConv?.lastReceivedMessageAt) {
      const time = new Date(activeConv.lastReceivedMessageAt).getTime();
      if (!isNaN(time)) return time;
    }
    return null;
  }, [activeMessages, activeConv?.lastReceivedMessageAt]);

  const window24hStatus = useMemo(() => {
    if (activeChannelType !== 'whatsapp') {
      return {
        isExpired: false,
        isWithin24Hours: true,
        hoursRemaining: null,
        hoursSinceLast: null,
        hasReceivedMessage: true,
      };
    }
    if (!lastCustomerMessageTime) {
      return {
        isExpired: true,
        isWithin24Hours: false,
        hoursRemaining: 0,
        hoursSinceLast: null,
        hasReceivedMessage: false,
      };
    }
    const WINDOW_24H_MS = 24 * 60 * 60 * 1000;
    const elapsed = Date.now() - lastCustomerMessageTime;
    if (elapsed > WINDOW_24H_MS) {
      const hoursAgo = Math.floor(elapsed / (1000 * 60 * 60));
      return {
        isExpired: true,
        isWithin24Hours: false,
        hoursRemaining: 0,
        hoursSinceLast: hoursAgo,
        hasReceivedMessage: true,
      };
    }
    const remainingMs = WINDOW_24H_MS - elapsed;
    const hoursRemaining = Math.max(1, Math.ceil(remainingMs / (1000 * 60 * 60)));
    return {
      isExpired: false,
      isWithin24Hours: true,
      hoursRemaining,
      hoursSinceLast: null,
      hasReceivedMessage: true,
    };
  }, [activeChannelType, lastCustomerMessageTime]);

  const isWindowExpired = window24hStatus.isExpired;

  // -------------------------------------------------------------
  // WHATSAPP META TEMPLATES
  // -------------------------------------------------------------
  const [metaTemplates, setMetaTemplates] = useState<MetaTemplate[]>([]);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<MetaTemplate | null>(null);
  const [templateSearch, setTemplateSearch] = useState('');
  const [templateVariables, setTemplateVariables] = useState<Record<string, string>>({});
  const [isSendingTemplate, setIsSendingTemplate] = useState(false);

  const fetchMetaTemplates = useCallback(async (phoneId?: string | null) => {
    try {
      setIsLoadingTemplates(true);
      const url = phoneId
        ? `/api/channels/whatsapp/meta-details?phoneNumberId=${encodeURIComponent(phoneId)}`
        : '/api/channels/whatsapp/meta-details';
      const res = await apiClient.get(url);
      if (res.data?.success && Array.isArray(res.data.templates)) {
        const approved = res.data.templates.filter(
          (t: MetaTemplate) => !t.status || t.status.toUpperCase() === 'APPROVED'
        );
        setMetaTemplates(approved);
      }
    } catch (err) {
      clientLogger.warn('InboxView.fetchMetaTemplates', 'Could not load WhatsApp templates', err);
    } finally {
      setIsLoadingTemplates(false);
    }
  }, []);

  useEffect(() => {
    if (activeChannelType === 'whatsapp' && (composerMode === 'template' || isWindowExpired)) {
      if (metaTemplates.length === 0 && !isLoadingTemplates) {
        fetchMetaTemplates(conversationSendChannel?.metaPhoneNumberId);
      }
    }
  }, [
    activeChannelType,
    composerMode,
    isWindowExpired,
    metaTemplates.length,
    isLoadingTemplates,
    fetchMetaTemplates,
    conversationSendChannel?.metaPhoneNumberId,
  ]);

  useEffect(() => {
    setSelectedTemplate(null);
    setTemplateVariables({});
    setTemplateSearch('');
  }, [activeConv?.id]);

  const handleSelectTemplate = (tpl: MetaTemplate) => {
    setSelectedTemplate(tpl);
    const bodyComp = tpl.components?.find((c) => c.type.toUpperCase() === 'BODY');
    const matches = Array.from(new Set(bodyComp?.text?.match(/\{\{(\d+)\}\}/g) || []));
    const initVars: Record<string, string> = {};
    for (const m of matches) {
      const num = m.replace(/[{}]/g, '');
      if (num === '1' && activeConv?.customer.name) {
        initVars[num] = activeConv.customer.name;
      } else {
        initVars[num] = '';
      }
    }
    setTemplateVariables(initVars);
  };

  const handleSendTemplate = async () => {
    if (!selectedTemplate || !activeConv) return;
    const customerPhone = activeConv.customer.phone;
    if (!customerPhone) {
      gooeyToast.error(`Customer "${activeConv.customer.name}" does not have a phone number.`);
      return;
    }
    const targetChannel = conversationSendChannel;
    if (!targetChannel) {
      gooeyToast.error('No connected WhatsApp channel found. Please connect your WhatsApp account first.');
      return;
    }

    const bodyComp = selectedTemplate.components?.find((c) => c.type.toUpperCase() === 'BODY');
    const varMatches = Array.from(new Set(bodyComp?.text?.match(/\{\{(\d+)\}\}/g) || []));

    for (const match of varMatches) {
      const num = match.replace(/[{}]/g, '');
      if (!templateVariables[num]?.trim()) {
        gooeyToast.error(`Please provide a value for variable {{${num}}}`);
        return;
      }
    }

    const components: Array<Record<string, unknown>> = [];
    if (varMatches.length > 0) {
      const sorted = [...varMatches].sort((a, b) => {
        const numA = parseInt(a.replace(/\D/g, ''), 10);
        const numB = parseInt(b.replace(/\D/g, ''), 10);
        return numA - numB;
      });
      components.push({
        type: 'body',
        parameters: sorted.map((m) => {
          const num = m.replace(/[{}]/g, '');
          return { type: 'text', text: templateVariables[num].trim() };
        }),
      });
    }

    let renderedText = bodyComp?.text || `[Template: ${selectedTemplate.name}]`;
    for (const [k, v] of Object.entries(templateVariables)) {
      renderedText = renderedText.replaceAll(`{{${k}}}`, v.trim());
    }

    setIsSendingTemplate(true);
    const convId = convKeyFor(activeConv.customer.id);
    const tempId = `msg-${Date.now()}`;

    const optimisticMsg: Message = {
      id: tempId,
      sender: 'agent',
      senderId: dbUser?.id ?? null,
      senderName: dbUser?.name ?? null,
      channel: 'whatsapp',
      text: renderedText,
      timestamp: formatTime(),
      createdAt: new Date().toISOString(),
      status: MessageStatus.SENT,
      type: 'template',
      mediaType: 'template',
    };

    setMessagesMap((prev) => ({ ...prev, [convId]: [...(prev[convId] || []), optimisticMsg] }));

    try {
      const res = await apiClient.post('/api/channels/whatsapp/send', {
        to: customerPhone,
        channelId: targetChannel.id,
        customerId: activeConv.customer.id,
        type: 'template',
        templateName: selectedTemplate.name,
        languageCode: selectedTemplate.language || 'en_US',
        components: components.length > 0 ? components : undefined,
        text: renderedText,
      });

      if (res.data?.success) {
        if (res.data?.persisted === false) {
          notifyWarning('Template delivered, but not saved', res.data?.warning);
        } else {
          gooeyToast.success(`Template "${selectedTemplate.name}" sent successfully!`);
        }
        setSelectedTemplate(null);
        setTemplateVariables({});
        setComposerMode('reply');
        fetchMessagesForCustomer(activeConv.customer.id, activeChannelType);
        refreshConversationsSoon();
      }
    } catch (err) {
      const apiError = notifyError(err, { where: 'InboxView.handleSendTemplate', title: 'Template not sent' });
      setMessagesMap((prev) => ({
        ...prev,
        [convId]: (prev[convId] || []).map((m) =>
          m.id === tempId ? { ...m, status: MessageStatus.FAILED, errorMessage: apiError.message } : m
        ),
      }));
    } finally {
      setIsSendingTemplate(false);
    }
  };

  const lastAiAction = useMemo(() => {
    for (let i = activeMessages.length - 1; i >= 0; i--) {
      if (activeMessages[i].sender === 'bot' && activeMessages[i].aiAction) return activeMessages[i].aiAction;
    }
    return activeConv?.lastMessage?.metadata?.aiAction ?? null;
  }, [activeMessages, activeConv]);

  // -------------------------------------------------------------
  // CONVERSATION ACTIONS (AI mode, take over, resolve)
  // -------------------------------------------------------------
  const updateConversation = async (
    conv: InboxConversation,
    body: Record<string, unknown>,
    optimistic: Partial<InboxConversation>,
    successMessage?: string
  ) => {
    setConversations((prev) => prev.map((c) => (c.id === conv.id ? { ...c, ...optimistic } : c)));
    try {
      await apiClient.patch(`/api/conversations/${conv.id}`, body);
      if (successMessage) gooeyToast.success(successMessage);
    } catch (err) {
      notifyError(err, { where: 'InboxView.updateConversation', title: 'Conversation not updated' });
    } finally {
      refreshConversationsSoon();
    }
  };

  const handleTakeOver = () => {
    if (!activeConv) return;
    updateConversation(
      activeConv,
      { takeOver: true },
      { handledBy: 'human', needsHuman: false, assigneeId: dbUser?.id ?? activeConv.assigneeId, assigneeName: dbUser?.name ?? null },
      'You took over this conversation'
    );
  };

  const handleSetHandler = (handledBy: 'ai' | 'human') => {
    setShowModeMenu(false);
    if (!activeConv || activeConv.handledBy === handledBy) return;
    updateConversation(
      activeConv,
      { handledBy },
      { handledBy, ...(handledBy === 'ai' ? { needsHuman: false } : {}) },
      handledBy === 'ai' ? 'Handed back to the AI agent' : 'AI agent paused'
    );
  };

  const handleSetStatus = (status: 'RESOLVED' | 'OPEN') => {
    if (!activeConv) return;
    updateConversation(
      activeConv,
      { status },
      { status, resolvedAt: status === 'RESOLVED' ? new Date().toISOString() : null },
      status === 'RESOLVED' ? 'Conversation resolved' : 'Conversation reopened'
    );
  };

  // -------------------------------------------------------------
  // REACTIONS
  // -------------------------------------------------------------
  const handleToggleReaction = async (msgId: string, emojiToSet: string) => {
    if (!activeConv) return;
    const numMsgId = Number(msgId);
    if (isNaN(numMsgId)) return;

    const convId = convKeyFor(activeConv.customer.id);
    const targetMsg = (messagesMap[convId] || []).find((m) => m.id === msgId);
    const currentUserId = dbUser?.id;
    const isMine = (r: { userId?: number | null; customerId?: number | null }) =>
      currentUserId ? r.userId === currentUserId : Boolean(r.userId && !r.customerId);
    const existingAgentReaction = targetMsg?.reactions?.find(isMine);
    const isRemoving = existingAgentReaction && existingAgentReaction.emoji === emojiToSet;
    const finalEmoji = isRemoving ? '' : emojiToSet;

    // Optimistically update local state
    setMessagesMap((prev) => ({
      ...prev,
      [convId]: (prev[convId] || []).map((m) => {
        if (m.id !== msgId) return m;
        let newReactions = [...(m.reactions || [])];
        if (isRemoving) {
          newReactions = newReactions.filter((r) => !isMine(r));
        } else {
          const existingIdx = newReactions.findIndex(isMine);
          if (existingIdx >= 0) {
            newReactions[existingIdx] = { ...newReactions[existingIdx], emoji: emojiToSet };
          } else {
            newReactions.push({ id: Date.now(), emoji: emojiToSet, userId: currentUserId ?? null });
          }
        }
        return { ...m, reactions: newReactions };
      }),
    }));

    try {
      const res = await apiClient.post('/api/messages/reactions', {
        messageId: numMsgId,
        emoji: finalEmoji,
        customerId: activeConv.customer.id,
        to: activeConv.customer.phone,
        channelId: conversationSendChannel?.id,
      });
      if (res.data?.metaDelivered === false) {
        notifyWarning('Reaction saved, but not delivered to WhatsApp', res.data?.metaError?.message);
      }
    } catch (err) {
      notifyError(err, { where: 'InboxView.handleToggleReaction', title: 'Reaction not saved' });
      fetchMessagesForCustomer(activeConv.customer.id, activeChannelType);
    }
  };

  // -------------------------------------------------------------
  // COMPOSER: attachments, reply, note
  // -------------------------------------------------------------
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      if (activeChannelType === 'whatsapp' && isWindowExpired) {
        gooeyToast.error('24-hour messaging window has expired. Attachments cannot be sent outside the window. Please send an approved template instead.');
        e.target.value = '';
        return;
      }
      const file = e.target.files[0];
      const check = validateWhatsAppMedia(file);
      if (!check.ok) {
        gooeyToast.error(check.code === 'FILE_TOO_LARGE' ? 'File too large' : 'File type not supported', {
          description: check.message,
        });
        clientLogger.warn('InboxView.handleFileChange', 'Attachment rejected before upload', {
          code: check.code,
          name: file.name,
          type: file.type,
          size: file.size,
        });
        e.target.value = '';
        return;
      }
      setSelectedFile(file);
      setFilePreviewUrl(file.type.startsWith('image/') ? URL.createObjectURL(file) : null);
    }
  };

  const handleClearSelectedFile = () => {
    setSelectedFile(null);
    if (filePreviewUrl) {
      URL.revokeObjectURL(filePreviewUrl);
      setFilePreviewUrl(null);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const resetComposerInput = () => {
    setInputMessage('');
    if (textareaRef.current) textareaRef.current.style.height = '';
  };

  const handleSend = async () => {
    if ((!inputMessage.trim() && !selectedFile) || !activeConv) return;

    if (activeChannelType === 'whatsapp' && isWindowExpired) {
      gooeyToast.error('24-hour messaging window has expired. You can only send pre-approved template messages.');
      setComposerMode('template');
      return;
    }

    if (!canSendOnChannel) {
      if (isChannelDisconnected) {
        gooeyToast.error("This WhatsApp number is disconnected. Reconnect it in Settings to send messages.");
        return;
      }
      gooeyToast.error(`Replying on ${CHANNEL_LABELS[activeChannelType] || activeChannelType} isn't available yet.`);
      return;
    }

    const messageText = inputMessage.trim();
    const customerPhone = activeConv.customer.phone;
    if (!customerPhone) {
      gooeyToast.error(`Customer "${activeConv.customer.name}" does not have a phone number. Please add a phone number first.`);
      return;
    }

    const targetChannel = conversationSendChannel;
    if (!targetChannel) {
      gooeyToast.error('No connected WhatsApp channel found. Please connect your WhatsApp account first.');
      return;
    }

    clientLogger.debug('InboxView.handleSend', 'Sending WhatsApp message', {
      channelId: targetChannel.id,
      customerId: activeConv.customer.id,
      length: messageText.length,
      ...(selectedFile ? { file: { name: selectedFile.name, type: selectedFile.type, size: selectedFile.size } } : {}),
    });

    setIsSending(true);
    const convId = convKeyFor(activeConv.customer.id);
    const tempId = `msg-${Date.now()}`;
    const attachedFile = selectedFile;
    const resolvedType = attachedFile
      ? attachedFile.type.startsWith('image/')
        ? 'image'
        : attachedFile.type.startsWith('video/')
          ? 'video'
          : attachedFile.type.startsWith('audio/')
            ? 'audio'
            : 'document'
      : 'text';

    const optimisticMsg: Message = {
      id: tempId,
      sender: 'agent',
      senderId: dbUser?.id ?? null,
      senderName: dbUser?.name ?? null,
      channel: 'whatsapp',
      text: messageText,
      timestamp: formatTime(),
      createdAt: new Date().toISOString(),
      status: MessageStatus.SENT,
      type: resolvedType,
      mediaType: resolvedType,
      mediaUrl: filePreviewUrl || undefined,
    };

    setMessagesMap((prev) => ({ ...prev, [convId]: [...(prev[convId] || []), optimisticMsg] }));
    resetComposerInput();
    setSelectedFile(null);
    setFilePreviewUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = '';

    try {
      let res;
      if (attachedFile) {
        const formData = new FormData();
        formData.append('to', customerPhone);
        if (messageText) formData.append('text', messageText);
        formData.append('channelId', String(targetChannel.id));
        formData.append('customerId', String(activeConv.customer.id));
        formData.append('file', attachedFile);
        res = await apiClient.post('/api/channels/whatsapp/send', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
      } else {
        res = await apiClient.post('/api/channels/whatsapp/send', {
          to: customerPhone,
          text: messageText,
          channelId: targetChannel.id,
          customerId: activeConv.customer.id,
        });
      }

      if (res.data?.success) {
        if (res.data?.persisted === false) {
          notifyWarning('Message delivered, but not saved', res.data?.warning);
        }
        fetchMessagesForCustomer(activeConv.customer.id, activeChannelType);
        refreshConversationsSoon();
      }
    } catch (err) {
      const apiError = notifyError(err, { where: 'InboxView.handleSend', title: 'Message not sent' });
      const metaCode = typeof apiError.details?.metaCode === 'number' ? apiError.details.metaCode : null;
      // Keep the bubble and mark it failed with the reason, so the agent sees what happened
      setMessagesMap((prev) => ({
        ...prev,
        [convId]: (prev[convId] || []).map((m) =>
          m.id === tempId ? { ...m, status: MessageStatus.FAILED, errorCode: metaCode, errorMessage: apiError.message } : m
        ),
      }));
    } finally {
      setIsSending(false);
    }
  };

  const handleAddNote = async () => {
    const text = inputMessage.trim();
    if (!text || !activeConv) return;

    const convId = convKeyFor(activeConv.customer.id);
    const tempId = `msg-${Date.now()}`;
    upsertMessage(convId, {
      id: tempId,
      sender: 'agent',
      senderId: dbUser?.id ?? null,
      senderName: dbUser?.name ?? null,
      channel: activeChannelType as Message['channel'],
      text,
      timestamp: formatTime(),
      createdAt: new Date().toISOString(),
      status: MessageStatus.READ,
      isInternalNote: true,
    });
    resetComposerInput();
    setIsSending(true);

    try {
      const res = await apiClient.post('/api/messages', {
        customerId: activeConv.customer.id,
        textContent: text,
        isInternalNote: true,
      });
      if (res.data?.message) upsertMessage(convId, mapApiMessage(res.data.message, activeChannelType), tempId);
    } catch (err) {
      notifyError(err, { where: 'InboxView.handleAddNote', title: 'Note not saved' });
      setMessagesMap((prev) => ({ ...prev, [convId]: (prev[convId] || []).filter((m) => m.id !== tempId) }));
      setInputMessage(text);
    } finally {
      setIsSending(false);
    }
  };

  // -------------------------------------------------------------
  // SHOPIFY PRODUCTS
  // -------------------------------------------------------------
  const shopifyStore = useShopifyStore();

  const shareDisabledReason = !activeConv
    ? null
    : isChannelDisconnected
      ? 'This WhatsApp number is disconnected. Messaging is paused.'
      : !canSendOnChannel
        ? `Sending on ${CHANNEL_LABELS[activeChannelType] || activeChannelType} isn't available yet. Use "Insert as text" instead.`
        : activeChannelType === 'whatsapp' && isWindowExpired
          ? '24-hour customer window is closed. Share products using approved templates or wait for a customer reply.'
          : !activeConv.customer.phone
            ? `${activeConv.customer.name} has no phone number.`
            : !conversationSendChannel
              ? 'No connected WhatsApp channel found.'
              : null;

  /** Sends the selected variant through the regular WhatsApp send path (the server re-checks it with Shopify) */
  const handleShareProduct = async ({ product, variant, caption }: ShareProductArgs): Promise<boolean> => {
    if (!activeConv || shareDisabledReason) return false;
    try {
      const res = await apiClient.post('/api/integrations/shopify/share', {
        customerId: activeConv.customer.id,
        channelId: conversationSendChannel?.id,
        productId: product.legacyId,
        variantId: variant.legacyId,
        caption,
      });
      if (res.data?.persisted === false) {
        notifyWarning('Product delivered, but not saved', res.data?.warning);
      } else {
        gooeyToast.success(`${product.title} shared`);
      }
      setShowProductPicker(false);
      fetchMessagesForCustomer(activeConv.customer.id, activeChannelType);
      refreshConversationsSoon();
      return true;
    } catch (err) {
      notifyError(err, { where: 'InboxView.handleShareProduct', title: 'Product not shared' });
      return false;
    }
  };

  const handleInsertProductText = (text: string) => {
    setInputMessage(text);
    setComposerMode('reply');
    setShowProductPicker(false);
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  // -------------------------------------------------------------
  // WHATSAPP TEMPLATES
  // -------------------------------------------------------------
  const templateDisabledReason = !activeConv
    ? null
    : activeChannelType !== 'whatsapp'
      ? 'Message templates can only be sent on WhatsApp.'
      : isChannelDisconnected
        ? 'This WhatsApp number is disconnected. Reconnect it in Settings to send templates.'
        : !activeConv.customer.phone
          ? `${activeConv.customer.name} has no phone number.`
          : !conversationSendChannel
            ? 'No connected WhatsApp channel found.'
            : null;

  const templateReady = Boolean(
    templateDraft && Object.keys(getTemplateValueErrors(templateDraft.template, templateDraft.values)).length === 0
  );

  /** Sends the chosen approved template; works outside the 24-hour window, unlike a normal reply */
  const handleSendTemplate24Hours = async () => {
    if (!activeConv || !templateDraft) return;
    if (templateDisabledReason) {
      gooeyToast.error(templateDisabledReason);
      return;
    }
    if (!templateReady) {
      gooeyToast.error('Fill in every template variable before sending.');
      return;
    }

    const { template, values } = templateDraft;
    const targetChannel = conversationSendChannel!;
    const convId = convKeyFor(activeConv.customer.id);
    const tempId = `msg-${Date.now()}`;
    const text = renderTemplateMessage(template, values);

    clientLogger.debug('InboxView.handleSendTemplate', 'Sending WhatsApp template', {
      channelId: targetChannel.id,
      customerId: activeConv.customer.id,
      template: template.name,
      language: template.language,
    });

    // Until the stored message arrives, show the header from the approved sample
    const mediaField = getTemplateSendFields(template).find((f) => f.kind === 'header_media');
    const headerPreview = mediaField?.example;

    upsertMessage(convId, {
      id: tempId,
      sender: 'agent',
      senderId: dbUser?.id ?? null,
      senderName: dbUser?.name ?? null,
      channel: 'whatsapp',
      text,
      timestamp: formatTime(),
      createdAt: new Date().toISOString(),
      status: MessageStatus.SENT,
      type: 'template',
      mediaType: mediaField?.mediaFormat?.toLowerCase() ?? 'template',
      mediaUrl: headerPreview,
    });
    setIsSending(true);

    try {
      let sendValues = values;
      if (mediaField && !values.header_media) {
        // Meta's sample link can't be sent as-is; the server re-uploads it and returns a media id
        const media = await apiClient.post('/api/channels/whatsapp/templates/header-media', {
          channelId: targetChannel.id,
          templateId: template.id,
        });
        sendValues = { ...values, header_media: media.data.data.mediaId };
        // Keep the id so a retry doesn't upload the sample again
        setTemplateDraft((d) => (d && d.template === template ? { ...d, values: sendValues } : d));
      }

      const res = await apiClient.post('/api/channels/whatsapp/send', {
        to: activeConv.customer.phone,
        channelId: targetChannel.id,
        customerId: activeConv.customer.id,
        type: 'template',
        templateName: template.name,
        languageCode: template.language,
        components: buildTemplateSendComponents(template, sendValues),
        // Stored as the message text so the thread shows what the customer received
        text,
      });
      if (res.data?.persisted === false) {
        notifyWarning('Template delivered, but not saved', res.data?.warning);
      }
      setTemplateDraft(null);
      setComposerMode('reply');
      fetchMessagesForCustomer(activeConv.customer.id, activeChannelType);
      refreshConversationsSoon();
    } catch (err) {
      // The draft stays filled so the agent can fix it and resend
      const apiError = notifyError(err, { where: 'InboxView.handleSendTemplate', title: 'Template not sent' });
      const metaCode = typeof apiError.details?.metaCode === 'number' ? apiError.details.metaCode : null;
      setMessagesMap((prev) => ({
        ...prev,
        [convId]: (prev[convId] || []).map((m) =>
          m.id === tempId ? { ...m, status: MessageStatus.FAILED, errorCode: metaCode, errorMessage: apiError.message } : m
        ),
      }));
    } finally {
      setIsSending(false);
    }
  };

  const handleSubmitComposer = () => {
    if (composerMode === 'note') handleAddNote();
    else if (composerMode === 'template') handleSendTemplate();
    else handleSend();
  };

  const applySuggestion = (text: string) => {
    setInputMessage(text);
    setComposerMode('reply');
    setShowCopilot(false);
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  // -------------------------------------------------------------
  // NEW CONTACT
  // -------------------------------------------------------------
  const [newContactName, setNewContactName] = useState('');
  const [newContactPhone, setNewContactPhone] = useState('');
  const [newContactChannelId, setNewContactChannelId] = useState<number | null>(null);
  const [isCreatingContact, setIsCreatingContact] = useState(false);

  const openNewContactModal = (prefill = '') => {
    let initialChannelId = whatsappChannels[0]?.id ?? null;
    if (channelFilter.kind === 'channel' && whatsappChannels.some((c) => c.id === channelFilter.id)) {
      initialChannelId = channelFilter.id;
    }
    setNewContactChannelId(initialChannelId);
    const digits = prefill.replace(/\D/g, '');
    if (digits.length >= 6) {
      setNewContactPhone(digits);
      setNewContactName('');
    } else {
      setNewContactName(prefill);
      setNewContactPhone('');
    }
    setShowNewContactModal(true);
  };

  const handleCreateContact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (whatsappChannels.length === 0) {
      gooeyToast.error('No WhatsApp channel available. Please connect a channel first.');
      return;
    }
    const cleanPhone = newContactPhone.replace(/\D/g, '');
    if (!newContactName.trim() || !cleanPhone) {
      gooeyToast.error('Please enter a name and a valid phone number (digits only, e.g. 919876543210)');
      return;
    }
    const targetChannelId = newContactChannelId || whatsappChannels[0]?.id;

    try {
      setIsCreatingContact(true);
      const res = await apiClient.post('/api/customer', {
        name: newContactName.trim(),
        phone: cleanPhone,
        channelId: targetChannelId,
      });
      if (res.data?.success && res.data?.customer) {
        const channelName = whatsappChannels.find((c) => c.id === targetChannelId)?.verified_name || 'WhatsApp';
        gooeyToast.success(`Customer ${newContactName.trim()} created under ${channelName}!`);
        setShowNewContactModal(false);
        setNewContactName('');
        setNewContactPhone('');
        // A conversation is created with the first message; show the contact right away
        await fetchConversations();
        const id = convKeyFor(res.data.customer.id);
        setInternalSelectedId(id);
        onSelectConversation?.(id);
        setChannelFilter({ kind: 'all' });
        setListTab('all');
      }
    } catch (err) {
      notifyError(err, { where: 'InboxView.handleCreateContact', title: 'Customer not created' });
    } finally {
      setIsCreatingContact(false);
    }
  };

  const handleConnectChannel = (type: string) => {
    if (!type || type === 'whatsapp') {
      setShowAddChannelModal(true);
      return;
    }
    gooeyToast.info(`${CHANNEL_LABELS[type] || type} is coming soon`, {
      description: 'Only WhatsApp Business can be connected right now.',
    });
  };

  // -------------------------------------------------------------
  // RENDER HELPERS
  // -------------------------------------------------------------
  // WhatsApp media is fetched with the Authorization header and shown from a blob URL
  const renderMedia = (msg: Message, senderName: string) => {
    if (!msg.mediaUrl) return null;
    const fullTimestamp = msg.createdAt
      ? `${new Date(msg.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}, ${formatTime(msg.createdAt)}`
      : msg.timestamp;

    return (
      <WhatsAppMediaAttachment
        mediaUrl={msg.mediaUrl}
        mediaType={msg.mediaType}
        msgType={msg.type}
        msgText={msg.text}
        senderName={senderName}
        fullTimestamp={fullTimestamp}
        onPreview={setPreviewMedia}
      />
    );
  };

  const renderReactions = (msg: Message, alignRight: boolean) => {
    const rxMap = new Map<string, { count: number; hasMyReaction: boolean }>();
    for (const rx of msg.reactions || []) {
      if (!rx.emoji) continue;
      const cur = rxMap.get(rx.emoji) || { count: 0, hasMyReaction: false };
      cur.count += 1;
      if (rx.userId === dbUser?.id || (rx.userId && !rx.customerId)) cur.hasMyReaction = true;
      rxMap.set(rx.emoji, cur);
    }
    const canReact = !msg.isInternalNote && !isNaN(Number(msg.id)) && canSendOnChannel;
    if (rxMap.size === 0 && !canReact) return null;

    return (
      <div className={`flex items-center gap-1 mt-1 relative flex-wrap ${alignRight ? 'justify-end' : 'justify-start'}`}>
        {Array.from(rxMap.entries()).map(([emoji, g]) => (
          <button
            key={emoji}
            type="button"
            onClick={() => handleToggleReaction(msg.id, emoji)}
            title={g.hasMyReaction ? 'Click to remove your reaction' : 'Click to react'}
            className={`px-2 py-0.5 rounded-full border text-xs flex items-center gap-1 cursor-pointer ${g.hasMyReaction ? 'bg-[#eef0fb] border-[#c7cdf0] text-[#3440a8] font-semibold' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
          >
            <span>{emoji}</span>
            {g.count > 1 && <span className="text-[10px] text-slate-500 font-semibold">{g.count}</span>}
          </button>
        ))}

        {canReact && (
          <div className="relative">
            <button
              type="button"
              title="React"
              onClick={(e) => {
                if (reactionPickerMsgId === msg.id) {
                  setReactionPickerMsgId(null);
                  setShowFullReactionPicker(false);
                } else {
                  const rect = e.currentTarget.getBoundingClientRect();
                  setReactionPickerPlacement(rect.top < 340 ? 'bottom' : 'top');
                  setReactionPickerMsgId(msg.id);
                  setShowFullReactionPicker(false);
                }
              }}
              className={`w-6 h-6 rounded-full border border-slate-200 bg-white text-slate-400 hover:text-slate-700 flex items-center justify-center cursor-pointer transition-opacity ${reactionPickerMsgId === msg.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                }`}
            >
              <Smile className="w-3.5 h-3.5" />
            </button>

            {reactionPickerMsgId === msg.id && (
              <div
                ref={reactionPickerRef}
                className={`absolute ${reactionPickerPlacement === 'bottom' ? 'top-full mt-1.5' : 'bottom-full mb-1.5'} ${alignRight ? 'right-0' : 'left-0'
                  } z-50`}
              >
                {showFullReactionPicker ? (
                  <div className="bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden">
                    <EmojiPicker
                      className="h-[280px] rounded-xl border-none shadow-none bg-white text-slate-800"
                      onEmojiSelect={({ emoji }) => {
                        const val = typeof emoji === 'string' ? emoji : (emoji as any)?.emoji || '';
                        if (val) handleToggleReaction(msg.id, val);
                        setReactionPickerMsgId(null);
                        setShowFullReactionPicker(false);
                      }}
                    >
                      <EmojiPickerSearch className="border-slate-100" />
                      <EmojiPickerContent />
                      <EmojiPickerFooter className="border-slate-100" />
                    </EmojiPicker>
                  </div>
                ) : (
                  <div className="p-1.5 bg-white border border-slate-200 rounded-full shadow-lg flex items-center gap-1">
                    {['👍', '❤️', '😂', '😮', '😢', '🙏', '🎉', '🔥'].map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => {
                          handleToggleReaction(msg.id, emoji);
                          setReactionPickerMsgId(null);
                        }}
                        className="w-7 h-7 rounded-full hover:bg-slate-100 flex items-center justify-center text-sm hover:scale-125 transition-transform cursor-pointer"
                      >
                        {emoji}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setShowFullReactionPicker(true)}
                      title="More emojis"
                      className="w-7 h-7 rounded-full hover:bg-[#eef0fb] hover:text-[#3440a8] text-slate-400 flex items-center justify-center cursor-pointer border border-dashed border-slate-200"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderMessage = (msg: Message, index: number) => {
    const isCustomer = msg.sender === 'customer';
    const isAi = msg.sender === 'bot';
    const isNote = Boolean(msg.isInternalNote);
    const prev = index > 0 ? activeMessages[index - 1] : undefined;
    const showDaySeparator = Boolean(prev && dayKey(prev.createdAt) !== dayKey(msg.createdAt));

    const agentName =
      msg.senderName || (msg.senderId != null && msg.senderId === dbUser?.id ? dbUser?.name : null) || 'Agent';
    const senderName = isCustomer ? activeConv?.customer.name || 'Customer' : isAi ? 'AI agent' : agentName;

    const label = isCustomer
      ? null
      : isNote
        ? `INTERNAL NOTE · ${agentName.toUpperCase()}`
        : isAi
          ? `AI AGENT${msg.aiAction ? ` · ${msg.aiAction.toUpperCase()}` : ''}`
          : `${agentName.toUpperCase()}${msg.type === 'template' ? ' · TEMPLATE' : ''}`;

    const bubbleClass = isCustomer
      ? 'bg-white border border-slate-200 text-slate-800'
      : isNote
        ? 'bg-amber-50 border border-amber-200 text-slate-800'
        : 'bg-[#eef0fb] text-slate-800';

    return (
      <React.Fragment key={msg.id}>
        {showDaySeparator && (
          <div className="flex items-center gap-3 py-1">
            <div className="flex-1 h-px bg-slate-100" />
            <span className="text-[11px] text-slate-400">{formatDayLabel(msg.createdAt)}</span>
            <div className="flex-1 h-px bg-slate-100" />
          </div>
        )}
        <div className={`group flex flex-col ${isCustomer ? 'items-start' : 'items-end'}`}>
          <div className={`max-w-[78%] rounded-xl px-3.5 py-2.5 text-[13px] leading-relaxed ${bubbleClass}`}>
            {label && (
              <p className={`text-[10px] font-semibold tracking-wider mb-1 ${isNote ? 'text-amber-700' : 'text-[#3440a8]'}`}>
                {label}
              </p>
            )}
            {renderMedia(msg, senderName)}
            {!isPlaceholderText(msg.text) && <p className="whitespace-pre-wrap break-words">{renderMessageWithLinks(msg.text)}</p>}
            <div className="mt-1 flex items-center justify-end gap-1 text-[10px] text-slate-400">
              <span>{msg.timestamp}</span>
              {!isCustomer && !isNote && renderMessageStatusIndicator(msg.status, msg.errorCode, msg.errorMessage)}
            </div>
          </div>
          {renderReactions(msg, !isCustomer)}
        </div>
      </React.Fragment>
    );
  };

  // Virtualized thread wiring
  const activeConvKey = activeConv ? convKeyFor(activeConv.customer.id) : null;
  const activePaging = activeConvKey ? threadPaging[activeConvKey] : undefined;
  const isLoadingOlder = activeConvKey !== null && loadingOlderConvId === activeConvKey;

  const handleLoadOlder = useCallback(() => {
    if (!activeConv) return;
    const oldest = activeMessages.find((m) => !isTempMessage(m));
    if (oldest) loadOlderMessages(activeConv.customer.id, Number(oldest.id), activeChannelType);
  }, [activeConv, activeMessages, activeChannelType, loadOlderMessages]);

  // The agent's own optimistic bubble always brings the thread back to the bottom
  const isOwnNewMessage = useCallback((m: Message) => m.sender === 'agent' && isTempMessage(m), []);

  // -------------------------------------------------------------
  // RENDER
  // -------------------------------------------------------------
  const threadLabel = CHANNEL_THREAD_LABELS[activeChannelType] || CHANNEL_LABELS[activeChannelType] || activeChannelType;
  const channelDetail = activeConv?.channel
    ? formatHandle(activeConv.channel.handle) || activeConv.channel.name || formatPhone(activeConv.channel.phoneNumber)
    : '';
  const headerSubtitle = [threadLabel, channelDetail, languageName(activeConv?.language)].filter(Boolean).join(' · ');
  const suggestions = activeConv?.aiSuggestions ?? [];
  const isAiHandling = activeConv?.handledBy === 'ai';
  const isResolved = activeConv?.status === 'RESOLVED' || activeConv?.status === 'CLOSED';

  const composerStatus = (() => {
    if (!activeConv) return null;
    if (composerMode === 'note') return { text: 'Notes are only visible to your team', className: 'text-amber-700' };
    if (composerMode === 'template') {
      return {
        text: selectedTemplate
          ? `Template: ${selectedTemplate.name} (${selectedTemplate.language})`
          : 'Select an approved WhatsApp template to send',
        className: 'text-[#3440a8] font-medium',
      };
    }
    if (isChannelDisconnected) {
      return { text: 'Messaging is paused · This WhatsApp number is disconnected', className: 'text-amber-700 font-medium' };
    }
    if (activeChannelType === 'whatsapp' && isWindowExpired) {
      return { text: '24h window closed · Switch to Template tab to send', className: 'text-amber-700 font-medium' };
    }
    if (!canSendOnChannel) {
      return { text: `Replying on ${CHANNEL_LABELS[activeChannelType] || activeChannelType} isn't available yet`, className: 'text-amber-700' };
    }
    if (activeConv.needsHuman) return { text: `AI agent needs a human · ${threadLabel}`, className: 'text-amber-700' };
    if (isAiHandling) return { text: `AI agent is replying · ${threadLabel}`, className: 'text-[#17803d]' };
    return { text: `Replying as ${dbUser?.name || 'you'} · ${threadLabel}`, className: 'text-slate-500' };
  })();

  return (
    <div className="flex h-full w-full bg-white overflow-hidden text-slate-800">
      {!isChannelsCollapsed && (
        <ChannelsPane
          channels={channels}
          conversations={conversations}
          isLoading={isLoadingChannels}
          filter={channelFilter}
          onFilterChange={(f) => {
            setChannelFilter(f);
            setListTab('all');
          }}
          onConnect={handleConnectChannel}
          onCollapse={() => setIsChannelsCollapsed(true)}
        />
      )}

      <div className="flex-1 flex flex-col min-w-0 h-full">
        <InboxTopBar
          scope={scope}
          conversations={conversations}
          onOpenConversation={(conv) => {
            setChannelFilter({ kind: 'all' });
            setListTab('all');
            if (conv.status === 'RESOLVED' || conv.status === 'CLOSED') setStatusFilter('all');
            handleSelectConversation(conv);
          }}
          onNewContact={openNewContactModal}
          primaryNumber={primaryNumber}
          isLive={isRealtimeConnected}
          isChannelsCollapsed={isChannelsCollapsed}
          onExpandChannels={() => setIsChannelsCollapsed(false)}
        />

        <div className="flex flex-1 min-h-0">
          <ConversationList
            conversations={visibleConversations}
            counts={tabCounts}
            tab={listTab}
            onTabChange={setListTab}
            search={listSearch}
            onSearchChange={setListSearch}
            statusFilter={statusFilter}
            onStatusFilterChange={setStatusFilter}
            unreadOnly={unreadOnly}
            onUnreadOnlyChange={setUnreadOnly}
            selectedCustomerId={selectedCustomerId}
            onSelect={handleSelectConversation}
            onNewContact={() => openNewContactModal()}
            isLoading={isLoadingConversations}
            error={conversationsError}
            onRetry={fetchConversations}
          />

          {/* ====================================================== */}
          {/* CHAT                                                   */}
          {/* ====================================================== */}
          <section className="flex-1 flex flex-col min-w-0 h-full bg-white">
            {activeConv ? (
              <>
                {/* Chat header */}
                <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-3 shrink-0">
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar name={activeConv.customer.name} src={activeConv.customer.avatarUrl} size="lg" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h2 className="font-semibold text-[15px] text-slate-900 truncate">{activeConv.customer.name}</h2>
                        {isChannelDisconnected && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-800 border border-amber-200">
                            Disconnected
                          </span>
                        )}
                        {activeChannelType === 'whatsapp' && (
                          window24hStatus.isWithin24Hours ? (
                            <span
                              title={`24-hour customer window is active (~${window24hStatus.hoursRemaining}h remaining). Free-form text allowed.`}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200"
                            >
                              <Clock className="w-3 h-3 text-emerald-600" />
                              24h window active · {window24hStatus.hoursRemaining}h left
                            </span>
                          ) : (
                            <span
                              title={window24hStatus.hasReceivedMessage ? `Customer last messaged ${window24hStatus.hoursSinceLast}h ago. Free-form text blocked.` : 'No incoming customer message. Free-form text blocked.'}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-50 text-amber-800 border border-amber-200"
                            >
                              <AlertTriangle className="w-3 h-3 text-amber-600" />
                              24h window closed · Templates only
                            </span>
                          )
                        )}
                      </div>
                      <p className="text-[11.5px] text-slate-500 truncate">{headerSubtitle}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <div className="relative" ref={modeMenuRef}>
                      <button
                        onClick={() => setShowModeMenu((v) => !v)}
                        className={`flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-[13px] font-medium cursor-pointer ${isAiHandling ? 'bg-[#eef0fb] text-[#3440a8]' : 'bg-slate-100 text-slate-700'
                          }`}
                      >
                        {isAiHandling ? <Sparkles className="w-4 h-4" /> : <User className="w-4 h-4" />}
                        {isAiHandling ? 'AI agent' : activeConv.assigneeName || 'Human'}
                        <ChevronDown className="w-3.5 h-3.5" />
                      </button>
                      {showModeMenu && (
                        <div className="absolute right-0 top-full mt-1.5 w-64 bg-white border border-slate-200 rounded-xl shadow-lg p-1.5 z-30 text-[13px]">
                          <button
                            onClick={() => handleSetHandler('ai')}
                            className="w-full flex items-start gap-2.5 px-2.5 py-2 rounded-lg hover:bg-slate-50 text-left cursor-pointer"
                          >
                            <Sparkles className="w-4 h-4 mt-0.5 text-[#3440a8]" />
                            <span className="flex-1">
                              <span className="block font-medium text-slate-900">AI agent</span>
                              <span className="block text-xs text-slate-500">Replies automatically, escalates when unsure</span>
                            </span>
                            {isAiHandling && <Check className="w-4 h-4 text-[#3440a8]" />}
                          </button>
                          <button
                            onClick={() => handleSetHandler('human')}
                            className="w-full flex items-start gap-2.5 px-2.5 py-2 rounded-lg hover:bg-slate-50 text-left cursor-pointer"
                          >
                            <User className="w-4 h-4 mt-0.5 text-slate-600" />
                            <span className="flex-1">
                              <span className="block font-medium text-slate-900">Human only</span>
                              <span className="block text-xs text-slate-500">Pause the AI agent for this conversation</span>
                            </span>
                            {!isAiHandling && <Check className="w-4 h-4 text-[#3440a8]" />}
                          </button>
                          <div className="my-1 border-t border-slate-100" />
                          <button
                            onClick={() => {
                              setShowModeMenu(false);
                              handleSetStatus(isResolved ? 'OPEN' : 'RESOLVED');
                            }}
                            className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-slate-50 text-left cursor-pointer text-slate-700"
                          >
                            {isResolved ? <RotateCcw className="w-4 h-4" /> : <CircleCheck className="w-4 h-4" />}
                            {isResolved ? 'Reopen conversation' : 'Mark as resolved'}
                          </button>
                        </div>
                      )}
                    </div>

                    {isAiHandling || activeConv.needsHuman || activeConv.assigneeId !== dbUser?.id ? (
                      <button
                        onClick={handleTakeOver}
                        className="px-3 py-2 rounded-lg border border-slate-300 bg-white text-[13px] font-medium text-slate-900 hover:bg-slate-50 cursor-pointer whitespace-nowrap"
                      >
                        Take over
                      </button>
                    ) : (
                      <button
                        onClick={() => handleSetStatus(isResolved ? 'OPEN' : 'RESOLVED')}
                        className="px-3 py-2 rounded-lg border border-slate-300 bg-white text-[13px] font-medium text-slate-900 hover:bg-slate-50 cursor-pointer whitespace-nowrap"
                      >
                        {isResolved ? 'Reopen' : 'Resolve'}
                      </button>
                    )}
                  </div>
                </div>

                {isChannelDisconnected && (
                  <div className="px-4 py-2.5 bg-amber-50 border-b border-amber-200 flex items-center justify-between text-xs text-amber-900 shrink-0">
                    <div className="flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                      <span>This WhatsApp number is disconnected. All past message logs and customer details are preserved, but messaging from this number is paused.</span>
                    </div>
                    <a
                      href="/settings"
                      className="ml-3 px-2.5 py-1 rounded-md bg-amber-600 hover:bg-amber-700 text-white font-medium text-xs shrink-0 cursor-pointer"
                    >
                      Manage in Settings
                    </a>
                  </div>
                )}

                {messagesLoadError?.convId === convKeyFor(activeConv.customer.id) && activeMessages.length > 0 && (
                  <div role="alert" className="px-4 py-2 bg-red-50 border-b border-red-100 text-[11px] text-red-700 flex items-center justify-between gap-2">
                    <span className="truncate">Couldn&apos;t refresh messages: {messagesLoadError.error.message}</span>
                    <button
                      type="button"
                      onClick={() => fetchMessagesForCustomer(activeConv.customer.id, activeChannelType)}
                      className="font-semibold underline cursor-pointer shrink-0"
                    >
                      Retry
                    </button>
                  </div>
                )}

                {/* Thread */}
                {messagesLoadError?.convId === convKeyFor(activeConv.customer.id) && activeMessages.length === 0 ? (
                  <div className="flex-1 flex items-center justify-center">
                    <ErrorState
                      error={messagesLoadError.error}
                      title="Couldn't load messages"
                      onRetry={() => fetchMessagesForCustomer(activeConv.customer.id, activeChannelType)}
                    />
                  </div>
                ) : activeMessages.length === 0 ? (
                  <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
                    {activeConv.aiSummary && (
                      <div className="rounded-xl border border-slate-200 px-4 py-3 bg-white">
                        <p className="text-[10px] font-semibold tracking-wider text-[#3440a8]">AI SUMMARY</p>
                        <p className="mt-1 text-[13px] text-slate-700 leading-relaxed">{activeConv.aiSummary}</p>
                      </div>
                    )}

                    {!activePaging?.loaded ? (
                      <div className="py-16 flex items-center justify-center gap-2 text-xs text-slate-400">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Loading messages…
                      </div>
                    ) : (
                      <div className="py-16 flex flex-col items-center text-center text-slate-400">
                        <div className="w-11 h-11 rounded-full bg-slate-100 flex items-center justify-center mb-3">
                          <MessageSquare className="w-5 h-5" />
                        </div>
                        <p className="font-semibold text-slate-700 text-[13px]">No messages yet</p>
                        <p className="text-xs mt-1">
                          Start a {threadLabel} conversation with <span className="font-medium text-slate-600">{activeConv.customer.name}</span>.
                        </p>
                      </div>
                    )}
                  </div>
                ) : (
                  <VirtualMessageList
                    key={activeConvKey}
                    items={activeMessages}
                    renderItem={renderMessage}
                    hasMore={Boolean(activePaging?.hasMore)}
                    isLoadingOlder={isLoadingOlder}
                    onLoadOlder={handleLoadOlder}
                    shouldScrollToNewItem={isOwnNewMessage}
                    header={
                      <div className="space-y-3 pb-3">
                        {isLoadingOlder ? (
                          <div className="flex items-center justify-center gap-2 py-1 text-[11px] text-slate-400">
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            Loading earlier messages…
                          </div>
                        ) : (
                          !activePaging?.hasMore && (
                            <p className="py-1 text-center text-[11px] text-slate-400">Start of conversation</p>
                          )
                        )}
                        {activeConv.aiSummary && (
                          <div className="rounded-xl border border-slate-200 px-4 py-3 bg-white">
                            <p className="text-[10px] font-semibold tracking-wider text-[#3440a8]">AI SUMMARY</p>
                            <p className="mt-1 text-[13px] text-slate-700 leading-relaxed">{activeConv.aiSummary}</p>
                          </div>
                        )}
                      </div>
                    }
                  />
                )}

                {/* Composer */}
                <div className="border-t border-slate-200 px-4 pb-3 shrink-0">
                  {/* WhatsApp 24h Window Warning Banner */}
                  {activeChannelType === 'whatsapp' && isWindowExpired && (
                    <div className="mt-3 mb-2 p-2.5 rounded-lg bg-amber-50/90 border border-amber-200/90 flex items-start justify-between gap-3 text-xs">
                      <div className="flex items-start gap-2 min-w-0">
                        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                        <div>
                          <p className="font-semibold text-amber-900">24-Hour Customer Window Expired</p>
                          <p className="text-amber-800 text-[11.5px] mt-0.5 leading-relaxed">
                            {window24hStatus.hasReceivedMessage
                              ? `Last customer message received ${window24hStatus.hoursSinceLast}h ago. `
                              : 'No message received from this contact yet. '}
                            WhatsApp Business policy requires sending an approved template to start or resume messaging. Regular text is disabled.
                          </p>
                        </div>
                      </div>
                      {composerMode !== 'template' && (
                        <button
                          type="button"
                          onClick={() => setComposerMode('template')}
                          className="px-2.5 py-1.5 rounded-md bg-amber-600 hover:bg-amber-700 text-white font-medium text-[11.5px] shrink-0 cursor-pointer shadow-sm transition-colors"
                        >
                          Send Template
                        </button>
                      )}
                    </div>
                  )}

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4 text-[13px]">
                      {(['reply', 'note', 'template'] as ComposerMode[]).map((mode) => (
                        <button
                          key={mode}
                          onClick={() => setComposerMode(mode)}
                          className={`py-2.5 border-b-2 capitalize cursor-pointer flex items-center gap-1.5 ${composerMode === mode
                            ? 'border-[#3440a8] text-[#3440a8] font-semibold'
                            : 'border-transparent text-slate-600 hover:text-slate-900'
                            }`}
                        >
                          <span>{mode}</span>
                          {mode === 'template' && activeChannelType === 'whatsapp' && isWindowExpired && (
                            <span className="px-1.5 py-0.2 rounded text-[10px] font-semibold bg-amber-100 text-amber-800 border border-amber-200">
                              Required
                            </span>
                          )}
                          {mode === 'reply' && activeChannelType === 'whatsapp' && isWindowExpired && (
                            <span className="px-1.5 py-0.2 rounded text-[10px] font-medium bg-slate-100 text-slate-500">
                              Locked
                            </span>
                          )}
                        </button>
                      ))}
                    </div>

                    <div className="relative" ref={copilotRef}>
                      <button
                        onClick={() => setShowCopilot((v) => !v)}
                        className="px-2.5 py-1 rounded-md bg-[#eef0fb] text-[#3440a8] text-xs font-medium cursor-pointer hover:bg-[#e3e6f8]"
                      >
                        Copilot · {suggestions.length} {suggestions.length === 1 ? 'idea' : 'ideas'}
                      </button>
                      {showCopilot && (
                        <div className="absolute right-0 bottom-full mb-2 w-80 bg-white border border-slate-200 rounded-xl shadow-xl p-2 z-30">
                          <p className="px-2 pt-1 pb-2 text-[11px] font-semibold text-slate-500 tracking-wider flex items-center gap-1.5">
                            <Sparkles className="w-3.5 h-3.5 text-[#3440a8]" />
                            COPILOT IDEAS
                          </p>
                          {suggestions.length === 0 ? (
                            <p className="px-2 pb-2 text-xs text-slate-500">
                              No reply ideas yet. They appear here once the AI agent has read this conversation.
                            </p>
                          ) : (
                            suggestions.map((idea, i) => (
                              <button
                                key={i}
                                onClick={() => applySuggestion(idea)}
                                className="w-full text-left px-2.5 py-2 rounded-lg hover:bg-slate-50 text-[13px] text-slate-700 cursor-pointer"
                              >
                                {idea}
                              </button>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {composerMode === 'template' ? (
                    <TemplateComposer
                      phoneNumberId={conversationSendChannel?.metaPhoneNumberId}
                      draft={templateDraft}
                      onDraftChange={setTemplateDraft}
                      disabledReason={templateDisabledReason}
                      revision={templateRevision}
                    />
                  ) : (
                    <>
                      {selectedFile && composerMode === 'reply' && (
                        <div className="mt-1 mb-1.5 p-2 rounded-lg bg-slate-50 border border-slate-200 flex items-center gap-2.5">
                          {filePreviewUrl ? (
                            <img src={filePreviewUrl} alt="Preview" className="w-9 h-9 rounded-md object-cover border border-slate-200" />
                          ) : (
                            <div className="w-9 h-9 rounded-md bg-[#eef0fb] text-[#3440a8] flex items-center justify-center">
                              {selectedFile.type.startsWith('video/') ? (
                                <Film className="w-4 h-4" />
                              ) : selectedFile.type.startsWith('audio/') ? (
                                <Music className="w-4 h-4" />
                              ) : (
                                <FileText className="w-4 h-4" />
                              )}
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-medium text-slate-800 truncate">{selectedFile.name}</p>
                            <p className="text-[10px] text-slate-500">
                              {selectedFile.size / 1024 > 1024
                                ? `${(selectedFile.size / (1024 * 1024)).toFixed(1)} MB`
                                : `${(selectedFile.size / 1024).toFixed(0)} KB`}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={handleClearSelectedFile}
                            title="Remove attachment"
                            className="p-1 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-200 cursor-pointer"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      )}

                      <div
                        className={`mt-1 flex items-end gap-2 rounded-lg border px-3 py-2 ${composerMode === 'note'
                          ? 'bg-amber-50/60 border-amber-200 focus-within:border-amber-400'
                          : 'border-slate-200 focus-within:border-[#3440a8] focus-within:ring-1 focus-within:ring-[#3440a8]'
                          }`}
                      >
                        <textarea
                          ref={textareaRef}
                          rows={1}
                          value={inputMessage}
                          onChange={(e) => {
                            setInputMessage(e.target.value);
                            e.target.style.height = 'auto';
                            e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Tab' && !e.shiftKey && composerMode === 'reply' && !inputMessage && suggestions[0]) {
                              e.preventDefault();
                              applySuggestion(suggestions[0]);
                            } else if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault();
                              handleSubmitComposer();
                            }
                          }}
                          placeholder={
                            composerMode === 'note'
                              ? 'Add an internal note — only your team sees this…'
                              : isChannelDisconnected
                                ? 'Messaging is paused because this number is disconnected. Reconnect in Settings to send messages.'
                                : activeChannelType === 'whatsapp' && isWindowExpired
                                  ? '24-hour window expired. Free-form text is disabled. Click the Template tab to send an approved template.'
                                  : selectedFile
                                    ? 'Add a caption (optional)…'
                                    : `Reply to ${activeConv.customer.name} on ${CHANNEL_LABELS[activeChannelType] || activeChannelType}…`
                          }
                          disabled={
                            (isChannelDisconnected && composerMode === 'reply') ||
                            (activeChannelType === 'whatsapp' && isWindowExpired && composerMode === 'reply')
                          }
                          className="flex-1 resize-none bg-transparent text-[13px] leading-5 text-slate-800 placeholder-slate-400 focus:outline-none py-0.5 disabled:opacity-60 disabled:cursor-not-allowed"
                        />
                        {composerMode === 'reply' && !inputMessage && suggestions[0] && (
                          <span className="text-[11px] text-slate-400 shrink-0 pb-0.5">Tab to accept</span>
                        )}
                      </div>
                    </>
                  )}

                  <input
                    ref={fileInputRef}
                    type="file"
                    onChange={handleFileChange}
                    className="hidden"
                    accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv"
                  />

                  <div className="mt-2.5 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-1 min-w-0">
                      <div className="relative" ref={emojiPickerRef}>
                        <button
                          type="button"
                          onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                          disabled={composerMode === 'template'}
                          title="Insert emoji"
                          className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <Smile className="w-[18px] h-[18px]" />
                        </button>
                        {showEmojiPicker && (
                          <div className="absolute bottom-full left-0 mb-2 z-50 bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden">
                            <EmojiPicker
                              className="h-[326px] rounded-xl border-none shadow-none bg-white text-slate-800"
                              onEmojiSelect={({ emoji }) => {
                                const val = typeof emoji === 'string' ? emoji : (emoji as any)?.emoji || '';
                                setInputMessage((prev) => prev + val);
                                setShowEmojiPicker(false);
                              }}
                            >
                              <EmojiPickerSearch className="border-slate-100" />
                              <EmojiPickerContent />
                              <EmojiPickerFooter className="border-slate-100" />
                            </EmojiPicker>
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={composerMode !== 'reply' || !canSendOnChannel || (activeChannelType === 'whatsapp' && isWindowExpired)}
                        title={
                          activeChannelType === 'whatsapp' && isWindowExpired
                            ? 'Attachments cannot be sent outside the 24-hour window'
                            : 'Attach file'
                        }
                        className={`p-1.5 rounded-lg cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${selectedFile ? 'text-[#3440a8] bg-[#eef0fb]' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100'
                          }`}
                      >
                        <Paperclip className="w-[18px] h-[18px]" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowProductPicker(true)}
                        disabled={composerMode !== 'reply' || !shopifyStore.isConnected || (activeChannelType === 'whatsapp' && isWindowExpired)}
                        title={
                          activeChannelType === 'whatsapp' && isWindowExpired
                            ? 'Products cannot be sent outside the 24-hour window'
                            : shopifyStore.isConnected ? 'Share a Shopify product' : 'Connect your Shopify store to share products'
                        }
                        className="p-1.5 rounded-lg cursor-pointer text-slate-500 hover:text-slate-800 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <ShoppingBag className="w-[18px] h-[18px]" />
                      </button>
                      {composerStatus && (
                        <span className={`ml-2 text-xs truncate ${composerStatus.className}`}>{composerStatus.text}</span>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={handleSubmitComposer}
                      disabled={
                        composerMode === 'template'
                          ? activeChannelType === 'whatsapp'
                            ? !selectedTemplate || isSendingTemplate
                            : true
                          : isSending ||
                          (activeChannelType === 'whatsapp' && isWindowExpired && composerMode === 'reply') ||
                          (composerMode === 'note' ? !inputMessage.trim() : (!inputMessage.trim() && !selectedFile) || !canSendOnChannel)
                      }
                      title={composerMode === 'template' && templateDraft && !templateReady ? 'Fill in every template variable first' : undefined}
                      className="flex items-center gap-1.5 px-5 py-2 rounded-lg bg-[#3440a8] hover:bg-[#2b3590] disabled:opacity-40 disabled:cursor-not-allowed text-white text-[13px] font-semibold cursor-pointer shrink-0"
                    >
                      {(isSending || isSendingTemplate) && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      {composerMode === 'note'
                        ? 'Add note'
                        : composerMode === 'template'
                          ? 'Send template'
                          : 'Send'}
                    </button >
                  </div >
                </div >
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
                <div className="w-14 h-14 rounded-2xl bg-[#eef0fb] text-[#3440a8] flex items-center justify-center mb-4">
                  <MessageSquare className="w-7 h-7 stroke-[1.8]" />
                </div>
                <h3 className="text-[15px] font-semibold text-slate-900 mb-1">No conversation selected</h3>
                <p className="text-xs text-slate-500 max-w-sm leading-relaxed">
                  Pick a conversation from the list to see the thread, AI agent activity and customer details.
                </p>
              </div>
            )}
          </section >

          <CustomerPanel
            conversation={activeConv}
            lastAiAction={lastAiAction}
            shopify={{ connected: shopifyStore.isConnected, needsReauth: shopifyStore.needsReauth }}
            onShareProduct={handleShareProduct}
            onInsertProductText={handleInsertProductText}
            shareDisabledReason={shareDisabledReason}
          />
        </div >
      </div >

      {/* ======================================================== */}
      {/* MODALS                                                   */}
      {/* ======================================================== */}
      <AddChannelModal
        isOpen={showAddChannelModal}
        onClose={() => setShowAddChannelModal(false)}
        onSuccess={() => {
          fetchChannels();
        }}
      />

      <Modal
        isOpen={showProductPicker && Boolean(activeConv)}
        onClose={() => setShowProductPicker(false)}
        title={`Share a product with ${activeConv?.customer.name ?? 'customer'}`}
        icon={<ShoppingBag className="w-4 h-4 text-[#3440a8]" />}
        maxWidth="md"
      >
        <ProductBrowser
          className="h-[min(560px,70vh)]"
          onShare={handleShareProduct}
          onInsertText={handleInsertProductText}
          shareDisabledReason={shareDisabledReason}
        />
      </Modal>

      <Modal
        isOpen={showNewContactModal}
        onClose={() => setShowNewContactModal(false)}
        title="New WhatsApp contact"
        icon={<User className="w-4 h-4 text-[#3440a8]" />}
        maxWidth="sm"
      >
        <form onSubmit={handleCreateContact} className="space-y-3 text-xs">
          <div>
            <label className="block font-semibold text-slate-700 mb-1">WhatsApp number</label>
            {whatsappChannels.length > 0 ? (
              <select
                value={newContactChannelId ?? whatsappChannels[0]?.id ?? ''}
                onChange={(e) => setNewContactChannelId(Number(e.target.value))}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 font-medium focus:outline-none focus:bg-white focus:ring-1 focus:ring-[#3440a8]"
              >
                {whatsappChannels.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.verified_name || 'WhatsApp'} {c.phoneNumber ? `(${formatPhone(c.phoneNumber)})` : ''}
                  </option>
                ))}
              </select>
            ) : (
              <div className="p-2.5 bg-amber-50 border border-amber-200 text-amber-800 rounded-lg text-[11px] flex items-center justify-between">
                <span>No WhatsApp channels connected yet.</span>
                <button
                  type="button"
                  onClick={() => {
                    setShowNewContactModal(false);
                    setShowAddChannelModal(true);
                  }}
                  className="font-bold underline text-amber-900 cursor-pointer ml-2"
                >
                  Connect channel
                </button>
              </div>
            )}
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">Customer name</label>
            <input
              type="text"
              required
              disabled={whatsappChannels.length === 0}
              value={newContactName}
              onChange={(e) => setNewContactName(e.target.value)}
              placeholder="e.g. Rachel Adams"
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#3440a8] disabled:bg-slate-100 disabled:cursor-not-allowed"
            />
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">Phone number</label>
            <input
              type="text"
              required
              disabled={whatsappChannels.length === 0}
              value={newContactPhone}
              onChange={(e) => setNewContactPhone(e.target.value)}
              placeholder="e.g. 919876543210"
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#3440a8] disabled:bg-slate-100 disabled:cursor-not-allowed"
            />
            <p className="text-[11px] text-slate-400 mt-1">Digits only, with country code and without +.</p>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setShowNewContactModal(false)}
              className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={whatsappChannels.length === 0 || isCreatingContact}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg text-white bg-[#3440a8] hover:bg-[#2b3590] disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed cursor-pointer"
            >
              {isCreatingContact ? 'Creating…' : 'Create contact'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Media Preview Modal */}
      {
        previewMedia && (
          <Modal
            isOpen={!!previewMedia}
            onClose={() => setPreviewMedia(null)}
            title={
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-bold text-slate-900 text-sm">{previewMedia.senderName || 'Attachment preview'}</span>
                {previewMedia.timestamp && (
                  <>
                    <span className="text-slate-300">•</span>
                    <span className="text-xs font-normal text-slate-500">{previewMedia.timestamp}</span>
                  </>
                )}
              </div>
            }
            icon={
              previewMedia.type === 'image' ? (
                <ImageIcon className="w-4 h-4 text-[#3440a8]" />
              ) : previewMedia.type === 'video' ? (
                <Film className="w-4 h-4 text-[#3440a8]" />
              ) : previewMedia.type === 'audio' ? (
                <Music className="w-4 h-4 text-[#3440a8]" />
              ) : (
                <FileText className="w-4 h-4 text-[#3440a8]" />
              )
            }
            maxWidth={previewMedia.type === 'image' || previewMedia.type === 'video' || previewMedia.type === 'document' ? '3xl' : 'md'}
          >
            <div className="space-y-4">
              {previewMedia.type === 'image' && (
                <div className="w-full max-h-[70vh] flex items-center justify-center bg-slate-950/5 rounded-xl overflow-hidden p-2 border border-slate-100">
                  <img
                    src={previewMedia.url}
                    alt={previewMedia.caption || 'Attachment preview'}
                    className="max-h-[65vh] w-auto max-w-full object-contain rounded-lg"
                  />
                </div>
              )}

              {previewMedia.type === 'video' && (
                <div className="w-full max-h-[70vh] flex items-center justify-center bg-black rounded-xl overflow-hidden">
                  <video src={previewMedia.url} controls autoPlay className="max-h-[65vh] w-full object-contain rounded-lg" />
                </div>
              )}

              {previewMedia.type === 'audio' && (
                <div className="w-full p-4 bg-slate-50 rounded-xl border border-slate-200">
                  <audio src={previewMedia.url} controls autoPlay className="w-full" />
                </div>
              )}

              {previewMedia.type === 'document' && (
                <div className="w-full space-y-3">
                  {previewMedia.url.match(/\.pdf($|\?)/i) || previewMedia.url.startsWith('blob:') ? (
                    <iframe src={previewMedia.url} title="Document preview" className="w-full h-[65vh] rounded-xl border border-slate-200 bg-white" />
                  ) : (
                    <div className="p-8 text-center bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                      <FileText className="w-12 h-12 text-[#3440a8] mx-auto opacity-80" />
                      <p className="text-sm font-semibold text-slate-800">{previewMedia.caption || 'Document file'}</p>
                      <p className="text-xs text-slate-500">Document preview ready for download or external viewing.</p>
                    </div>
                  )}
                </div>
              )}

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-3 border-t border-slate-100 text-xs">
                {previewMedia.caption ? (
                  <div className="bg-slate-50 border border-slate-200/80 rounded-xl px-3.5 py-2 max-w-lg">
                    <p className="text-xs text-slate-800 leading-relaxed break-words">{renderMessageWithLinks(previewMedia.caption)}</p>
                  </div>
                ) : (
                  <div />
                )}
                <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
                  <a
                    href={previewMedia.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1.5 text-slate-600 hover:bg-slate-100 rounded-lg flex items-center gap-1.5 font-medium border border-slate-200"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Open in tab
                  </a>
                  <a
                    href={previewMedia.url}
                    download
                    className="px-3 py-1.5 bg-[#3440a8] hover:bg-[#2b3590] text-white rounded-lg flex items-center gap-1.5 font-semibold"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Download
                  </a>
                </div>
              </div>
            </div>
          </Modal>
        )
      }
    </div >
  );
};
