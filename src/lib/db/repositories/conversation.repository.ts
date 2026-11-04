import { db } from "..";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import {
  tickets,
  customers,
  channels,
  users,
  messages,
  ConversationHandler,
  TicketStatus,
  MessageStatus,
  ChannelStatus,
  opensServiceWindow,
  type Ticket,
  type Message,
  type Customer,
  type Channel,
} from "../schema";

/**
 * One row in the inbox conversation list. A contact without a ticket is listed too, with
 * `hasConversation: false` and `id` = -customerId (never a real ticket id); its first message creates the ticket.
 */
export interface ConversationListItem {
  id: number;
  hasConversation: boolean;
  ticketNumber: string;
  status: string | null;
  handledBy: string;
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
  lastMessageAt: Date | null;
  createdAt: Date;
  resolvedAt: Date | null;
  unreadCount: number;
  lastReceivedMessageAt: Date | null;
  lastMessage: {
    senderType: string;
    mediaType: string | null;
    status: number;
    metadata: unknown;
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
    /** WhatsApp marketing consent for this contact on its number */
    isOptedOut: boolean;
    createdAt: Date;
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

export type ConversationUpdate = Partial<{
  handledBy: string;
  needsHuman: boolean;
  assigneeId: number | null;
  status: string;
  tags: string[];
  aiSummary: string | null;
  aiIntent: string | null;
  aiConfidence: number | null;
  aiModel: string | null;
  aiSuggestions: string[];
  language: string | null;
}>;

export class ConversationRepository {
  async findById(id: number, organizationId: number): Promise<Ticket | null> {
    const [ticket] = await db
      .select()
      .from(tickets)
      .where(and(eq(tickets.id, id), eq(tickets.organizationId, organizationId)))
      .limit(1);

    return ticket || null;
  }

  /**
   * Latest conversation for a customer; creates one when the customer has none yet.
   */
  async ensureForCustomer(organizationId: number, customerId: number, channelId?: number | null): Promise<Ticket> {
    const [existing] = await db
      .select()
      .from(tickets)
      .where(and(eq(tickets.organizationId, organizationId), eq(tickets.customerId, customerId)))
      .orderBy(desc(tickets.createdAt))
      .limit(1);

    if (existing) return existing;

    const [created] = await db
      .insert(tickets)
      .values({
        organizationId,
        customerId,
        channelId: channelId ?? null,
        ticketNumber: `C-${customerId}-${Date.now()}`,
        status: TicketStatus.OPEN,
      })
      .returning();

    return created;
  }

  /**
   * Keeps the conversation in sync with a newly stored message:
   * last message preview, reopening on a customer reply, and handing over to the human agent who replied.
   */
  async recordMessage(
    ticket: Ticket,
    message: Pick<Message, "senderType" | "senderId" | "textContent" | "isInternalNote" | "createdAt">
  ): Promise<void> {
    const now = new Date();
    const updates: Partial<typeof tickets.$inferInsert> = { updatedAt: now };

    if (!message.isInternalNote) {
      updates.lastMessageText = message.textContent ?? null;
      updates.lastMessageAt = message.createdAt ?? now;
    }

    if (message.senderType === "customer" && (ticket.status === TicketStatus.RESOLVED || ticket.status === TicketStatus.CLOSED)) {
      updates.status = TicketStatus.OPEN;
      updates.resolvedAt = null;
    }

    // A human agent replying takes the conversation over from the AI agent
    if (message.senderType === "agent" && !message.isInternalNote && ticket.handledBy === ConversationHandler.AI) {
      updates.handledBy = ConversationHandler.HUMAN;
      updates.needsHuman = false;
      if (!ticket.assigneeId && message.senderId) updates.assigneeId = message.senderId;
    }

    if (message.senderType === "ai") {
      updates.aiActionsCount = sql`${tickets.aiActionsCount} + 1` as unknown as number;
    }

    await db.update(tickets).set(updates).where(eq(tickets.id, ticket.id));
  }

  async update(id: number, organizationId: number, data: ConversationUpdate): Promise<Ticket | null> {
    const updates: Partial<typeof tickets.$inferInsert> = { ...data, updatedAt: new Date() };
    if (data.status !== undefined) {
      updates.resolvedAt = data.status === TicketStatus.RESOLVED || data.status === TicketStatus.CLOSED ? new Date() : null;
    }

    const [updated] = await db
      .update(tickets)
      .set(updates)
      .where(and(eq(tickets.id, id), eq(tickets.organizationId, organizationId)))
      .returning();

    return updated || null;
  }

  /**
   * Inbox list: the latest conversation of every customer, newest activity first,
   * with unread counts and the last message's sender/status. Then contacts on live channels
   * that have no conversation yet, newest first.
   */
  async listForInbox(organizationId: number): Promise<ConversationListItem[]> {
    const [withConversation, withoutConversation] = await Promise.all([
      this.listConversations(organizationId),
      this.listContactsWithoutConversation(organizationId),
    ]);
    return [...withConversation, ...withoutConversation];
  }

  /** Contacts on live channels that never had a ticket, as placeholder inbox rows */
  private async listContactsWithoutConversation(organizationId: number): Promise<ConversationListItem[]> {
    const rows = await db
      .select({ customer: customers, channel: channels })
      .from(customers)
      .innerJoin(channels, and(eq(customers.channelId, channels.id), ne(channels.status, ChannelStatus.DISCONNECTED)))
      .where(
        and(
          eq(customers.organizationId, organizationId),
          sql`not exists (select 1 from ${tickets} where ${tickets.customerId} = ${customers.id})`
        )
      )
      .orderBy(desc(customers.createdAt));

    return rows.map(({ customer, channel }) => ({
      id: -customer.id,
      hasConversation: false,
      ticketNumber: "",
      status: null,
      handledBy: ConversationHandler.HUMAN,
      needsHuman: false,
      assigneeId: null,
      assigneeName: null,
      tags: [],
      aiSummary: null,
      aiIntent: null,
      aiConfidence: null,
      aiActionsCount: 0,
      aiModel: null,
      aiSuggestions: [],
      language: customer.language,
      lastMessageText: null,
      lastMessageAt: null,
      createdAt: customer.createdAt,
      resolvedAt: null,
      unreadCount: 0,
      lastReceivedMessageAt: null,
      lastMessage: null,
      customer: toListCustomer(customer),
      channel: toListChannel(channel),
    }));
  }

  private async listConversations(organizationId: number): Promise<ConversationListItem[]> {
    const latestPerCustomer = db
      .selectDistinctOn([tickets.customerId], { id: tickets.id })
      .from(tickets)
      .where(eq(tickets.organizationId, organizationId))
      .orderBy(tickets.customerId, desc(tickets.createdAt));

    const rows = await db
      .select({
        ticket: tickets,
        customer: customers,
        channel: channels,
        assigneeName: users.name,
      })
      .from(tickets)
      .innerJoin(customers, eq(tickets.customerId, customers.id))
      // Left join channels: conversations from disconnected channels remain visible for history
      .leftJoin(
        channels,
        eq(sql`coalesce(${tickets.channelId}, ${customers.channelId})`, channels.id)
      )
      .leftJoin(users, eq(tickets.assigneeId, users.id))
      .where(and(eq(tickets.organizationId, organizationId), inArray(tickets.id, latestPerCustomer)))
      .orderBy(sql`${tickets.lastMessageAt} desc nulls last`);

    if (rows.length === 0) return [];

    const customerIds = rows.map((r) => r.customer.id);

    const unreadRows = await db
      .select({ customerId: messages.customerId, count: sql<number>`count(*)::int` })
      .from(messages)
      .where(
        and(
          eq(messages.organizationId, organizationId),
          inArray(messages.customerId, customerIds),
          eq(messages.senderType, "customer"),
          ne(messages.status, MessageStatus.READ)
        )
      )
      .groupBy(messages.customerId);
    const unreadMap = new Map(unreadRows.map((r) => [r.customerId, r.count]));

    const lastRows = await db
      .selectDistinctOn([messages.customerId], {
        customerId: messages.customerId,
        senderType: messages.senderType,
        mediaType: messages.mediaType,
        status: messages.status,
        metadata: messages.metadata,
      })
      .from(messages)
      .where(
        and(
          eq(messages.organizationId, organizationId),
          inArray(messages.customerId, customerIds),
          eq(messages.isInternalNote, false)
        )
      )
      .orderBy(messages.customerId, desc(messages.createdAt));
    const lastMap = new Map(lastRows.map((r) => [r.customerId, r]));

    const lastReceivedRows = await db
      .selectDistinctOn([messages.customerId], {
        customerId: messages.customerId,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .where(
        and(
          eq(messages.organizationId, organizationId),
          inArray(messages.customerId, customerIds),
          opensServiceWindow
        )
      )
      .orderBy(messages.customerId, desc(messages.createdAt));
    const lastReceivedMap = new Map(lastReceivedRows.map((r) => [r.customerId, r.createdAt]));

    return rows.map(({ ticket, customer, channel, assigneeName }) => {
      const last = lastMap.get(customer.id);
      return {
        id: ticket.id,
        hasConversation: true,
        ticketNumber: ticket.ticketNumber,
        status: ticket.status,
        handledBy: ticket.handledBy,
        needsHuman: ticket.needsHuman,
        assigneeId: ticket.assigneeId,
        assigneeName: assigneeName ?? null,
        tags: ticket.tags ?? [],
        aiSummary: ticket.aiSummary,
        aiIntent: ticket.aiIntent,
        aiConfidence: ticket.aiConfidence,
        aiActionsCount: ticket.aiActionsCount,
        aiModel: ticket.aiModel,
        aiSuggestions: ticket.aiSuggestions ?? [],
        language: ticket.language ?? customer.language,
        lastMessageText: ticket.lastMessageText,
        lastMessageAt: ticket.lastMessageAt,
        createdAt: ticket.createdAt,
        resolvedAt: ticket.resolvedAt,
        unreadCount: unreadMap.get(customer.id) ?? 0,
        lastReceivedMessageAt: lastReceivedMap.get(customer.id) ?? null,
        lastMessage: last
          ? { senderType: last.senderType, mediaType: last.mediaType, status: last.status, metadata: last.metadata }
          : null,
        customer: toListCustomer(customer),
        channel: channel ? toListChannel(channel) : null,
      };
    });
  }
}

const toListCustomer = (customer: Customer): ConversationListItem["customer"] => ({
  id: customer.id,
  name: customer.name,
  phone: customer.phone,
  email: customer.email,
  handle: customer.handle,
  avatarUrl: customer.avatarUrl,
  language: customer.language,
  tags: customer.tags,
  channelId: customer.channelId,
  isOptedOut: Boolean(customer.isOptedOut),
  createdAt: customer.createdAt,
});

const toListChannel = (channel: Channel): NonNullable<ConversationListItem["channel"]> => ({
  id: channel.id,
  type: channel.type,
  name: channel.name,
  handle: channel.handle,
  phoneNumber: channel.phoneNumber,
  status: channel.status,
});

export const conversationRepository = new ConversationRepository();
