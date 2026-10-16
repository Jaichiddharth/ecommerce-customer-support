'use client';

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import apiClient from '@/lib/api/client';

import {
  Search,
  Send,
  Paperclip,
  Smile,
  Mic,
  Plus,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  MessageSquare,
  Zap,
  ExternalLink,
  X,
  Check,
  User,
  ShoppingBag,
  Store,
  Sparkles,
  Share2,
  LogOut,
  Camera,
  Mail,
  Smartphone,
  CheckCheck,
  AlertCircle,
  Loader2,
  RefreshCw,
  FileText,
  Image as ImageIcon,
  Film,
  Music,
  Download,
} from 'lucide-react';
import {
  Conversation,
  Message,
  ChannelType,
  MessageStatus,
  normalizeMessageStatus,
  getMessageStatusName,
} from '../types';
import { useAuth } from '../context/AuthContext';
import { AddChannelModal } from './channels/AddChannelModal';
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

/**
 * Render Status Indicator for a message
 * 0 (Sent): Single check
 * 1 (Delivered): Double check (neutral)
 * 2 (Read): Double check (sky blue)
 * 3 (Failed): Red alert icon with label / error code
 */
const renderMessageStatusIndicator = (statusVal: unknown, errorCode?: number | null, errorMessage?: string | null) => {
  const norm = normalizeMessageStatus(statusVal);
  switch (norm) {
    case MessageStatus.SENT: // 0: sent
      return (
        <span
          title="Status: Sent (0)"
          className="inline-flex items-center text-slate-400"
        >
          <Check className="w-3.5 h-3.5 text-slate-400" />
        </span>
      );
    case MessageStatus.DELIVERED: // 1: delivered
      return (
        <span
          title="Status: Delivered (1)"
          className="inline-flex items-center text-slate-500"
        >
          <CheckCheck className="w-3.5 h-3.5 text-slate-500" />
        </span>
      );
    case MessageStatus.READ: // 2: read
      return (
        <span
          title="Status: Read (2)"
          className="inline-flex items-center text-sky-500"
        >
          <CheckCheck className="w-3.5 h-3.5 text-sky-500" />
        </span>
      );
    case MessageStatus.FAILED: { // 3: failed — short reason on the badge, full explanation on hover
      const info = getMetaErrorInfo(errorCode);
      const reason = errorMessage || describeMessageFailure(errorCode);
      const tooltip = [info?.title, reason, errorCode ? `(WhatsApp error ${errorCode})` : null].filter(Boolean).join(' — ');
      return (
        <span
          title={tooltip}
          className="inline-flex items-center gap-1 text-[10px] font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded border border-red-200 shadow-2xs cursor-help max-w-[280px]"
        >
          <AlertCircle className="w-3 h-3 text-red-600 shrink-0" />
          <span className="truncate">Failed · {info?.title ?? reason}</span>
        </span>
      );
    }
    default:
      return null;
  }
};

