export type ChannelType = 'whatsapp' | 'instagram' | 'messenger' | 'sms' | 'email' | 'webchat';

export interface RecentOrderItem {
  id: string;
  orderNumber: string;
  timeAgo: string;
  total: number;
  status: 'Shipped' | 'Delivered' | 'Pending' | 'Cancelled' | 'Processing';
  itemsSummary?: string;
  trackingNumber?: string;
  courier?: string;
}

export interface Customer {
  id: string;
  channelId?: number | null;
  name: string;
  phone: string;
  email: string;
  avatar: string;
  shopifyCustomerId?: string;
  customerSince?: string;
  address?: string;
  language?: string;
  totalOrders: number;
  totalSpent: number;
  currency: string;
  points?: number;
  tags: string[];
  optInStatus: {
    whatsapp: boolean;
    sms: boolean;
    email: boolean;
  };
  cart?: {
    itemCount: number;
    value: number;
    abandonedAt?: string;
    items: Array<{
      id: string;
      title: string;
      price: number;
      quantity: number;
      image: string;
    }>;
  };
  lastOrder?: {
    orderNumber: string;
    date: string;
    total: number;
    status: 'Paid' | 'Pending' | 'Shipped' | 'Delivered' | 'Cancelled';
    trackingNumber?: string;
    itemsCount: number;
  };
  recentOrders?: RecentOrderItem[];
}

export enum MessageStatus {
  SENT = 0,
  DELIVERED = 1,
  READ = 2,
  FAILED = 3,
}

export type MessageStatusType = MessageStatus;
export type MessageStatusName = 'sent' | 'delivered' | 'read' | 'failed';

export const MESSAGE_STATUS_NAMES: Record<MessageStatus, MessageStatusName> = {
  [MessageStatus.SENT]: 'sent',
  [MessageStatus.DELIVERED]: 'delivered',
  [MessageStatus.READ]: 'read',
  [MessageStatus.FAILED]: 'failed',
};

export const MESSAGE_STATUS_VALUES: Record<string, MessageStatus> = {
  sent: MessageStatus.SENT,
  delivered: MessageStatus.DELIVERED,
  read: MessageStatus.READ,
  failed: MessageStatus.FAILED,
};

export function normalizeMessageStatus(status: unknown): MessageStatus {
  if (typeof status === 'number') {
    if (status in MessageStatus) return status as MessageStatus;
    return MessageStatus.SENT;
  }
  if (typeof status === 'string') {
    const lower = status.toLowerCase();
    if (lower in MESSAGE_STATUS_VALUES) {
      return MESSAGE_STATUS_VALUES[lower];
    }
  }
  return MessageStatus.SENT;
}

export function getMessageStatusName(status: unknown): MessageStatusName {
  const normalized = normalizeMessageStatus(status);
  return MESSAGE_STATUS_NAMES[normalized] || 'sent';
}

export interface MessageReactionItem {
  id: number;
  emoji: string;
  userId?: number | null;
  customerId?: number | null;
  createdAt?: string | Date;
}

export interface Message {
  id: string;
  sender: 'customer' | 'agent' | 'bot';
  senderId?: number | null; // users.id of the agent who sent it
  senderName?: string | null; // users.name of the agent who sent it
  channel: ChannelType;
  text: string;
  timestamp: string;
  status: MessageStatus | MessageStatusName | number;
  errorCode?: number | null;
  /** Human-readable failure reason (set when a send fails in the UI). */
  errorMessage?: string | null;
  type?: 'text' | 'template' | 'image' | 'video' | 'audio' | 'document' | 'voice' | 'order_card' | 'cart_card';
  mediaType?: string;
  mediaUrl?: string;
  voiceDuration?: string;
  metaMessageId?: string;
  isInternalNote?: boolean;
  /** Action the AI agent performed with this reply, e.g. 'catalog lookup' */
  aiAction?: string | null;
  reactions?: MessageReactionItem[];
  createdAt?: string | Date;
  templateCard?: {
    templateName: string;
    headerIcon?: string;
    title: string;
    details: string[];
    eta?: string;
    courierInfo?: string;
  };
  templateButtons?: Array<{
    text: string;
    actionType: 'url' | 'quick_reply' | 'call';
  }>;
  cardData?: Record<string, unknown>;
}

export interface Conversation {
  id: string;
  customer: Customer;
  channel: ChannelType;
  status: 'open' | 'pending' | 'resolved';
  unreadCount: number;
  lastMessage?: Message;
  messages: Message[];
  assignedAgent?: string;
  isPinned?: boolean;
  slaMinutesRemaining?: number;
  tags: string[];
  updatedAt: string;
}

export interface Campaign {
  id: string;
  name: string;
  channel: ChannelType;
  type: 'broadcast' | 'retargeting' | 'promotional';
  status: 'active' | 'scheduled' | 'draft' | 'completed';
  sentCount: number;
  deliveredCount: number;
  readCount: number;
  clickedCount: number;
  revenue: number;
  scheduledFor?: string;
  createdAt: string;
  templateName: string;
  audienceFilter: string;
}

export interface AutomationFlow {
  id: string;
  title: string;
  description: string;
  triggerType: 'abandoned_cart' | 'order_placed' | 'order_shipped' | 'cod_verify' | 'back_in_stock' | 'welcome';
  channel: ChannelType;
  isActive: boolean;
  totalTriggered: number;
  recoveredRevenue: number;
  conversionRate: number;
  steps: Array<{
    id: string;
    delay: string;
    templateName: string;
    channel: ChannelType;
    condition?: string;
  }>;
}

export interface WhatsAppTemplate {
  id: string;
  name: string;
  category: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';
  language: string;
  status: 'APPROVED' | 'PENDING' | 'REJECTED';
  headerType?: 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT';
  headerText?: string;
  bodyText: string;
  footerText?: string;
  buttons?: Array<{
    type: 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER';
    text: string;
    url?: string;
  }>;
  lastUpdated: string;
}
