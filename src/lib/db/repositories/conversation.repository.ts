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
  type Ticket,
  type Message,
} from "../schema";

/** One row in the inbox conversation list */
export interface ConversationListItem {
  id: number;
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
   * Inbox list: returns ALL customers of the organization, with their latest
   * conversation/ticket state, unread counts, and last message preview.
   * Customers without a prior ticket are automatically initialized so they appear in the inbox.
   */
  async listForInbox(organizationId: number, onlyAssigneeId?: number): Promise<ConversationListItem[]> {
    // 1. Fetch all customers in this organization (standalone or primary profile)
    const allCustomers = await db
      .select({
        customer: customers,
        channel: channels,
      })
      .from(customers)
      .leftJoin(channels, eq(customers.channelId, channels.id))
      .where(
        and(
          eq(customers.organizationId, organizationId),
          sql`(${customers.primaryCustomerId} IS NULL OR ${customers.primaryCustomerId} = ${customers.id})`
        )
      )
      .orderBy(desc(customers.updatedAt), desc(customers.createdAt));

    if (allCustomers.length === 0) return [];

    const customerIds = allCustomers.map((r) => r.customer.id);

    // 2. Fetch the latest ticket for each customer (if any exist)
    const allCustomerTickets = await db
      .select({
        ticket: tickets,
        assigneeName: users.name,
      })
      .from(tickets)
      .leftJoin(users, eq(tickets.assigneeId, users.id))
      .where(
        and(
          eq(tickets.organizationId, organizationId),
          inArray(tickets.customerId, customerIds)
        )
      )
      .orderBy(desc(tickets.createdAt));

    const ticketMap = new Map<number, { ticket: Ticket; assigneeName: string | null }>();
    for (const row of allCustomerTickets) {
      if (!ticketMap.has(row.ticket.customerId)) {
        ticketMap.set(row.ticket.customerId, row);
      }
    }

    // 3. For any customer that does NOT have a ticket yet, ensure a ticket is created
    for (const { customer } of allCustomers) {
      if (!ticketMap.has(customer.id)) {
        const newTicket = await this.ensureForCustomer(organizationId, customer.id, customer.channelId);
        ticketMap.set(customer.id, { ticket: newTicket, assigneeName: null });
      }
    }

    // 4. Fetch unread counts, latest messages, and last received times
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
        textContent: messages.textContent,
        senderType: messages.senderType,
        mediaType: messages.mediaType,
        status: messages.status,
        metadata: messages.metadata,
        createdAt: messages.createdAt,
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
          eq(messages.senderType, "customer")
        )
      )
      .orderBy(messages.customerId, desc(messages.createdAt));
    const lastReceivedMap = new Map(lastReceivedRows.map((r) => [r.customerId, r.createdAt]));

    const items: ConversationListItem[] = allCustomers.map(({ customer, channel }) => {
      const ticketEntry = ticketMap.get(customer.id)!;
      const ticket = ticketEntry.ticket;
      const assigneeName = ticketEntry.assigneeName;
      const last = lastMap.get(customer.id);
      const lastMsgText = ticket.lastMessageText || last?.textContent || null;
      const lastMsgAt = ticket.lastMessageAt || last?.createdAt || lastReceivedMap.get(customer.id) || customer.updatedAt || customer.createdAt;

      return {
        id: ticket.id,
        ticketNumber: ticket.ticketNumber,
        status: ticket.status,
        handledBy: ticket.handledBy,
        needsHuman: ticket.needsHuman,
        assigneeId: ticket.assigneeId,
        assigneeName: assigneeName ?? null,
        tags: (ticket.tags && ticket.tags.length > 0) ? ticket.tags : (customer.tags ?? []),
        aiSummary: ticket.aiSummary,
        aiIntent: ticket.aiIntent,
        aiConfidence: ticket.aiConfidence,
        aiActionsCount: ticket.aiActionsCount,
        aiModel: ticket.aiModel,
        aiSuggestions: ticket.aiSuggestions ?? [],
        language: ticket.language ?? customer.language,
        lastMessageText: lastMsgText,
        lastMessageAt: lastMsgAt,
        createdAt: ticket.createdAt,
        resolvedAt: ticket.resolvedAt,
        unreadCount: unreadMap.get(customer.id) ?? 0,
        lastReceivedMessageAt: lastReceivedMap.get(customer.id) ?? null,
        lastMessage: last
          ? { senderType: last.senderType, mediaType: last.mediaType, status: last.status, metadata: last.metadata }
          : null,
        customer: {
          id: customer.id,
          name: customer.name,
          phone: customer.phone,
          email: customer.email,
          handle: customer.handle,
          avatarUrl: customer.avatarUrl,
          language: customer.language,
          tags: customer.tags,
          channelId: customer.channelId,
          createdAt: customer.createdAt,
        },
        channel: channel
          ? {
              id: channel.id,
              type: channel.type,
              name: channel.name,
              handle: channel.handle,
              phoneNumber: channel.phoneNumber,
              status: channel.status,
            }
          : null,
      };
    });

    // Sort by latest message / activity descending
    items.sort((a, b) => {
      const timeA = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : new Date(a.createdAt).getTime();
      const timeB = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : new Date(b.createdAt).getTime();
      return timeB - timeA;
    });

    if (onlyAssigneeId !== undefined) {
      return items.filter((item) => item.assigneeId === onlyAssigneeId);
    }

    return items;
  }
}

export const conversationRepository = new ConversationRepository();