export interface WhatsAppChannel {
  id: number;
  organizationId?: number;
  type?: string;
  verified_name?: string | null;
  phoneNumber?: string | null;
  metaPhoneNumberId?: string | null;
  wabaId?: string | null;
  isActive?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Detects URLs in text (http, https, www) and renders them as clickable links.
 */
const renderMessageWithLinks = (text: string, isAgent: boolean = false) => {
  if (!text) return null;

  // Regex to match URLs starting with http://, https://, or www.
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

      const href = cleanUrl.startsWith('http://') || cleanUrl.startsWith('https://')
        ? cleanUrl
        : `https://${cleanUrl}`;

      return (
        <React.Fragment key={index}>
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className={`underline underline-offset-2 break-all transition-colors ${isAgent
              ? 'text-white font-medium hover:text-blue-100 hover:opacity-90'
              : 'text-[#2563eb] font-medium hover:text-[#1d4ed8]'
              }`}
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

interface InboxViewProps {
  conversations?: Conversation[];
  selectedConversationId?: string;
  onSelectConversation?: (id: string) => void;
  onSendMessage?: (conversationId: string, text: string) => void;
  onStatusChange?: (conversationId: string, status: 'open' | 'pending' | 'resolved') => void;
}

export const InboxView: React.FC<InboxViewProps> = ({
  conversations,
  selectedConversationId,
  onSelectConversation,
  onSendMessage,
}) => {
  // Navigation & filtering state
  const { user, dbUser, logout, getIdToken } = useAuth();

  // Firebase ID token appended to media URLs: <img>/<video> tags cannot send an Authorization header.
  // Refreshed every 50 minutes because ID tokens expire after 1 hour.
  const [mediaToken, setMediaToken] = useState<string | null>(null);
  useEffect(() => {
    if (!user) {
      setMediaToken(null);
      return;
    }
    let cancelled = false;
    const refresh = async () => {
      const token = await getIdToken();
      if (!cancelled) setMediaToken(token);
    };
    refresh();
    const interval = setInterval(refresh, 50 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [user, getIdToken]);
  const router = useRouter();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  const [isLeftSidebarOpen, setIsLeftSidebarOpen] = useState(true);
  const [activeChannelFolder, setActiveChannelFolder] = useState<string>('all');
  const [filterTab, setFilterTab] = useState<'all' | 'mine'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [orderSearchQuery, setOrderSearchQuery] = useState('');

  // Dynamic WhatsApp Channels & Customers from DB
  const [whatsappChannels, setWhatsappChannels] = useState<WhatsAppChannel[]>([]);
  const [isLoadingChannels, setIsLoadingChannels] = useState(true);
  const [channelsError, setChannelsError] = useState<ApiError | null>(null);
  const [isWhatsAppExpanded, setIsWhatsAppExpanded] = useState(true);
  // Right Drawer tab state
  const [shopifyTab, setShopifyTab] = useState<'orders' | 'catalog' | 'setup'>('orders');
  const [isCustomerProfileOpen, setIsCustomerProfileOpen] = useState(true);

  // Modals & Popovers
  const [showAddChannelModal, setShowAddChannelModal] = useState(false);
  const [showNewContactModal, setShowNewContactModal] = useState(false);
  const [showFastReplies, setShowFastReplies] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showShopifyConnectModal, setShowShopifyConnectModal] = useState(false);
  const [previewMedia, setPreviewMedia] = useState<{
    url: string;
    type: 'image' | 'video' | 'audio' | 'document' | string;
    senderName?: string;
    timestamp?: string;
    caption?: string;
  } | null>(null);

  // Customer list state
  const [customerList, setCustomerList] = useState<any[]>([]);
  const [isLoadingCustomers, setIsLoadingCustomers] = useState(true);
  const [customersError, setCustomersError] = useState<ApiError | null>(null);
  const [internalSelectedId, setInternalSelectedId] = useState<string>('');

  // Database Messages State
  const [messagesMap, setMessagesMap] = useState<Record<string, Message[]>>({});
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [messagesLoadError, setMessagesLoadError] = useState<{ convId: string; error: ApiError } | null>(null);
  const [isSyncingMessages, setIsSyncingMessages] = useState(false);
  const [messageReactions, setMessageReactions] = useState<Record<string, string>>({});
  const [reactionPickerMsgId, setReactionPickerMsgId] = useState<string | null>(null);
  const [reactionPickerPlacement, setReactionPickerPlacement] = useState<'top' | 'bottom'>('top');

  // Fetch messages from PostgreSQL for a specific customer
  const fetchMessagesForCustomer = useCallback(async (customerId: number): Promise<ApiError | null> => {
    try {
      const res = await apiClient.get(`/api/messages?customerId=${customerId}`);
      if (res.data?.success && Array.isArray(res.data.messages)) {
        const mappedMessages: Message[] = res.data.messages.map((m: any) => {
          const dateObj = m.createdAt ? new Date(m.createdAt) : new Date();
          const timeStr = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }).toLowerCase();
          const resolvedType = m.mediaType || (m.mediaUrl ? 'image' : 'text');
          return {
            id: String(m.id),
            sender: m.senderType === 'customer' ? 'customer' : 'agent',
            senderId: m.senderId ?? null,
            senderName: m.senderName ?? null,
            channel: 'whatsapp',
            text: m.textContent || '',
            timestamp: timeStr,
            createdAt: dateObj.toISOString(),
            status: m.status !== undefined ? normalizeMessageStatus(m.status) : (m.isRead ? MessageStatus.READ : MessageStatus.DELIVERED),
            errorCode: m.errorCode || undefined,
            type: resolvedType,
            mediaType: m.mediaType || undefined,
            mediaUrl: m.mediaUrl || undefined,
            metaMessageId: m.metaMessageId || undefined,
            reactions: m.reactions || [],
          };
        });

        const convId = `cust-${customerId}`;
        setMessagesMap((prev) => ({
          ...prev,
          [convId]: mappedMessages,
        }));
        setMessagesLoadError((prev) => (prev?.convId === convId ? null : prev));
      }
      return null;
    } catch (err) {
      const apiError = toApiError(err);
      setMessagesLoadError({ convId: `cust-${customerId}`, error: apiError });
      return apiError;
    }
  }, []);

  // Handle setting / toggling reactions for a message
  const handleToggleReaction = async (msgId: string, emojiToSet: string) => {
    if (!activeConv) return;
    const numMsgId = Number(msgId);
    if (isNaN(numMsgId)) return;

    const convId = activeConv.id;
    const currentMsgs = messagesMap[convId] || [];
    const targetMsg = currentMsgs.find((m) => m.id === msgId);

    const currentUserId = dbUser?.id;
    const existingAgentReaction = targetMsg?.reactions?.find(
      (r) => (currentUserId ? r.userId === currentUserId : Boolean(r.userId && !r.customerId))
    );
    const isRemoving = existingAgentReaction && existingAgentReaction.emoji === emojiToSet;
    const finalEmoji = isRemoving ? '' : emojiToSet;


    console.log("finalEmoji", finalEmoji)

    // Optimistically update local state
    setMessagesMap((prev) => {
      const msgs = prev[convId] || [];
      return {
        ...prev,
        [convId]: msgs.map((m) => {
          if (m.id !== msgId) return m;
          let newReactions = [...(m.reactions || [])];
          if (isRemoving) {
            newReactions = newReactions.filter(
              (r) => !(currentUserId ? r.userId === currentUserId : Boolean(r.userId && !r.customerId))
            );
          } else {
            const existingIdx = newReactions.findIndex(
              (r) => (currentUserId ? r.userId === currentUserId : Boolean(r.userId && !r.customerId))
            );
            if (existingIdx >= 0) {
              newReactions[existingIdx] = { ...newReactions[existingIdx], emoji: emojiToSet };
            } else {
              newReactions.push({ id: Date.now(), emoji: emojiToSet, userId: currentUserId ?? null });
            }
          }
          return { ...m, reactions: newReactions };
        }),
      };
    });

    try {
      const res = await apiClient.post('/api/messages/reactions', {
        messageId: numMsgId,
        emoji: finalEmoji,
        customerId: Number(activeConv.customer.id),
        to: activeConv.customer.phone,
        channelId: activeConv.customer.channelId,
      });
      if (res.data?.metaDelivered === false) {
        notifyWarning('Reaction saved, but not delivered to WhatsApp', res.data?.metaError?.message);
      }
    } catch (err) {
      notifyError(err, { where: 'InboxView.handleToggleReaction', title: 'Reaction not saved' });
      const targetCustomerNumId = Number(activeConv.customer.id);
      if (!isNaN(targetCustomerNumId)) {
        fetchMessagesForCustomer(targetCustomerNumId);
      }
    }
  };

  // Manual sync handler for fetching latest messages for active conversation
  const handleManualSync = async () => {
    if (!activeConv) return;
    const customerId = Number(activeConv.customer.id);
    if (isNaN(customerId)) return;

    try {
      setIsSyncingMessages(true);
      const [messagesError, customersLoadError] = await Promise.all([
        fetchMessagesForCustomer(customerId),
        fetchCustomers(),
      ]);
      const syncError = messagesError ?? customersLoadError;
      if (syncError) {
        notifyError(syncError, { where: 'InboxView.handleManualSync', title: 'Sync failed' });
      } else {
        gooeyToast.success('Messages synced successfully');
      }
    } finally {
      setTimeout(() => {
        setIsSyncingMessages(false);
      }, 400);
    }
  };

  // Selected active WhatsApp channel for sending
  const [selectedChannelId, setSelectedChannelId] = useState<number | null>(null);
  const [isSendingMeta, setIsSendingMeta] = useState(false);

  // Active WhatsApp Channel derived from selection or first active
  const activeWhatsAppChannel = useMemo(() => {
    if (!whatsappChannels || whatsappChannels.length === 0) return null;
    if (selectedChannelId) {
      const found = whatsappChannels.find((c) => c.id === selectedChannelId);
      if (found) return found;
    }
    if (activeChannelFolder && activeChannelFolder.startsWith('whatsapp-')) {
      const idFromFolder = Number(activeChannelFolder.replace('whatsapp-', ''));
      const found = whatsappChannels.find((c) => c.id === idFromFolder);
      if (found) return found;
    }
    return whatsappChannels.find((c) => c.isActive) || whatsappChannels[0];
  }, [whatsappChannels, selectedChannelId, activeChannelFolder]);

  // Fetch Customers from Database
  const fetchCustomers = useCallback(async (): Promise<ApiError | null> => {
    try {
      setIsLoadingCustomers(true);
      const res = await apiClient.get('/api/customer');
      if (res.data?.success && Array.isArray(res.data.customers)) {
        setCustomerList(res.data.customers);
      }
      setCustomersError(null);
      return null;
    } catch (err) {
      const apiError = toApiError(err);
      setCustomersError(apiError);
      return apiError;
    } finally {
      setIsLoadingCustomers(false);
    }
  }, []);

  // Fetch WhatsApp connections from DB
  const fetchWhatsAppChannels = useCallback(async () => {
    try {
      setIsLoadingChannels(true);
      setChannelsError(null);
      const res = await apiClient.get('/api/channels/whatsapp/connections');
      if (res.data?.success && Array.isArray(res.data.connections)) {
        setWhatsappChannels(res.data.connections);
        if (res.data.connections.length > 0) {
          setSelectedChannelId((prev) => prev ?? res.data.connections[0].id);
        }
      }
    } catch (err) {
      setChannelsError(toApiError(err));
    } finally {
      setIsLoadingChannels(false);
    }
  }, []);

  useEffect(() => {
    fetchCustomers();
    fetchWhatsAppChannels();

    const handleChannelConnected = () => {
      fetchWhatsAppChannels();
    };

    window.addEventListener('whatsapp-channel-connected', handleChannelConnected);
    return () => {
      window.removeEventListener('whatsapp-channel-connected', handleChannelConnected);
    };
  }, [fetchCustomers, fetchWhatsAppChannels]);

  // New Contact Form
  const [newContactName, setNewContactName] = useState('');
  const [newContactPhone, setNewContactPhone] = useState('');
  const [newContactChannelId, setNewContactChannelId] = useState<number | null>(null);

  // Helper to open New Contact modal with default channel preselected
  const openNewContactModal = () => {
    let initialChannelId = selectedChannelId || (whatsappChannels.length > 0 ? whatsappChannels[0].id : null);
    if (activeChannelFolder && activeChannelFolder.startsWith('whatsapp-')) {
      const folderId = Number(activeChannelFolder.replace('whatsapp-', ''));
      if (!isNaN(folderId)) initialChannelId = folderId;
    }
    setNewContactChannelId(initialChannelId);
    setShowNewContactModal(true);
  };

  // Message, Attachment & Reactions
  const [inputMessage, setInputMessage] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [filePreviewUrl, setFilePreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
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
      if (file.type.startsWith('image/')) {
        setFilePreviewUrl(URL.createObjectURL(file));
      } else {
        setFilePreviewUrl(null);
      }
    }
  };

  const handleClearSelectedFile = () => {
    setSelectedFile(null);
    if (filePreviewUrl) {
      URL.revokeObjectURL(filePreviewUrl);
      setFilePreviewUrl(null);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const [customerReaction, setCustomerReaction] = useState<string | null>(null);
  const [agentReaction, setAgentReaction] = useState<string | null>(null);

  // Pagination state for conversation history
  const [currentPage, setCurrentPage] = useState(1);
  const totalPages = 1;

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fastRepliesRef = useRef<HTMLDivElement>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const reactionPickerRef = useRef<HTMLDivElement>(null);
  const [showFullReactionPicker, setShowFullReactionPicker] = useState(false);

  // Close fast replies, emoji pickers and user menu when clicked outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (fastRepliesRef.current && !fastRepliesRef.current.contains(event.target as Node)) {
        setShowFastReplies(false);
      }
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setShowUserMenu(false);
      }
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(event.target as Node)) {
        setShowEmojiPicker(false);
      }
      if (reactionPickerRef.current && !reactionPickerRef.current.contains(event.target as Node)) {
        setReactionPickerMsgId(null);
        setShowFullReactionPicker(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const getUserInitials = () => {
    if (user?.displayName) {
      const parts = user.displayName.trim().split(' ');
      if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
      return parts[0].slice(0, 2).toUpperCase();
    }
    if (user?.email) {
      return user.email.slice(0, 2).toUpperCase();
    }
    return 'U';
  };

  const handleLogout = async () => {
    try {
      await logout();
      router.replace('/login');
    } catch (err) {
      clientLogger.error('InboxView.handleLogout', 'Logout failed', toApiError(err).toLogObject());
    }
  };

  // Convert DB customers into full conversation objects
  const dbConversations: Conversation[] = useMemo(() => {
    return customerList.map((c) => {
      const timeStr = c.createdAt
        ? new Date(c.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : 'Recent';

      const convId = `cust-${c.id}`;
      const convMessages = messagesMap[convId] || [];
      const latestMsg = convMessages.length > 0 ? convMessages[convMessages.length - 1] : undefined;

      return {
        id: convId,
        customer: {
          id: String(c.id),
          channelId: c.channelId || null,
          name: c.name,
          phone: c.phone || '',
          email: c.email || '',
          avatar: c.avatarUrl || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150',
          shopifyCustomerId: c.shopifyCustomerId || undefined,
          totalOrders: 0,
          totalSpent: 0,
          currency: 'INR',
          tags: c.tags || [],
          optInStatus: {
            whatsapp: !c.isOptedOut,
            sms: false,
            email: Boolean(c.email),
          },
        },
        channel: 'whatsapp' as ChannelType,
        status: 'open' as const,
        unreadCount: 0,
        assignedAgent: 'Rahul Sharma',
        updatedAt: latestMsg ? latestMsg.timestamp : timeStr,
        lastMessage: latestMsg,
        messages: convMessages,
        tags: (c.tags as string[]) || [],
      };
    });
  }, [customerList, messagesMap]);

  // DB customers only - 100% real database records, no dummy data
  const allConversations = dbConversations;

  const currentSelectedId = selectedConversationId || internalSelectedId;

  const activeConv = currentSelectedId
    ? allConversations.find((c) => c.id === currentSelectedId) || null
    : null;

  const handleSelectConversation = (id: string) => {
    setInternalSelectedId(id);
    onSelectConversation?.(id);
  };

  // -------------------------------------------------------------
  // REAL-TIME SSE SYNC HANDLERS
  // -------------------------------------------------------------
  const handleRealtimeNewMessage = useCallback(
    (event: { customerId: number; customer?: any; message: any }) => {
      const { customerId, customer, message: rawMsg } = event;
      if (!rawMsg || !customerId) return;

      console.log('⚡ [InboxView Realtime] Incoming new message:', event);

      const dateObj = rawMsg.createdAt ? new Date(rawMsg.createdAt) : new Date();
      const timeStr = dateObj
        .toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true })
        .toLowerCase();
      const resolvedType = rawMsg.mediaType || (rawMsg.mediaUrl ? 'image' : 'text');

      const incomingMsg: Message = {
        id: String(rawMsg.id),
        sender: rawMsg.senderType === 'customer' ? 'customer' : 'agent',
        senderId: rawMsg.senderId ?? null,
        senderName: rawMsg.senderName ?? null,
        channel: 'whatsapp',
        text: rawMsg.textContent || '',
        timestamp: timeStr,
        createdAt: dateObj.toISOString(),
        status:
          rawMsg.status !== undefined
            ? normalizeMessageStatus(rawMsg.status)
            : MessageStatus.DELIVERED,
        errorCode: rawMsg.errorCode || undefined,
        type: resolvedType,
        mediaType: rawMsg.mediaType || undefined,
        mediaUrl: rawMsg.mediaUrl || undefined,
        metaMessageId: rawMsg.metaMessageId || undefined,
        reactions: rawMsg.reactions || [],
      };

      const convId = `cust-${customerId}`;

      // Update message map (deduplicate against existing DB ID, Meta Message ID, or temporary optimistic ID)
      setMessagesMap((prev) => {
        const existingMsgs = prev[convId] || [];

        const existingIndex = existingMsgs.findIndex((m) => {
          if (m.id === String(rawMsg.id)) return true;
          if (rawMsg.metaMessageId && m.metaMessageId && m.metaMessageId === rawMsg.metaMessageId) return true;
          // Match temporary optimistic message ID
          if (m.id.startsWith('msg-') && m.sender === incomingMsg.sender && m.text === incomingMsg.text) {
            return true;
          }
          return false;
        });

        if (existingIndex >= 0) {
          const updated = [...existingMsgs];
          updated[existingIndex] = {
            ...updated[existingIndex],
            ...incomingMsg,
            id: String(rawMsg.id),
          };
          return { ...prev, [convId]: updated };
        } else {
          return { ...prev, [convId]: [...existingMsgs, incomingMsg] };
        }
      });

      // Update customer list: bump to top or add new incoming customer
      setCustomerList((prevCustomers) => {
        const existingCustomerIdx = prevCustomers.findIndex((c) => Number(c.id) === customerId);
        if (existingCustomerIdx >= 0) {
          const existingCustomer = prevCustomers[existingCustomerIdx];
          const updatedCustomer = {
            ...existingCustomer,
            createdAt: new Date().toISOString(),
            name:
              customer?.name && customer.name !== 'WhatsApp Customer'
                ? customer.name
                : existingCustomer.name,
            phone: customer?.phone || existingCustomer.phone,
          };
          const listWithout = prevCustomers.filter((_, idx) => idx !== existingCustomerIdx);
          return [updatedCustomer, ...listWithout];
        } else {
          // Brand new incoming WhatsApp customer
          const newCustObj = {
            id: customerId,
            name: customer?.name || 'WhatsApp Customer',
            phone: customer?.phone || '',
            channelId: customer?.channelId || null,
            createdAt: new Date().toISOString(),
            tags: [],
          };
          return [newCustObj, ...prevCustomers];
        }
      });

      // If this conversation is currently open, scroll smoothly to the new message
      if (currentSelectedId === convId) {
        setTimeout(() => {
          messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }, 80);
      } else if (rawMsg.senderType === 'customer') {
        // Notification for incoming message from another conversation
        const senderName = customer?.name || customer?.phone || 'WhatsApp Contact';
        gooeyToast.info(`New message from ${senderName}`, {
          description: rawMsg.textContent || `[${resolvedType.toUpperCase()}] New attachment`,
        });
      }
    },
    [currentSelectedId]
  );

  const handleRealtimeStatus = useCallback(
    (event: {
      customerId?: number;
      metaMessageId: string;
      status: number | string;
      errorCode?: number | null;
    }) => {
      const { customerId, metaMessageId, status: newStatusVal, errorCode } = event;
      if (!metaMessageId) return;

      console.log('⚡ [InboxView Realtime] Incoming status update:', event);
      const normStatus = normalizeMessageStatus(newStatusVal);

      setMessagesMap((prev) => {
        const next = { ...prev };
        let modified = false;

        const targetConvKeys = customerId ? [`cust-${customerId}`] : Object.keys(next);

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
            modified = true;
            break;
          }
        }

        return modified ? next : prev;
      });
    },
    []
  );

  const handleRealtimeReaction = useCallback(
    (event: {
      customerId?: number;
      messageId: number;
      emoji: string | null;
      userId?: number | null;
    }) => {
      const { customerId, messageId, emoji, userId } = event;
      if (!messageId) return;

      console.log('⚡ [InboxView Realtime] Incoming reaction update:', event);
      const targetMsgIdStr = String(messageId);

      setMessagesMap((prev) => {
        const next = { ...prev };
        let modified = false;

        const targetConvKeys = customerId ? [`cust-${customerId}`] : Object.keys(next);

        for (const convKey of targetConvKeys) {
          const msgs = next[convKey];
          if (!msgs || msgs.length === 0) continue;

          const msgIdx = msgs.findIndex((m) => m.id === targetMsgIdStr);
          if (msgIdx >= 0) {
            const targetMsg = msgs[msgIdx];
            let reactions = [...(targetMsg.reactions || [])];

            if (emoji) {
              // Upsert reaction
              const existingIdx = reactions.findIndex((r) => {
                if (userId) return r.userId === userId;
                return Boolean(r.customerId && r.customerId === customerId);
              });

              if (existingIdx >= 0) {
                reactions[existingIdx] = { ...reactions[existingIdx], emoji };
              } else {
                reactions.push({
                  id: Date.now(),
                  emoji,
                  userId: userId || null,
                  customerId: customerId || null,
                });
              }
            } else {
              // Delete reaction
              reactions = reactions.filter((r) => {
                if (userId) return r.userId !== userId;
                if (customerId) return r.customerId !== customerId;
                return true;
              });
            }

            const updatedMsgs = [...msgs];
            updatedMsgs[msgIdx] = { ...targetMsg, reactions };
            next[convKey] = updatedMsgs;
            modified = true;
            break;
          }
        }

        return modified ? next : prev;
      });
    },
    []
  );

  // Hook into live SSE Realtime Stream
  const { isConnected: isRealtimeConnected } = useRealtime({
    onMessageNew: handleRealtimeNewMessage,
    onMessageStatus: handleRealtimeStatus,
    onMessageReaction: handleRealtimeReaction,
  });

  // Filter conversations based on search, tab, and selected channel folder
  const filteredConversations = allConversations.filter((conv) => {
    const matchesSearch =
      conv.customer.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      conv.customer.phone.includes(searchQuery) ||
      (conv.lastMessage?.text && conv.lastMessage.text.toLowerCase().includes(searchQuery.toLowerCase()));

    if (!matchesSearch) return false;

    if (filterTab === 'mine' && conv.assignedAgent !== 'Rahul Sharma') {
      return false;
    }

    if (activeChannelFolder === 'all') {
      return true;
    }

    if (activeChannelFolder === 'whatsapp') {
      return conv.channel === 'whatsapp';
    }

    if (activeChannelFolder.startsWith('whatsapp-')) {
      const targetChannelId = Number(activeChannelFolder.replace('whatsapp-', ''));
      const customerChannelId = conv.customer.channelId;
      return conv.channel === 'whatsapp' && (!customerChannelId || customerChannelId === targetChannelId);
    }

    return true;
  });

  // Active channel for the currently open conversation (based on customer's channelId)
  const conversationChannel = useMemo(() => {
    if (!activeConv) return activeWhatsAppChannel;
    if (activeConv.customer.channelId) {
      const matched = whatsappChannels.find((c) => c.id === activeConv.customer.channelId);
      if (matched) return matched;
    }
    return activeWhatsAppChannel;
  }, [activeConv, whatsappChannels, activeWhatsAppChannel]);

  // Load Database Messages for selected customer
  useEffect(() => {
    if (!currentSelectedId || !currentSelectedId.startsWith('cust-')) return;
    const customerId = Number(currentSelectedId.replace('cust-', ''));
    if (isNaN(customerId)) return;

    fetchMessagesForCustomer(customerId);
  }, [currentSelectedId, fetchMessagesForCustomer]);

  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if ((!inputMessage.trim() && !selectedFile) || !activeConv) return;

    const messageText = inputMessage.trim();
    const customerPhone = activeConv.customer.phone;

    if (!customerPhone) {
      gooeyToast.error(`Customer "${activeConv.customer.name}" does not have a phone number. Please add a phone number first.`);
      return;
    }

    const targetChannel = conversationChannel || activeWhatsAppChannel;
    if (!targetChannel) {
      gooeyToast.error('No connected WhatsApp channel found. Please connect your WhatsApp account first.');
      return;
    }

    const timeNow = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }).toLowerCase();
    const fromLabel = `${targetChannel.verified_name || 'WhatsApp'} (${targetChannel.phoneNumber || targetChannel.metaPhoneNumberId || 'Connected'})`;
    const toLabel = `${activeConv.customer.name} (${customerPhone})`;

    clientLogger.debug('InboxView.handleSend', 'Sending WhatsApp message', {
      from: fromLabel,
      channelId: targetChannel.id,
      to: toLabel,
      length: messageText.length,
      ...(selectedFile ? { file: { name: selectedFile.name, type: selectedFile.type, size: selectedFile.size } } : {}),
    });

    setIsSendingMeta(true);
    const newMsgId = `msg-${Date.now()}`;
    const attachedFile = selectedFile;
    const currentPreviewUrl = filePreviewUrl;

    const resolvedType = attachedFile
      ? attachedFile.type.startsWith('image/')
        ? 'image'
        : attachedFile.type.startsWith('video/')
          ? 'video'
          : attachedFile.type.startsWith('audio/')
            ? 'audio'
            : 'document'
      : 'text';

    const newMsg: Message = {
      id: newMsgId,
      sender: 'agent',
      senderId: dbUser?.id ?? null,
      senderName: dbUser?.name ?? null,
      channel: 'whatsapp',
      text: messageText,
      timestamp: timeNow,
      createdAt: new Date().toISOString(),
      status: MessageStatus.SENT,
      type: resolvedType,
      mediaType: resolvedType,
      mediaUrl: currentPreviewUrl || undefined,
    };

    // Optimistically add message to chat thread
    setMessagesMap((prev) => ({
      ...prev,
      [activeConv.id]: [...(prev[activeConv.id] || []), newMsg],
    }));
    setInputMessage('');
    handleClearSelectedFile();

    const targetCustomerNumId = Number(activeConv.customer.id);

    try {
      let res;
      if (attachedFile) {
        const formData = new FormData();
        formData.append('to', customerPhone);
        if (messageText) {
          formData.append('text', messageText);
        }
        formData.append('channelId', String(targetChannel.id));
        if (!isNaN(targetCustomerNumId)) {
          formData.append('customerId', String(targetCustomerNumId));
        }
        formData.append('file', attachedFile);

        res = await apiClient.post('/api/channels/whatsapp/send', formData, {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        });
      } else {
        res = await apiClient.post('/api/channels/whatsapp/send', {
          to: customerPhone,
          text: messageText,
          channelId: targetChannel.id,
          customerId: isNaN(targetCustomerNumId) ? undefined : targetCustomerNumId,
        });
      }

      if (res.data?.success) {
        if (res.data?.persisted === false) {
          notifyWarning('Message delivered, but not saved', res.data?.warning);
        } else {
          gooeyToast.success(`Message sent to ${activeConv.customer.name} (${customerPhone}) via WhatsApp!`);
        }
        if (!isNaN(targetCustomerNumId)) {
          fetchMessagesForCustomer(targetCustomerNumId);
        }
      }
    } catch (err) {
      const apiError = notifyError(err, { where: 'InboxView.handleSend', title: 'Message not sent' });
      const metaCode = typeof apiError.details?.metaCode === 'number' ? apiError.details.metaCode : null;
      // Keep the bubble and mark it failed with the reason, so the agent sees what happened
      setMessagesMap((prev) => ({
        ...prev,
        [activeConv.id]: (prev[activeConv.id] || []).map((m) =>
          m.id === newMsgId
            ? { ...m, status: MessageStatus.FAILED, errorCode: metaCode, errorMessage: apiError.message }
            : m
        ),
      }));
    } finally {
      setIsSendingMeta(false);
      onSendMessage?.(activeConv.id, messageText);
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    }
  };

  const handleCreateContactAndSend = async () => {
    try {
      if (whatsappChannels.length === 0) {
        gooeyToast.error('Please connect a WhatsApp channel before adding customers.');
        return;
      }

      setIsLoadingCustomers(true);
      const cleanPhone = newContactPhone.replace(/\D/g, '');
      if (!cleanPhone) {
        gooeyToast.error('Please enter a valid phone number (digits only, e.g. 919876543210)');
        return;
      }

      const targetChannelId = newContactChannelId || activeWhatsAppChannel?.id || (whatsappChannels.length > 0 ? whatsappChannels[0].id : null);
      if (!targetChannelId) {
        gooeyToast.error('Please select a valid WhatsApp channel for this customer.');
        return;
      }

      const res = await apiClient.post('/api/customer', {
        name: newContactName.trim(),
        phone: cleanPhone,
        channelId: targetChannelId,
      });
      if (res.data?.success && res.data?.customer) {
        const targetChannelObj = whatsappChannels.find((c) => c.id === targetChannelId);
        gooeyToast.success(`Customer ${newContactName} created under ${targetChannelObj?.verified_name || 'WhatsApp'}!`);
        await fetchCustomers();
        handleSelectConversation(`cust-${res.data.customer.id}`);
      }
    } catch (err) {
      notifyError(err, { where: 'InboxView.handleCreateContact', title: 'Customer not created' });
    } finally {
      setIsLoadingCustomers(false);
    }
  };

  const handleCreateContact = (e: React.FormEvent) => {
    e.preventDefault();
    if (whatsappChannels.length === 0) {
      gooeyToast.error('No WhatsApp channel available. Please connect a channel first.');
      return;
    }
    if (!newContactName.trim() || !newContactPhone.trim()) return;
    handleCreateContactAndSend();
    setShowNewContactModal(false);
    setNewContactName('');
    setNewContactPhone('');
  };

  const fastRepliesList = [
    { title: '👋 Welcome greeting', text: 'Hi! Thank you for reaching out to us. How can I help you today?' },
    { title: '📦 Order Status Check', text: 'We have checked your order details and it is currently in transit. Expected delivery is tomorrow.' },
    { title: '💳 Refund / Return policy', text: 'We offer a hassle-free 7-day return and exchange policy. Would you like me to generate a return label?' },
    { title: '🙏 Closing conversation', text: 'Thank you for contacting Omnichannel Support! Please let us know if you need anything else. Have a wonderful day!' },
  ];

  // Helper to render channel icon for conversation list
  const renderChannelIcon = (channel: ChannelType | string) => {
    switch (channel) {
      case 'whatsapp':
        return (
          <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-[#25d366] shrink-0" xmlns="http://www.w3.org/2000/svg">
            <path d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38c1.45.79 3.08 1.21 4.74 1.21 5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.816 9.816 0 0 0 12.04 2zm.01 1.67c2.2 0 4.26.86 5.82 2.42a8.185 8.185 0 0 1 2.41 5.82c0 4.54-3.7 8.24-8.24 8.24-1.42 0-2.82-.37-4.06-1.08l-.29-.17-3.12.82.83-3.04-.19-.3a8.17 8.17 0 0 1-1.26-4.47c0-4.54 3.7-8.24 8.24-8.24zm4.52 11.66c-.25-.13-1.47-.72-1.7-.81-.23-.08-.39-.13-.56.13-.17.25-.64.81-.79.97-.14.17-.29.19-.54.06-.25-.13-1.07-.39-2.03-1.25-.75-.67-1.26-1.5-1.41-1.75-.15-.25-.02-.39.11-.51.11-.11.25-.29.38-.44.13-.14.17-.25.25-.42.08-.17.04-.31-.02-.44-.06-.13-.56-1.35-.77-1.85-.2-.49-.41-.42-.56-.43h-.48c-.17 0-.44.06-.67.31-.23.25-.87.85-.87 2.08 0 1.23.9 2.42 1.02 2.59.13.17 1.76 2.69 4.27 3.77.6.26 1.06.41 1.43.53.6.19 1.15.16 1.58.1.48-.07 1.47-.6 1.68-1.18.21-.58.21-1.07.15-1.18-.06-.11-.21-.18-.46-.3z" />
          </svg>
        );
      case 'instagram':
        return <Camera className="w-3.5 h-3.5 text-pink-600 shrink-0" />;
      case 'messenger':
        return <Send className="w-3.5 h-3.5 text-blue-600 shrink-0" />;
      case 'email':
        return <Mail className="w-3.5 h-3.5 text-slate-500 shrink-0" />;
      case 'sms':
        return <Smartphone className="w-3.5 h-3.5 text-amber-600 shrink-0" />;
      default:
        return (
          <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-[#25d366] shrink-0" xmlns="http://www.w3.org/2000/svg">
            <path d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38c1.45.79 3.08 1.21 4.74 1.21 5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.816 9.816 0 0 0 12.04 2zm.01 1.67c2.2 0 4.26.86 5.82 2.42a8.185 8.185 0 0 1 2.41 5.82c0 4.54-3.7 8.24-8.24 8.24-1.42 0-2.82-.37-4.06-1.08l-.29-.17-3.12.82.83-3.04-.19-.3a8.17 8.17 0 0 1-1.26-4.47c0-4.54 3.7-8.24 8.24-8.24zm4.52 11.66c-.25-.13-1.47-.72-1.7-.81-.23-.08-.39-.13-.56.13-.17.25-.64.81-.79.97-.14.17-.29.19-.54.06-.25-.13-1.07-.39-2.03-1.25-.75-.67-1.26-1.5-1.41-1.75-.15-.25-.02-.39.11-.51.11-.11.25-.29.38-.44.13-.14.17-.25.25-.42.08-.17.04-.31-.02-.44-.06-.13-.56-1.35-.77-1.85-.2-.49-.41-.42-.56-.43h-.48c-.17 0-.44.06-.67.31-.23.25-.87.85-.87 2.08 0 1.23.9 2.42 1.02 2.59.13.17 1.76 2.69 4.27 3.77.6.26 1.06.41 1.43.53.6.19 1.15.16 1.58.1.48-.07 1.47-.6 1.68-1.18.21-.58.21-1.07.15-1.18-.06-.11-.21-.18-.46-.3z" />
          </svg>
        );
    }
  };

  return (
    <div className="flex flex-col h-full w-full bg-[#f8fafc] overflow-hidden select-none font-sans text-slate-800">
      {/* ======================================================== */}
      {/* TOP HEADER: Omnichannel Support v2.0 + Add Channel       */}
      {/* ======================================================== */}
      <header className="h-14 bg-white border-b border-slate-200 px-4 flex items-center justify-between shrink-0 z-20 shadow-2xs">
        {/* Left: Brand Logo & Title */}
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#2563eb] to-[#4f46e5] text-white flex items-center justify-center font-black text-base shadow-sm">
            O
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-bold text-slate-900 leading-tight">
                Omnichannel Support
              </h1>
              <span className="text-[10px] font-semibold text-[#2563eb] bg-[#eff6ff] border border-[#bfdbfe] px-1.5 py-0.2 rounded font-mono">
                v2.0
              </span>
            </div>
            <p className="text-[11px] text-slate-500 leading-none mt-0.5">
              Unified Customer Command Desk
            </p>
          </div>
        </div>

        {/* Right: + Add Channel Button & Connected User Profile Avatar */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowAddChannelModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#2563eb] hover:bg-[#1d4ed8] text-white text-xs font-semibold shadow-xs transition-all cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
            <span>Add Channel</span>
          </button>

          {/* Vertical Separator */}
          <div className="h-5 w-px bg-slate-200" />

          {/* Connected Firebase User Avatar Pill */}
          <div className="relative" ref={userMenuRef}>
            <button
              onClick={() => setShowUserMenu(!showUserMenu)}
              className="flex items-center gap-2 py-1 px-1.5 pr-2.5 rounded-full bg-slate-50 hover:bg-slate-100 border border-slate-200 transition-all cursor-pointer group"
              title={user?.email || 'Connected Firebase User'}
            >
              <div className="relative">
                <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-blue-600 to-indigo-600 text-white flex items-center justify-center font-bold text-xs shadow-xs overflow-hidden">
                  {user?.photoURL ? (
                    <img src={user.photoURL} alt="User Avatar" className="w-full h-full object-cover" />
                  ) : (
                    <span>{getUserInitials()}</span>
                  )}
                </div>
                {/* Live Online Badge */}
                <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-500 border-2 border-white rounded-full"></span>
              </div>

              <div className="flex flex-col items-start text-left">
                <div className="flex items-center gap-1">
                  <span className="text-xs font-semibold text-slate-800 max-w-[110px] truncate leading-tight">
                    {user?.displayName || (user?.email ? user.email.split('@')[0] : 'Connected User')}
                  </span>
                  <ChevronDown className={`w-3 h-3 text-slate-400 group-hover:text-slate-600 transition-transform duration-200 ${showUserMenu ? 'rotate-180' : ''}`} />
                </div>
                {/* <span className="text-[10px] text-emerald-600 font-medium leading-none flex items-center gap-1">
                  Firebase Connected
                </span> */}
              </div>
            </button>

            {/* Dropdown Menu */}
            {showUserMenu && (
              <div className="absolute right-0 mt-2 w-64 bg-white rounded-xl shadow-xl border border-slate-200 py-2 z-50 text-xs animate-in fade-in slide-in-from-top-2 duration-150">
                <div className="px-3.5 py-2.5 border-b border-slate-100">
                  <div className="flex items-center gap-2.5 mb-2">
                    <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-blue-600 to-indigo-600 text-white flex items-center justify-center font-bold text-sm shadow-xs overflow-hidden">
                      {user?.photoURL ? (
                        <img src={user.photoURL} alt="User Avatar" className="w-full h-full object-cover" />
                      ) : (
                        <span>{getUserInitials()}</span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-bold text-slate-900 truncate">
                        {user?.displayName || 'Support Agent'}
                      </p>
                      <p className="text-[11px] text-slate-500 truncate">
                        {user?.email || 'Authenticated via Firebase'}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-emerald-50 border border-emerald-200/60 text-emerald-700 text-[11px] font-medium">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                    <span>Firebase Auth Active</span>
                  </div>
                </div>

                <div className="py-1">
                  {user?.uid && (
                    <div className="px-3.5 py-1.5 text-[10px] text-slate-400 font-mono flex items-center justify-between">
                      <span>UID:</span>
                      <span className="truncate max-w-[130px]">{user.uid}</span>
                    </div>
                  )}
                  <div className="px-3.5 py-1.5 text-[11px] text-slate-600 flex items-center justify-between">
                    <span>Role</span>
                    <span className="font-medium text-slate-900 bg-slate-100 px-1.5 py-0.5 rounded text-[10px]">
                      Administrator
                    </span>
                  </div>
                </div>

                <div className="border-t border-slate-100 pt-1 mt-1">
                  <button
                    onClick={handleLogout}
                    className="w-full px-3.5 py-2 text-left text-rose-600 hover:bg-rose-50 flex items-center gap-2 font-medium transition-colors cursor-pointer"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>Sign Out</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ======================================================== */}
      {/* MAIN 4-PANE INTERFACE                                    */}
      {/* ======================================================== */}
      <div className="flex flex-1 min-h-0 w-full overflow-hidden">
        {/* ====================================================== */}
        {/* PANE 0: MINI ICON SIDEBAR (Single Inbox Chat Icon)     */}
        {/* ====================================================== */}
        <aside className="w-12 bg-white border-r border-slate-200 flex flex-col items-center py-3.5 shrink-0 h-full select-none justify-between z-10">
          <div className="flex flex-col items-center gap-3 w-full px-1.5">
            {/* Single Active Chat Icon Button */}
            <button
              title="Inbox & Live Chats"
              className="w-8 h-8 rounded-lg bg-[#eff6ff] text-[#2563eb] border border-[#bfdbfe] flex items-center justify-center transition-all shadow-2xs cursor-pointer hover:bg-[#dbeafe]"
            >
              <MessageSquare className="w-4 h-4 stroke-[2.2]" />
            </button>
          </div>
        </aside>

        {/* ====================================================== */}
        {/* PANE 1: LEFT CHANNELS / INBOX NAVIGATION               */}
        {/* ====================================================== */}
        {isLeftSidebarOpen ? (
          <aside className="w-52 bg-white border-r border-slate-200 flex flex-col shrink-0 h-full select-none text-xs">
            {/* Header: < Inbox */}
            <div className="p-3 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-1.5 font-bold text-slate-900 text-sm">
                <button
                  onClick={() => setIsLeftSidebarOpen(false)}
                  className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded transition-colors"
                  title="Collapse Sidebar"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span>Inbox</span>
              </div>
            </div>

            {/* Folder list */}
            <div className="p-2 space-y-1">
              {/* All Conversations */}
              <button
                onClick={() => {
                  setActiveChannelFolder('all');
                  setInternalSelectedId('');
                }}
                className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg font-medium transition-colors text-left cursor-pointer ${activeChannelFolder === 'all'
                  ? 'bg-[#eff6ff] text-[#2563eb] font-semibold'
                  : 'text-slate-700 hover:bg-slate-100'
                  }`}
              >
                <div className="flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-[#2563eb]" />
                  <span>All Conversations</span>
                </div>
                <span className="min-w-4 h-4 px-1 rounded-full bg-[#2563eb] text-white text-[10px] font-bold flex items-center justify-center">
                  {allConversations.length}
                </span>
              </button>

              {/* CHANNELS Section */}
              <div className="pt-3 pb-1 px-2.5 flex items-center justify-between text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                <span>CHANNELS</span>
                <button
                  onClick={() => setShowAddChannelModal(true)}
                  className="text-slate-400 hover:text-slate-600 p-0.5 rounded"
                  title="Add Channel"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* WhatsApp Channels Tree */}
              <div className="space-y-0.5">
                <div
                  onClick={() => {
                    setIsWhatsAppExpanded(!isWhatsAppExpanded);
                    setActiveChannelFolder('whatsapp');
                    setInternalSelectedId('');
                  }}
                  className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg text-slate-700 font-medium hover:bg-slate-50 cursor-pointer transition-colors ${activeChannelFolder === 'whatsapp' ? 'bg-[#eff6ff] text-[#2563eb] font-semibold' : ''
                    }`}
                >
                  <div className="flex items-center gap-2">
                    {/* WhatsApp Icon */}
                    <svg viewBox="0 0 24 24" className="w-4 h-4 fill-[#25d366]" xmlns="http://www.w3.org/2000/svg">
                      <path d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38c1.45.79 3.08 1.21 4.74 1.21 5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.816 9.816 0 0 0 12.04 2zm.01 1.67c2.2 0 4.26.86 5.82 2.42a8.185 8.185 0 0 1 2.41 5.82c0 4.54-3.7 8.24-8.24 8.24-1.42 0-2.82-.37-4.06-1.08l-.29-.17-3.12.82.83-3.04-.19-.3a8.17 8.17 0 0 1-1.26-4.47c0-4.54 3.7-8.24 8.24-8.24zm4.52 11.66c-.25-.13-1.47-.72-1.7-.81-.23-.08-.39-.13-.56.13-.17.25-.64.81-.79.97-.14.17-.29.19-.54.06-.25-.13-1.07-.39-2.03-1.25-.75-.67-1.26-1.5-1.41-1.75-.15-.25-.02-.39.11-.51.11-.11.25-.29.38-.44.13-.14.17-.25.25-.42.08-.17.04-.31-.02-.44-.06-.13-.56-1.35-.77-1.85-.2-.49-.41-.42-.56-.43h-.48c-.17 0-.44.06-.67.31-.23.25-.87.85-.87 2.08 0 1.23.9 2.42 1.02 2.59.13.17 1.76 2.69 4.27 3.77.6.26 1.06.41 1.43.53.6.19 1.15.16 1.58.1.48-.07 1.47-.6 1.68-1.18.21-.58.21-1.07.15-1.18-.06-.11-.21-.18-.46-.3z" />
                    </svg>
                    <span>WhatsApp</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-1.5 py-0.2 rounded-full">
                      {whatsappChannels.length}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setIsWhatsAppExpanded(!isWhatsAppExpanded);
                      }}
                      className="p-0.5 hover:bg-slate-200/60 rounded cursor-pointer"
                      title={isWhatsAppExpanded ? "Collapse" : "Expand"}
                    >
                      {isWhatsAppExpanded ? (
                        <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Sub Accounts */}
                {isWhatsAppExpanded && (
                  <div className="pl-5 pr-2 space-y-0.5 text-[11px]">
                    {isLoadingChannels ? (
                      <div className="py-2 px-2 text-[11px] text-slate-400 animate-pulse flex items-center gap-1.5">
                        <div className="w-1.5 h-1.5 rounded-full bg-slate-300"></div>
                        <span>Loading channels...</span>
                      </div>
                    ) : channelsError && whatsappChannels.length === 0 ? (
                      <ErrorState
                        compact
                        error={channelsError}
                        title="Couldn't load channels"
                        onRetry={fetchWhatsAppChannels}
                      />
                    ) : whatsappChannels.length === 0 ? (
                      <button
                        onClick={() => setShowAddChannelModal(true)}
                        className="w-full text-left py-1.5 px-2 text-[11px] text-slate-400 hover:text-[#2563eb] hover:bg-blue-50/50 rounded-md transition-colors flex items-center gap-1.5 cursor-pointer"
                      >
                        <Plus className="w-3 h-3" />
                        <span>Connect WhatsApp</span>
                      </button>
                    ) : (
                      whatsappChannels.map((channel) => {
                        const folderKey = `whatsapp-${channel.id}`;
                        const isSelected = activeChannelFolder === folderKey;
                        const displayName = channel.verified_name || 'WhatsApp Account';
                        const displayPhone = channel.phoneNumber || '';
                        const formattedLabel = displayPhone && !displayName.includes(displayPhone)
                          ? `${displayName} - ${displayPhone}`
                          : displayName;

                        return (
                          <button
                            key={channel.id}
                            onClick={() => {
                              setActiveChannelFolder(folderKey);
                              setInternalSelectedId('');
                            }}
                            title={`${displayName}${displayPhone ? ` (${displayPhone})` : ''}`}
                            className={`w-full flex items-center justify-between py-1.5 px-2 rounded-md transition-colors text-left truncate cursor-pointer ${isSelected
                              ? 'text-[#2563eb] bg-[#eff6ff] font-semibold'
                              : 'text-slate-600 hover:bg-slate-50'
                              }`}
                          >
                            <span className="truncate flex items-center gap-1.5">
                              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${channel.isActive !== false ? 'bg-emerald-500' : 'bg-slate-300'}`}></span>
                              <span className="truncate">• {formattedLabel}</span>
                            </span>
                          </button>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            </div>
          </aside>
        ) : (
          <button
            onClick={() => setIsLeftSidebarOpen(true)}
            className="w-7 bg-white border-r border-slate-200 flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-50 cursor-pointer shrink-0"
            title="Open Inbox Navigation"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        )}

        {/* ====================================================== */}
        {/* PANE 2: CONVERSATION LIST                              */}
        {/* ====================================================== */}
        <div className="w-[280px] md:w-[310px] bg-white border-r border-slate-200 flex flex-col shrink-0 h-full select-none">
          {/* Top Search Bar & New Contact Add Button */}
          <div className="p-3 pb-2 flex items-center gap-2 border-b border-slate-100">
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search conversations..."
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-[#2563eb] focus:ring-1 focus:ring-[#2563eb] transition-all"
              />
            </div>
            {/* New contact add button */}
            <button
              onClick={openNewContactModal}
              className="w-8 h-8 rounded-lg bg-[#eff6ff] hover:bg-[#dbeafe] text-[#2563eb] border border-[#bfdbfe] flex items-center justify-center shrink-0 transition-colors cursor-pointer"
              title="Add New Contact / Conversation"
            >
              <Plus className="w-4 h-4 stroke-[2.5]" />
            </button>
          </div>

          {/* Filter Tabs: All (count), Mine */}
          <div className="px-3 py-2 flex items-center gap-2 border-b border-slate-100 text-xs">
            <button
              onClick={() => setFilterTab('all')}
              className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors cursor-pointer ${filterTab === 'all'
                ? 'bg-[#eff6ff] text-[#2563eb] border border-[#bfdbfe]'
                : 'text-slate-600 hover:bg-slate-100 border border-transparent'
                }`}
            >
              All ({allConversations.length})
            </button>
            <button
              onClick={() => setFilterTab('mine')}
              className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors cursor-pointer ${filterTab === 'mine'
                ? 'bg-[#eff6ff] text-[#2563eb] border border-[#bfdbfe]'
                : 'text-slate-600 hover:bg-slate-100 border border-transparent'
                }`}
            >
              Mine
            </button>
          </div>

          {/* Conversation List Cards */}
          <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
            {customersError && customerList.length > 0 && !isLoadingCustomers && (
              <div role="alert" className="px-3 py-2 bg-red-50 text-[11px] text-red-700 flex items-center justify-between gap-2">
                <span className="truncate">Couldn&apos;t refresh customers: {customersError.message}</span>
                <button type="button" onClick={fetchCustomers} className="font-semibold underline cursor-pointer shrink-0">
                  Retry
                </button>
              </div>
            )}
            {isLoadingCustomers ? (
              <div className="p-8 text-center text-slate-400 text-xs flex flex-col items-center justify-center gap-2">
                <div className="w-5 h-5 border-2 border-slate-300 border-t-[#2563eb] rounded-full animate-spin"></div>
                <span className="text-[11px] text-slate-500">Loading customers...</span>
              </div>
            ) : customersError && customerList.length === 0 ? (
              <ErrorState
                error={customersError}
                title="Couldn't load customers"
                onRetry={fetchCustomers}
                retrying={isLoadingCustomers}
              />
            ) : filteredConversations.length === 0 ? (
              <div className="p-8 text-center text-slate-400 text-xs flex flex-col items-center justify-center gap-3">
                <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-400">
                  <User className="w-5 h-5" />
                </div>
                <div>
                  <p className="font-bold text-slate-700 text-xs mb-0.5">No customers yet</p>
                  <p className="text-[11px] text-slate-400 max-w-[180px] mx-auto">
                    Click the + button above to register your first customer contact.
                  </p>
                </div>
                <button
                  onClick={openNewContactModal}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#eff6ff] hover:bg-[#dbeafe] text-[#2563eb] border border-[#bfdbfe] rounded-lg text-xs font-semibold cursor-pointer transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Customer</span>
                </button>
              </div>
            ) : (
              filteredConversations.map((conv) => {
                const isSelected = conv.id === activeConv?.id;
                const isNew = conv.unreadCount > 0;
                const custChannel = conv.customer.channelId
                  ? whatsappChannels.find((ch) => ch.id === conv.customer.channelId)
                  : null;

                return (
                  <div
                    key={conv.id}
                    onClick={() => handleSelectConversation(conv.id)}
                    className={`p-3 cursor-pointer transition-colors text-left relative ${isSelected
                      ? 'bg-[#eff6ff]/70 border-l-4 border-l-[#2563eb]'
                      : 'hover:bg-slate-50/80 bg-white border-l-4 border-l-transparent'
                      }`}
                  >
                    {/* Name and Time */}
                    <div className="flex items-center justify-between gap-1 mb-1">
                      <span className="font-bold text-xs text-slate-900 truncate">
                        {conv.customer.name}
                      </span>
                      <span className="text-[11px] text-slate-400 shrink-0 font-medium">
                        {conv.updatedAt}
                      </span>
                    </div>

                    {/* Last message preview with Channel Icon and Read/Unread badge */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0 flex-1">
                        {renderChannelIcon(conv.channel)}
                        {conv.lastMessage?.sender === 'agent' && (
                          <span
                            className="shrink-0 flex items-center"
                            title={`Status: ${getMessageStatusName(conv.lastMessage.status)} (${normalizeMessageStatus(conv.lastMessage.status)})`}
                          >
                            {(() => {
                              const norm = normalizeMessageStatus(conv.lastMessage.status);
                              if (norm === MessageStatus.READ) {
                                return <CheckCheck className="w-3.5 h-3.5 text-sky-500" />;
                              }
                              if (norm === MessageStatus.DELIVERED) {
                                return <CheckCheck className="w-3.5 h-3.5 text-slate-400" />;
                              }
                              if (norm === MessageStatus.FAILED) {
                                return <AlertCircle className="w-3.5 h-3.5 text-red-500" />;
                              }
                              return <Check className="w-3.5 h-3.5 text-slate-400" />;
                            })()}
                          </span>
                        )}
                        <p className="text-xs text-slate-500 truncate leading-snug">
                          {(() => {
                            const lm = conv.lastMessage;
                            if (!lm) return conv.customer.phone || 'No messages yet';
                            if (
                              lm.text &&
                              !lm.text.match(/^\[(Image|Video|Audio|Document|Voice)\](\s*(No caption|attachment)?)?$/i) &&
                              lm.text !== '[Image] No caption' &&
                              lm.text !== '[Video] No caption' &&
                              lm.text.trim() !== ''
                            ) {
                              return lm.text;
                            }
                            const mType = (lm.mediaType || lm.type || '').toLowerCase();
                            if (mType === 'image') return '📷 Photo';
                            if (mType === 'video') return '🎥 Video';
                            if (mType === 'audio' || mType === 'voice') return '🎵 Voice note';
                            if (mType === 'document') return '📄 Document';
                            if (lm.mediaUrl) return '📎 Attachment';
                            return lm.text || (conv.customer.phone ? conv.customer.phone : 'No messages yet');
                          })()}
                        </p>
                      </div>
                      {isNew && (
                        <span className="text-[9px] font-bold text-white bg-[#2563eb] px-1.5 py-0.5 rounded-md tracking-wider uppercase shrink-0 shadow-2xs">
                          NEW
                        </span>
                      )}
                    </div>

                    {/* Channel Tag if in All folder */}
                    {activeChannelFolder === 'all' && custChannel && (
                      <div className="mt-1 flex items-center gap-1 text-[10px] text-slate-400 font-medium truncate">
                        <span className="w-1 h-1 rounded-full bg-emerald-500 shrink-0"></span>
                        <span className="truncate">{custChannel.verified_name || 'WhatsApp'}</span>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* ====================================================== */}
        {/* PANE 3: CHAT WINDOW                                    */}
        {/* ====================================================== */}
        <div className="flex-1 flex flex-col bg-[#f8fafc] min-w-0 h-full border-r border-slate-200">
          {activeConv ? (
            <>
              {/* Chat Header */}
              <div className="bg-white px-5 py-3 border-b border-slate-200 flex items-center justify-between shrink-0 shadow-2xs z-10">
                <div className="flex items-center gap-2.5">
                  {/* Channel Tag */}
                  <span className="text-[10px] font-bold text-[#0284c7] bg-[#e0f2fe] border border-[#bae6fd] px-2 py-0.5 rounded uppercase tracking-wider flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#0284c7]"></span>
                    WHATSAPP
                  </span>
                  <h2 className="font-bold text-slate-900 text-sm leading-tight">
                    {activeConv.customer.name} {activeConv.customer.phone ? `(${activeConv.customer.phone})` : ''}
                  </h2>
                </div>

                {/* Header Action Buttons (Live SSE Status & Sync) */}
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border ${isRealtimeConnected
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200 shadow-2xs'
                        : 'bg-amber-50 text-amber-700 border-amber-200'
                      }`}
                    title={isRealtimeConnected ? 'Real-time live sync active via SSE' : 'Connecting to live SSE stream...'}
                  >
                    <span
                      className={`w-2 h-2 rounded-full ${isRealtimeConnected ? 'bg-emerald-500 animate-pulse' : 'bg-amber-400'
                        }`}
                    />
                    <span>{isRealtimeConnected ? 'Live Sync' : 'Connecting...'}</span>
                  </span>

                  <button
                    type="button"
                    onClick={handleManualSync}
                    disabled={isSyncingMessages}
                    title="Sync latest messages from WhatsApp / Database"
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 hover:border-[#bfdbfe] bg-white hover:bg-[#eff6ff] text-slate-600 hover:text-[#2563eb] text-xs font-semibold shadow-2xs transition-all cursor-pointer active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isSyncingMessages ? 'animate-spin text-[#2563eb]' : 'text-slate-500'}`} />
                    <span>{isSyncingMessages ? 'Syncing...' : 'Sync'}</span>
                  </button>
                </div>
              </div>

              {messagesLoadError?.convId === activeConv.id && activeConv.messages.length > 0 && (
                <div role="alert" className="px-4 py-2 bg-red-50 border-b border-red-100 text-[11px] text-red-700 flex items-center justify-between gap-2">
                  <span className="truncate">Couldn&apos;t refresh messages: {messagesLoadError.error.message}</span>
                  <button
                    type="button"
                    onClick={() => fetchMessagesForCustomer(Number(activeConv.customer.id))}
                    className="font-semibold underline cursor-pointer shrink-0"
                  >
                    Retry
                  </button>
                </div>
              )}

              {/* Conversation History Thread */}
              {messagesLoadError?.convId === activeConv.id && activeConv.messages.length === 0 ? (
                <div className="flex-1 flex items-center justify-center">
                  <ErrorState
                    error={messagesLoadError.error}
                    title="Couldn't load messages"
                    onRetry={() => fetchMessagesForCustomer(Number(activeConv.customer.id))}
                  />
                </div>
              ) : activeConv.messages.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center p-6 text-slate-400">
                  <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 mb-3">
                    <MessageSquare className="w-6 h-6" />
                  </div>
                  <p className="font-bold text-slate-700 text-sm mb-1">No messages yet</p>
                  <p className="text-xs text-slate-400 max-w-xs">
                    Start a WhatsApp conversation with <span className="font-semibold text-slate-600">{activeConv.customer.name}</span>.
                  </p>
                </div>
              ) : (
                <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">
                  {activeConv.messages.map((msg, index) => {
                    const isAgent = msg.sender === 'agent';
                    // Agent messages show the agent who actually sent them (users.name via senderId), not the logged-in user
                    const senderName = isAgent
                      ? msg.senderName ||
                      (msg.senderId != null && msg.senderId === dbUser?.id ? dbUser?.name : null) ||
                      'Agent'
                      : activeConv.customer.name;

                    // Group message reactions from DB
                    const reactionsList = msg.reactions || [];
                    const rxMap = new Map<string, { count: number; hasMyReaction: boolean }>();
                    for (const rx of reactionsList) {
                      if (!rx.emoji) continue;
                      const cur = rxMap.get(rx.emoji) || { count: 0, hasMyReaction: false };
                      cur.count += 1;
                      if (rx.userId === dbUser?.id || (rx.userId && !rx.customerId)) {
                        cur.hasMyReaction = true;
                      }
                      rxMap.set(rx.emoji, cur);
                    }
                    const groupedReactions: { emoji: string; count: number; hasMyReaction: boolean }[] = [];
                    rxMap.forEach((val, emoji) => {
                      groupedReactions.push({ emoji, count: val.count, hasMyReaction: val.hasMyReaction });
                    });

                    // Format Header Timestamp:
                    // If first message in thread OR on a different day from the previous message,
                    // format as "Feb 18, 02:14 pm". Otherwise, format as "02:14 pm".
                    const prevMsg = index > 0 ? activeConv.messages[index - 1] : undefined;
                    const formattedTimeHeader = (() => {
                      const currDate = msg.createdAt ? new Date(msg.createdAt) : new Date();
                      const timeStr = currDate
                        .toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true })
                        .toLowerCase();

                      if (!prevMsg || !prevMsg.createdAt) {
                        const monthStr = currDate.toLocaleDateString([], { month: 'short' });
                        const dayStr = currDate.getDate();
                        return `${monthStr} ${dayStr}, ${timeStr}`;
                      }

                      const prevDate = new Date(prevMsg.createdAt);
                      const isSameDay =
                        currDate.getFullYear() === prevDate.getFullYear() &&
                        currDate.getMonth() === prevDate.getMonth() &&
                        currDate.getDate() === prevDate.getDate();

                      if (!isSameDay) {
                        const monthStr = currDate.toLocaleDateString([], { month: 'short' });
                        const dayStr = currDate.getDate();
                        return `${monthStr} ${dayStr}, ${timeStr}`;
                      }

                      return timeStr;
                    })();

                    return (
                      <div
                        key={msg.id}
                        className={`flex flex-col ${isAgent ? 'items-end' : 'items-start'} space-y-1 mb-3`}
                      >
                        <div
                          className={`flex items-center gap-1.5 text-xs text-slate-500 font-medium px-1 ${isAgent ? 'justify-end' : 'justify-start'
                            }`}
                        >
                          <span className="font-semibold text-slate-700">{senderName}</span>
                          <span className="text-slate-400">•</span>
                          <span className="text-slate-500">{formattedTimeHeader}</span>
                          {isAgent && (
                            <>
                              <span className="text-slate-300">•</span>
                              {renderMessageStatusIndicator(msg.status, msg.errorCode, msg.errorMessage)}
                            </>
                          )}
                        </div>

                        {/* Message Card Bubble */}
                        <div className="max-w-xl">
                          <div
                            className={`rounded-2xl px-5 py-3.5 text-sm leading-relaxed whitespace-pre-wrap shadow-2xs ${isAgent
                              ? 'bg-[#005cf6] text-white'
                              : 'bg-white border border-slate-200 text-slate-800'
                              }`}
                          >
                            {/* Media Attachment Rendering */}
                            {msg.mediaUrl && (() => {
                              let resolvedMediaUrl = msg.mediaUrl;
                              if (msg.mediaUrl.startsWith('whatsapp-media:')) {
                                const rawId = msg.mediaUrl.replace('whatsapp-media:', '');
                                resolvedMediaUrl = `/api/channels/whatsapp/media/${rawId}?token=${encodeURIComponent(mediaToken ?? '')}`;
                              }
                              const mType = (msg.mediaType || msg.type || '').toLowerCase();

                              const cleanCaption =
                                msg.text &&
                                  !msg.text.match(/^\[(Image|Video|Audio|Document|Voice)\](\s*(No caption|attachment)?)?$/i) &&
                                  msg.text !== '[Image] No caption' &&
                                  msg.text !== '[Video] No caption'
                                  ? msg.text.trim()
                                  : '';

                              const fullTimestamp = (() => {
                                if (msg.createdAt) {
                                  const d = new Date(msg.createdAt);
                                  if (!isNaN(d.getTime())) {
                                    const datePart = d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
                                    const timePart = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }).toLowerCase();
                                    return `${datePart}, ${timePart}`;
                                  }
                                }
                                return formattedTimeHeader || '';
                              })();

                              if (
                                mType === 'image' ||
                                resolvedMediaUrl.match(/\.(jpeg|jpg|gif|png|webp)($|\?)/i) ||
                                (mType !== 'video' && mType !== 'audio' && mType !== 'document' && !resolvedMediaUrl.match(/\.(pdf|doc|docx|mp4|mp3|ogg|wav)($|\?)/i))
                              ) {
                                return (
                                  <div className="mb-2 rounded-xl overflow-hidden max-w-sm border border-black/5 bg-black/5 group relative">
                                    <img
                                      src={resolvedMediaUrl}
                                      alt="Attachment"
                                      className="w-full h-auto max-h-72 object-contain rounded-xl cursor-pointer hover:opacity-95 transition-opacity"
                                      onClick={() =>
                                        setPreviewMedia({
                                          url: resolvedMediaUrl,
                                          type: 'image',
                                          senderName,
                                          timestamp: fullTimestamp,
                                          caption: cleanCaption,
                                        })
                                      }
                                    />
                                  </div>
                                );
                              }

                              if (mType === 'video' || resolvedMediaUrl.match(/\.(mp4|mov|webm)($|\?)/i)) {
                                return (
                                  <div className="mb-2 rounded-xl overflow-hidden max-w-sm">
                                    <video src={resolvedMediaUrl} controls controlsList="nodownload nofullscreen noplaybackrate"
                                      disablePictureInPicture className="w-full rounded-xl max-h-72" />
                                    <div className="flex justify-end pt-1 pr-2">
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setPreviewMedia({
                                            url: resolvedMediaUrl,
                                            type: 'video',
                                            senderName,
                                            timestamp: fullTimestamp,
                                            caption: cleanCaption,
                                          })
                                        }
                                        className={`text-[10px] font-semibold flex items-center gap-1 cursor-pointer hover:underline ${isAgent ? 'text-white/80 hover:text-white' : 'text-blue-600'}`}
                                      >
                                        <ExternalLink className="w-3 h-3" /> Expand Video
                                      </button>
                                    </div>
                                  </div>
                                );
                              }

                              if (mType === 'audio' || mType === 'voice' || resolvedMediaUrl.match(/\.(mp3|ogg|wav|m4a|aac)($|\?)/i)) {
                                return (
                                  <div className="mb-2 rounded-xl p-1">
                                    <audio src={resolvedMediaUrl} controls className="w-full min-w-[220px]" />
                                  </div>
                                );
                              }

                              const docTitle = msg.text && msg.text.startsWith('[Document]') ? msg.text.replace('[Document]', '').trim() : 'View Document';
                              return (
                                <div
                                  onClick={() =>
                                    setPreviewMedia({
                                      url: resolvedMediaUrl,
                                      type: 'document',
                                      senderName,
                                      timestamp: fullTimestamp,
                                      caption: cleanCaption || docTitle,
                                    })
                                  }
                                  className={`mb-2 p-3 rounded-xl flex items-center gap-3 transition-all cursor-pointer border ${isAgent
                                    ? 'bg-white/15 hover:bg-white/25 border-white/20 text-white'
                                    : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-800'
                                    }`}
                                >
                                  <div className={`p-2 rounded-lg ${isAgent ? 'bg-white/20 text-white' : 'bg-[#eff6ff] text-[#2563eb]'}`}>
                                    <FileText className="w-5 h-5" />
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <p className="font-semibold text-xs truncate">
                                      {docTitle}
                                    </p>
                                    <p className={`text-[10px] ${isAgent ? 'text-white/80' : 'text-slate-400'}`}>Click to preview document</p>
                                  </div>
                                  <Download className={`w-4 h-4 shrink-0 ${isAgent ? 'text-white/80' : 'text-slate-400'}`} />
                                </div>
                              );
                            })()}

                            {msg.text &&
                              !msg.text.match(/^\[(Image|Video|Audio|Document|Voice)\](\s*(No caption|attachment)?)?$/i) &&
                              msg.text !== '[Image] No caption' &&
                              msg.text !== '[Video] No caption' &&
                              msg.text.trim() !== '' && (
                                <p className="break-words">{renderMessageWithLinks(msg.text, isAgent)}</p>
                              )}
                          </div>
                        </div>

                        {/* Reaction Badges & React Button in a clean unified row */}
                        <div className={`flex items-center gap-1.5 mt-1 relative flex-wrap ${isAgent ? 'justify-end' : 'justify-start'}`}>
                          {/* Each Reaction Badge */}
                          {groupedReactions.map((g) => (
                            <button
                              key={g.emoji}
                              type="button"
                              onClick={() => handleToggleReaction(msg.id, g.emoji)}
                              title={g.hasMyReaction ? 'Click to remove your reaction' : 'Click to react'}
                              className={`px-2.5 py-1 min-w-7  rounded-full border shadow-2xs text-xs flex items-center justify-center gap-1 transition-all cursor-pointer hover:scale-110 ${g.hasMyReaction
                                ? 'bg-blue-50 border-blue-300 text-blue-800 font-bold'
                                : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                                }`}
                            >
                              <span>{g.emoji}</span>
                              {g.count > 1 && (
                                <span className="text-[10px] text-slate-500 font-bold">{g.count}</span>
                              )}
                            </button>
                          ))}

                          {/* React Pill Button */}
                          <div className="relative">
                            <button
                              type="button"
                              onClick={(e) => {
                                if (reactionPickerMsgId === msg.id) {
                                  setReactionPickerMsgId(null);
                                  setShowFullReactionPicker(false);
                                } else {
                                  const rect = e.currentTarget.getBoundingClientRect();
                                  // If less than 340px from top of viewport, open downwards
                                  if (rect.top < 340) {
                                    setReactionPickerPlacement('bottom');
                                  } else {
                                    setReactionPickerPlacement('top');
                                  }
                                  setReactionPickerMsgId(msg.id);
                                  setShowFullReactionPicker(false);
                                }
                              }}
                              className="flex items-center gap-1.5 px-3 py-1 rounded-full border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 hover:text-slate-900 text-xs font-medium shadow-2xs transition-all cursor-pointer"
                            >
                              <Smile className="w-3.5 h-3.5 text-slate-400" />
                              <span>React</span>
                            </button>

                            {/* Floating Reaction Picker Popup */}
                            {reactionPickerMsgId === msg.id && (
                              <div
                                ref={reactionPickerRef}
                                className={`absolute ${reactionPickerPlacement === 'bottom'
                                  ? 'top-full mt-1.5'
                                  : 'bottom-full mb-1.5'
                                  } ${isAgent ? 'right-0' : 'left-0'} z-50 animate-in fade-in zoom-in-95`}
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
                                    {['👍', '❤️', '😂', '😮', '😢', '🙏', '🎉', '💡', '🔥'].map((emoji) => (
                                      <button
                                        key={emoji}
                                        type="button"
                                        onClick={() => {
                                          handleToggleReaction(msg.id, emoji);
                                          setReactionPickerMsgId(null);
                                        }}
                                        className="w-7 h-7 rounded-full hover:bg-slate-100 flex items-center justify-center text-sm transition-transform hover:scale-125 cursor-pointer"
                                      >
                                        {emoji}
                                      </button>
                                    ))}
                                    <button
                                      type="button"
                                      onClick={() => setShowFullReactionPicker(true)}
                                      title="More emojis"
                                      className="w-7 h-7 rounded-full hover:bg-blue-50 hover:text-[#2563eb] text-slate-400 flex items-center justify-center text-xs transition-colors cursor-pointer border border-dashed border-slate-200 ml-0.5"
                                    >
                                      <Plus className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>

                      </div>
                    );
                  })}
                  <div ref={messagesEndRef} />
                </div>
              )}

              {/* Composer Box */}
              <div className="bg-white p-3 border-t border-slate-200 shrink-0">
                <div className="border border-slate-200 rounded-xl focus-within:border-[#2563eb] focus-within:ring-1 focus-within:ring-[#2563eb] transition-all bg-white relative">
                  {/* Attachment Preview Bar */}
                  {selectedFile && (
                    <div className="p-2.5 px-3 bg-slate-50 border-b border-slate-200 rounded-t-xl flex items-center justify-between gap-3 animate-in fade-in duration-150">
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        {filePreviewUrl ? (
                          <div className="w-10 h-10 rounded-lg overflow-hidden border border-slate-200 shrink-0 bg-white shadow-2xs">
                            <img src={filePreviewUrl} alt="Preview" className="w-full h-full object-cover" />
                          </div>
                        ) : (
                          <div className="w-10 h-10 rounded-lg bg-[#eff6ff] text-[#2563eb] border border-[#bfdbfe] flex items-center justify-center shrink-0 shadow-2xs">
                            {selectedFile.type.startsWith('video/') ? (
                              <Film className="w-5 h-5" />
                            ) : selectedFile.type.startsWith('audio/') ? (
                              <Music className="w-5 h-5" />
                            ) : (
                              <FileText className="w-5 h-5" />
                            )}
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-bold text-slate-800 truncate leading-tight">
                            {selectedFile.name}
                          </p>
                          <p className="text-[10px] text-slate-500 mt-0.5">
                            {(selectedFile.size / 1024 > 1024
                              ? `${(selectedFile.size / (1024 * 1024)).toFixed(1)} MB`
                              : `${(selectedFile.size / 1024).toFixed(0)} KB`
                            )} • Direct Meta Upload
                          </p>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={handleClearSelectedFile}
                        className="p-1 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-200 transition-colors cursor-pointer"
                        title="Remove attachment"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  )}

                  {/* Textarea */}
                  <textarea
                    rows={3}
                    value={inputMessage}
                    onChange={(e) => setInputMessage(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSend();
                      }
                    }}
                    placeholder={selectedFile ? `Add an optional message / caption for this attachment... (Press Enter to send)` : `Type message to ${activeConv.customer.name}... (Press Enter to send)`}
                    className="w-full px-3 py-2.5 text-xs text-slate-800 placeholder-slate-400 focus:outline-none resize-none bg-transparent rounded-t-xl"
                  />

                  {/* Hidden File Input */}
                  <input
                    ref={fileInputRef}
                    type="file"
                    onChange={handleFileChange}
                    className="hidden"
                    accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv"
                  />

                  {/* Bottom Toolbar */}
                  <div className="px-3 py-2 bg-white border-t border-slate-100 rounded-b-xl flex items-center justify-between">
                    <div className="flex items-center gap-1 text-slate-400">
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        title="Attach file (Direct Meta upload)"
                        className={`p-1.5 rounded-lg transition-colors cursor-pointer ${selectedFile ? 'bg-blue-50 text-[#2563eb]' : 'hover:text-slate-700 hover:bg-slate-100 text-slate-400'
                          }`}
                      >
                        <Paperclip className="w-4 h-4" />
                      </button>

                      <div className="relative" ref={emojiPickerRef}>
                        <button
                          type="button"
                          onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                          title="Insert emoji"
                          className={`p-1.5 rounded-lg transition-colors cursor-pointer ${showEmojiPicker
                            ? 'bg-blue-50 text-[#2563eb]'
                            : 'hover:text-slate-700 hover:bg-slate-100 text-slate-400'
                            }`}
                        >
                          <Smile className="w-4 h-4" />
                        </button>
                        {showEmojiPicker && (
                          <div className="absolute bottom-full left-0 mb-2 z-50 animate-in bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden">
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
                        title="Record voice note"
                        className="p-1.5 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                      >
                        <Mic className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="flex items-center gap-2">
                      {/* Fast Replies Dropdown */}
                      <div className="relative shrink-0" ref={fastRepliesRef}>
                        <button
                          type="button"
                          onClick={() => setShowFastReplies(!showFastReplies)}
                          className="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-[#2563eb] hover:bg-[#eff6ff] flex items-center gap-1 transition-colors cursor-pointer"
                        >
                          <Zap className="w-3.5 h-3.5" />
                          <span>Fast Replies</span>
                          <ChevronDown className="w-3 h-3 ml-0.5" />
                        </button>

                        {showFastReplies && (
                          <div className="absolute right-0 bottom-full mb-2 w-72 bg-white border border-slate-200 rounded-xl shadow-xl p-2 z-50 animate-in fade-in zoom-in-95">
                            <div className="px-2 py-1 border-b border-slate-100 font-bold text-xs text-slate-800 flex items-center justify-between">
                              <span>Saved Fast Replies</span>
                              <Sparkles className="w-3.5 h-3.5 text-[#2563eb]" />
                            </div>
                            <div className="max-h-60 overflow-y-auto divide-y divide-slate-50 mt-1">
                              {fastRepliesList.map((tpl, idx) => (
                                <button
                                  key={idx}
                                  type="button"
                                  onClick={() => {
                                    setInputMessage(tpl.text);
                                    setShowFastReplies(false);
                                  }}
                                  className="w-full p-2 text-left hover:bg-slate-50 rounded-lg transition-colors cursor-pointer group"
                                >
                                  <p className="font-semibold text-xs text-slate-800 group-hover:text-[#2563eb]">
                                    {tpl.title}
                                  </p>
                                  <p className="text-[11px] text-slate-500 truncate mt-0.5">
                                    {tpl.text}
                                  </p>
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Direct Meta Send Button */}
                      <button
                        type="button"
                        onClick={() => handleSend()}
                        disabled={(!inputMessage.trim() && !selectedFile) || isSendingMeta}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#2563eb] hover:bg-[#1d4ed8] disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold shadow-xs transition-all cursor-pointer"
                      >
                        {isSendingMeta ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Send className="w-3.5 h-3.5" />
                        )}
                        <span>{isSendingMeta ? 'Sending via Meta...' : 'Send'}</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8 bg-[#f8fafc] select-none">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-50 to-indigo-100 border border-blue-200/60 text-[#2563eb] flex items-center justify-center mb-4 shadow-sm">
                <MessageSquare className="w-8 h-8 stroke-[1.8]" />
              </div>
              <h3 className="text-base font-bold text-slate-900 mb-1.5">
                No Conversation Selected
              </h3>
              <p className="text-xs text-slate-500 max-w-sm leading-relaxed">
                Select a customer from the list on the left to view message history, customer details, and reply across WhatsApp in real time.
              </p>
            </div>
          )}
        </div>

        {/* ====================================================== */}
        {/* PANE 4: SHOPIFY CONTEXT DESK (RIGHT COLUMN)            */}
        {/* ====================================================== */}
        <div className="w-[300px] lg:w-[330px] bg-white flex flex-col shrink-0 h-full overflow-y-auto select-none border-l border-slate-200">
          {/* Header */}
          <div className="p-3.5 pb-2.5 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-[#96bf48] text-white flex items-center justify-center font-bold text-xs shadow-2xs">
                S
              </div>
              <div>
                <h3 className="font-bold text-xs text-slate-900 leading-tight">
                  DEMO : Shopify Context Desk
                </h3>
                <p className="text-[11px] text-slate-500 truncate max-w-[150px]">
                  omnichannel-support.myshopify.com
                </p>
              </div>
            </div>

            <button
              onClick={() => setShowShopifyConnectModal(true)}
              className="px-2.5 py-1 rounded-lg border border-[#bfdbfe] text-[#2563eb] hover:bg-[#eff6ff] text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer"
            >
              <Plus className="w-3 h-3" />
              <span>Connect</span>
            </button>
          </div>

          {/* Shopify Navigation Tabs: Orders, Catalog Share, Store Setup */}
          <div className="flex items-center border-b border-slate-200 text-xs px-2">
            <button
              onClick={() => setShopifyTab('orders')}
              className={`flex-1 py-2 text-center font-semibold transition-all border-b-2 cursor-pointer ${shopifyTab === 'orders'
                ? 'border-[#2563eb] text-[#2563eb]'
                : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
            >
              Orders
            </button>
            <button
              onClick={() => setShopifyTab('catalog')}
              className={`flex-1 py-2 text-center font-semibold transition-all border-b-2 cursor-pointer ${shopifyTab === 'catalog'
                ? 'border-[#2563eb] text-[#2563eb]'
                : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
            >
              Catalog Share
            </button>
            <button
              onClick={() => setShopifyTab('setup')}
              className={`flex-1 py-2 text-center font-semibold transition-all border-b-2 cursor-pointer ${shopifyTab === 'setup'
                ? 'border-[#2563eb] text-[#2563eb]'
                : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
            >
              Store Setup
            </button>
          </div>

          {/* Tab Content: Orders View */}
          {shopifyTab === 'orders' && (
            !activeConv ? (
              <div className="p-6 flex-1 flex flex-col items-center justify-center text-center text-slate-400 my-auto">
                <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mb-3 shadow-2xs">
                  <User className="w-6 h-6 text-slate-400 stroke-[1.8]" />
                </div>
                <h4 className="font-bold text-slate-800 text-xs mb-1">No Customer Selected</h4>
                <p className="text-[11px] text-slate-400 max-w-[210px] leading-relaxed">
                  Customer profile, Shopify orders, and lifetime stats will appear here when a conversation is opened.
                </p>
              </div>
            ) : (
              <div className="p-3 space-y-4">
                {/* Order Filter search input */}
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={orderSearchQuery}
                    onChange={(e) => setOrderSearchQuery(e.target.value)}
                    placeholder="Filter orders..."
                    className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-[#2563eb] focus:ring-1 focus:ring-[#2563eb] transition-all"
                  />
                </div>

                {/* Customer Profile Accordion */}
                <div className="border border-slate-200 rounded-xl overflow-hidden bg-slate-50/50">
                  <button
                    onClick={() => setIsCustomerProfileOpen(!isCustomerProfileOpen)}
                    className="w-full px-3 py-2.5 flex items-center justify-between text-xs font-bold text-slate-900 bg-white border-b border-slate-100 cursor-pointer"
                  >
                    <span>Customer Profile</span>
                    {isCustomerProfileOpen ? (
                      <ChevronUp className="w-4 h-4 text-slate-400" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-slate-400" />
                    )}
                  </button>

                  {isCustomerProfileOpen && (
                    <div className="p-3 text-xs space-y-2 text-slate-700 bg-white">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500">Channel:</span>
                        <span className="font-semibold text-emerald-700 flex items-center gap-1 truncate max-w-[170px]" title={conversationChannel?.verified_name || 'WhatsApp'}>
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0"></span>
                          <span className="truncate">{conversationChannel?.verified_name || 'Default WhatsApp'}</span>
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500">Name:</span>
                        <span className="font-semibold text-slate-900">
                          {activeConv.customer.name}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500">Phone:</span>
                        <span className="font-semibold text-slate-900 font-mono">
                          {activeConv.customer.phone || 'Not provided'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500">Email:</span>
                        <span className="font-semibold text-slate-900">
                          {activeConv.customer.email || 'Not provided'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500">Lifetime Spend:</span>
                        <span className="font-semibold text-slate-900">
                          ₹0.00 (0 orders)
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Order History Section */}
                <div className="space-y-3">
                  <h4 className="text-xs font-bold text-slate-900">Order History</h4>

                  <div className="p-4 text-center text-slate-400 text-xs border border-dashed border-slate-200 rounded-xl bg-slate-50/50 flex flex-col items-center justify-center gap-2 py-6">
                    <ShoppingBag className="w-5 h-5 text-slate-300" />
                    <div>
                      <p className="font-semibold text-slate-600 text-xs">No orders found</p>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        No Shopify orders synced yet for this customer.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )
          )}

          {/* Tab Content: Catalog Share */}
          {shopifyTab === 'catalog' && (
            <div className="p-3 space-y-3 text-xs">
              <p className="text-slate-500">
                Share product links or interactive buy cards directly to WhatsApp:
              </p>
              <div className="space-y-2">
                {[
                  { name: 'Organic Cotton Oversized Hoodie', price: '$89.00', stock: 'In Stock' },
                  { name: 'Stainless Steel Thermal Bottle', price: '$39.50', stock: 'In Stock' },
                  { name: 'Eco-friendly Canvas Tote Bag', price: '$45.00', stock: 'Low Stock' },
                ].map((prod, i) => (
                  <div
                    key={i}
                    className="p-2.5 bg-white border border-slate-200 rounded-xl flex items-center justify-between"
                  >
                    <div>
                      <p className="font-bold text-slate-900 text-xs">{prod.name}</p>
                      <p className="text-[11px] text-slate-500">
                        {prod.price} • <span className="text-emerald-600 font-semibold">{prod.stock}</span>
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        setInputMessage(`Check out ${prod.name} (${prod.price}): https://omnichannel-support.myshopify.com/products/${prod.name.toLowerCase().replace(/\s+/g, '-')}`);
                      }}
                      className="px-2 py-1 bg-[#eff6ff] text-[#2563eb] font-semibold text-[11px] rounded-lg hover:bg-[#dbeafe] flex items-center gap-1 cursor-pointer"
                    >
                      <Share2 className="w-3 h-3" />
                      <span>Send</span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tab Content: Store Setup */}
          {shopifyTab === 'setup' && (
            <div className="p-3 space-y-3 text-xs">
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                <div className="flex items-center gap-2">
                  <Store className="w-4 h-4 text-[#2563eb]" />
                  <span className="font-bold text-slate-900">Shopify Store Details</span>
                </div>
                <div className="text-[11px] space-y-1 text-slate-600">
                  <p><strong>Domain:</strong> omnichannel-support.myshopify.com</p>
                  <p><strong>Sync Status:</strong> Realtime Webhooks Active</p>
                  <p><strong>Currency:</strong> USD ($)</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ======================================================== */}
      {/* MODALS: ADD CHANNEL, NEW CONTACT, SHOPIFY CONNECT        */}
      {/* ======================================================== */}

      {/* Add Channel Modal */}
      <AddChannelModal
        isOpen={showAddChannelModal}
        onClose={() => setShowAddChannelModal(false)}
        onSuccess={() => {
          fetchWhatsAppChannels();
        }}
      />

      {/* New Contact Modal */}
      <Modal
        isOpen={showNewContactModal}
        onClose={() => setShowNewContactModal(false)}
        title="Add New Customer"
        icon={<User className="w-4 h-4 text-[#2563eb]" />}
        maxWidth="sm"
      >
        <form onSubmit={handleCreateContact} className="space-y-3 text-xs">
          {/* Channel Selector */}
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Assigned Channel</label>
            {whatsappChannels.length > 0 ? (
              <select
                value={newContactChannelId || (whatsappChannels[0]?.id ?? '')}
                onChange={(e) => setNewContactChannelId(Number(e.target.value))}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 font-medium focus:outline-none focus:bg-white focus:ring-1 focus:ring-[#2563eb]"
              >
                {whatsappChannels.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.verified_name || 'WhatsApp'} {c.phoneNumber ? `(${c.phoneNumber})` : ''}
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
                  className="font-bold underline text-amber-900 hover:text-amber-950 cursor-pointer ml-2"
                >
                  Connect Channel
                </button>
              </div>
            )}
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">Customer Name</label>
            <input
              type="text"
              required
              disabled={whatsappChannels.length === 0}
              value={newContactName}
              onChange={(e) => setNewContactName(e.target.value)}
              placeholder="e.g. Rachel Adams"
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#2563eb] disabled:bg-slate-100 disabled:cursor-not-allowed"
            />
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">WhatsApp Phone Number</label>
            <input
              type="text"
              required
              disabled={whatsappChannels.length === 0}
              value={newContactPhone}
              onChange={(e) => setNewContactPhone(e.target.value)}
              placeholder="e.g. 919876543210 (digits with country code, without +)"
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#2563eb] disabled:bg-slate-100 disabled:cursor-not-allowed"
            />
            <p className="text-[11px] text-slate-400 mt-1">
              Enter digits only with country code (e.g. 919876543210). Stored cleanly without +.
            </p>
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
              disabled={whatsappChannels.length === 0}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${whatsappChannels.length === 0
                ? 'bg-slate-200 text-slate-400 cursor-not-allowed border border-slate-200 shadow-none'
                : 'text-white bg-[#2563eb] hover:bg-[#1d4ed8] cursor-pointer shadow-xs'
                }`}
              title={whatsappChannels.length === 0 ? 'Please connect a WhatsApp channel first' : undefined}
            >
              Create Customer
            </button>
          </div>
        </form>
      </Modal>

      {/* Shopify Connect Modal */}
      <Modal
        isOpen={showShopifyConnectModal}
        onClose={() => setShowShopifyConnectModal(false)}
        title="Connect Shopify Store"
        icon={<ShoppingBag className="w-4 h-4 text-[#96bf48]" />}
        maxWidth="sm"
      >
        <div className="space-y-3 text-xs">
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Store URL</label>
            <input
              type="text"
              defaultValue="omnichannel-support.myshopify.com"
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#2563eb]"
            />
          </div>

          <button
            onClick={() => setShowShopifyConnectModal(false)}
            className="w-full py-2 bg-[#96bf48] hover:bg-[#83aa3d] text-white font-semibold rounded-lg transition-colors cursor-pointer"
          >
            Connect Store
          </button>
        </div>
      </Modal>

      {/* Media Preview Modal */}
      {previewMedia && (
        <Modal
          isOpen={!!previewMedia}
          onClose={() => setPreviewMedia(null)}
          title={
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-bold text-slate-900 text-sm">
                {previewMedia.senderName || 'Attachment Preview'}
              </span>
              {previewMedia.timestamp && (
                <>
                  <span className="text-slate-300">•</span>
                  <span className="text-xs font-normal text-slate-500">
                    {previewMedia.timestamp}
                  </span>
                </>
              )}
            </div>
          }
          icon={
            previewMedia.type === 'image' ? (
              <ImageIcon className="w-4 h-4 text-[#2563eb]" />
            ) : previewMedia.type === 'video' ? (
              <Film className="w-4 h-4 text-[#2563eb]" />
            ) : previewMedia.type === 'audio' ? (
              <Music className="w-4 h-4 text-[#2563eb]" />
            ) : (
              <FileText className="w-4 h-4 text-[#2563eb]" />
            )
          }
          maxWidth={
            previewMedia.type === 'image' || previewMedia.type === 'video' || previewMedia.type === 'document'
              ? '3xl'
              : 'md'
          }
        >
          <div className="space-y-4">
            {previewMedia.type === 'image' && (
              <div className="w-full max-h-[70vh] flex items-center justify-center bg-slate-950/5 rounded-xl overflow-hidden p-2 border border-slate-100">
                <img
                  src={previewMedia.url}
                  alt={previewMedia.caption || 'Attachment Preview'}
                  className="max-h-[65vh] w-auto max-w-full object-contain rounded-lg shadow-xs"
                />
              </div>
            )}

            {previewMedia.type === 'video' && (
              <div className="w-full max-h-[70vh] flex items-center justify-center bg-black rounded-xl overflow-hidden shadow-xs">
                <video
                  src={previewMedia.url}
                  controls
                  autoPlay
                  className="max-h-[65vh] w-full object-contain rounded-lg"
                />
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
                  <iframe
                    src={previewMedia.url}
                    title="Document Preview"
                    className="w-full h-[65vh] rounded-xl border border-slate-200 bg-white"
                  />
                ) : (
                  <div className="p-8 text-center bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                    <FileText className="w-12 h-12 text-[#2563eb] mx-auto opacity-80" />
                    <p className="text-sm font-semibold text-slate-800">{previewMedia.caption || 'Document File'}</p>
                    <p className="text-xs text-slate-500">Document preview ready for download or external viewing.</p>
                  </div>
                )}
              </div>
            )}

            {/* Modal Footer Actions */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-3 border-t border-slate-100 text-xs">
              {previewMedia.caption ? (
                <div className="bg-slate-50 border border-slate-200/80 rounded-xl px-3.5 py-2 max-w-lg">
                  <p className="text-xs text-slate-800 leading-relaxed font-normal break-words">
                    {renderMessageWithLinks(previewMedia.caption, false)}
                  </p>
                </div>
              ) : (
                <div />
              )}
              <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
                <a
                  href={previewMedia.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-1.5 text-slate-600 hover:bg-slate-100 rounded-lg flex items-center gap-1.5 font-medium transition-colors cursor-pointer border border-slate-200"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Open in Tab
                </a>
                <a
                  href={previewMedia.url}
                  download
                  className="px-3 py-1.5 bg-[#2563eb] hover:bg-[#1d4ed8] text-white rounded-lg flex items-center gap-1.5 font-semibold transition-colors shadow-xs cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download
                </a>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
