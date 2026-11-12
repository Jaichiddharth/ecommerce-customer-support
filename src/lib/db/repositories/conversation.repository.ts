import { db } from "..";
import { and, desc, eq, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
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
import { publish } from "../../realtime";
import { createLogger } from "../../logger";
import {
  CLOSED_TICKET_STATUSES,
  TICKET_CREDIT_ALLOWANCE,
  isClosedTicketStatus,
  type TicketCredits,
  type TicketEvent,
} from "../../../types/ticket";

const log = createLogger("ConversationRepository");

/** Namespace of the per-customer advisory lock taken while a follow-up ticket is opened */
const FOLLOW_UP_TICKET_LOCK = 7301;

/** A ticket change to record in the thread; the ticket, time and actor name are filled in by `logEvent` */
export type TicketEventInput = Omit<TicketEvent, "ticketId" | "occurredAt"> & { occurredAt?: Date };

/** Who wrote the message that may open a follow-up ticket on a resolved one */
export interface TicketOpener {
  actorType: "customer" | "agent";
  actorId: number | null;
  /** When the message was written; the "new ticket" note is placed just before it */
  at: Date;
}

const newTicketNumber = (customerId: number) => `C-${customerId}-${Date.now()}`;

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
  /** Latest customer message on this ticket (not the contact's earlier tickets); null = the customer hasn't written on it */
  ticketCustomerMessageAt: Date | null;
  /** Mock billing: when the first teammate reply made this ticket billable */
  billableAt: Date | null;
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

/** A teammate the inbox can assign tickets to (GET /api/conversations/assignees) */
export interface AssignableTeammate {
  id: number;
  name: string;
  email: string;
  avatarUrl: string | null;
  role: string;
  isOnline: boolean;
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

  private async latestForCustomer(organizationId: number, customerId: number): Promise<Ticket | null> {
    const [latest] = await db
      .select()
      .from(tickets)
      .where(and(eq(tickets.organizationId, organizationId), eq(tickets.customerId, customerId)))
      .orderBy(desc(tickets.createdAt), desc(tickets.id))
      .limit(1);
    return latest ?? null;
  }

  /**
   * Latest conversation for a customer; creates one when the customer has none yet.
   * With `opener`, a resolved latest ticket isn't reused: a follow-up ticket is opened (unassigned, so it lands in
   * the Unassigned view when the customer wrote it) and the thread records why.
   */
  async ensureForCustomer(
    organizationId: number,
    customerId: number,
    channelId?: number | null,
    opener?: TicketOpener
  ): Promise<Ticket> {
    const existing = await this.latestForCustomer(organizationId, customerId);
    if (existing && !(opener && isClosedTicketStatus(existing.status))) return existing;

    if (!existing) {
      const [created] = await db
        .insert(tickets)
        .values({
          organizationId,
          customerId,
          channelId: channelId ?? null,
          ticketNumber: newTicketNumber(customerId),
          status: TicketStatus.OPEN,
        })
        .returning();
      return created;
    }

    return this.openFollowUp(organizationId, customerId, channelId, opener!);
  }

  /**
   * Opens the follow-up of a resolved ticket. The advisory lock makes concurrent messages (webhook bursts) open
   * one follow-up, not one each: the second waits, then finds the follow-up already open and uses it.
   */
  private async openFollowUp(
    organizationId: number,
    customerId: number,
    channelId: number | null | undefined,
    opener: TicketOpener
  ): Promise<Ticket> {
    const { ticket, previous } = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${FOLLOW_UP_TICKET_LOCK}::int, ${customerId}::int)`);
      const [latest] = await tx
        .select()
        .from(tickets)
        .where(and(eq(tickets.organizationId, organizationId), eq(tickets.customerId, customerId)))
        .orderBy(desc(tickets.createdAt), desc(tickets.id))
        .limit(1);
      if (latest && !isClosedTicketStatus(latest.status)) return { ticket: latest, previous: null };

      const [created] = await tx
        .insert(tickets)
        .values({
          organizationId,
          customerId,
          channelId: channelId ?? latest?.channelId ?? null,
          ticketNumber: newTicketNumber(customerId),
          status: TicketStatus.OPEN,
          // The conversation keeps its mode: an AI-handled contact stays with the AI agent
          handledBy: latest?.handledBy ?? ConversationHandler.HUMAN,
          // A teammate's message assigns the new ticket to them; a customer's leaves it unassigned
          assigneeId: opener.actorType === "agent" ? opener.actorId : null,
        })
        .returning();
      return { ticket: created, previous: latest ?? null };
    });

    if (previous) {
      await this.logEvent(ticket, {
        action: "opened",
        actorType: opener.actorType,
        actorId: opener.actorId,
        actorName: null,
        previousStatus: previous.status,
        status: ticket.status,
        // Just before the message that opened it, so the thread reads "new ticket" → message
        occurredAt: new Date(opener.at.getTime() - 1),
      });
    }
    return ticket;
  }

  /**
   * Keeps the conversation in sync with a newly stored message: last message preview, AI → human hand-over,
   * and, on a teammate's reply, claiming an unassigned ticket and making the ticket billable (once).
   */
  async recordMessage(
    ticket: Ticket,
    message: Pick<Message, "senderType" | "senderId" | "textContent" | "isInternalNote" | "createdAt" | "mediaType">
  ): Promise<void> {
    const now = new Date();
    const updates: Partial<typeof tickets.$inferInsert> = { updatedAt: now };
    // Only a teammate's own reply counts: automations send as `agent` too, but without a sender
    const isTeammateReply = message.senderType === "agent" && !message.isInternalNote && message.senderId != null;

    if (!message.isInternalNote) {
      updates.lastMessageText = message.textContent ?? null;
      updates.lastMessageAt = message.createdAt ?? now;
    }

    // A human agent replying takes the conversation over from the AI agent
    if (isTeammateReply && ticket.handledBy === ConversationHandler.AI) {
      updates.handledBy = ConversationHandler.HUMAN;
      updates.needsHuman = false;
    }

    if (message.senderType === "ai") {
      updates.aiActionsCount = sql`${tickets.aiActionsCount} + 1` as unknown as number;
    }

    await db.update(tickets).set(updates).where(eq(tickets.id, ticket.id));

    // Normally a customer message on a resolved ticket opens a follow-up (see ensureForCustomer). When it still
    // lands on a resolved ticket (filed on it explicitly, or resolved in the same instant it arrived), the ticket
    // reopens so the message isn't lost in Closed. Decided in SQL, on the ticket's current status.
    if (message.senderType === "customer" && message.mediaType !== "system") {
      const [reopened] = await db
        .update(tickets)
        .set({ status: TicketStatus.OPEN, resolvedAt: null })
        .where(and(eq(tickets.id, ticket.id), inArray(tickets.status, [...CLOSED_TICKET_STATUSES])))
        .returning({ id: tickets.id });
      if (reopened) {
        await this.logEvent(ticket, {
          action: "reopened",
          actorType: "customer",
          actorId: null,
          actorName: null,
          status: TicketStatus.OPEN,
          occurredAt: now,
        });
      }
    }

    if (!isTeammateReply) return;
    const senderId = message.senderId!;

    // Conditional updates: exactly one reply claims the ticket and exactly one makes it billable,
    // even when replies race
    const [claimed] = await db
      .update(tickets)
      .set({ assigneeId: senderId })
      .where(and(eq(tickets.id, ticket.id), isNull(tickets.assigneeId)))
      .returning({ id: tickets.id });
    const [billed] = await db
      .update(tickets)
      .set({ billableAt: now, billableById: senderId })
      .where(and(eq(tickets.id, ticket.id), isNull(tickets.billableAt)))
      .returning({ id: tickets.id });

    if (claimed) {
      await this.logEvent(ticket, {
        action: "assigned",
        actorType: "agent",
        actorId: senderId,
        actorName: null,
        assigneeId: senderId,
        assignReason: "first_reply",
        occurredAt: now,
      });
    }
    if (billed) {
      await this.logEvent(ticket, {
        action: "billable",
        actorType: "agent",
        actorId: senderId,
        actorName: null,
        occurredAt: new Date(now.getTime() + 1),
      });
    }
  }

  /**
   * Records a ticket change in the thread as a team-only system note (the ticket's audit log) and tells open
   * inboxes. Never throws: the change itself already happened.
   */
  async logEvent(
    ticket: Pick<Ticket, "id" | "organizationId" | "customerId" | "channelId">,
    input: TicketEventInput
  ): Promise<void> {
    try {
      const names = await this.userNames(ticket.organizationId, [input.actorId, input.assigneeId]);
      const event: TicketEvent = {
        ...input,
        ticketId: ticket.id,
        actorName: input.actorName ?? (input.actorId != null ? names.get(input.actorId) ?? null : null),
        ...(input.assigneeId !== undefined
          ? { assigneeName: input.assigneeName ?? (input.assigneeId != null ? names.get(input.assigneeId) ?? null : null) }
          : {}),
        occurredAt: (input.occurredAt ?? new Date()).toISOString(),
      };

      const [note] = await db
        .insert(messages)
        .values({
          organizationId: ticket.organizationId,
          customerId: ticket.customerId,
          channelId: ticket.channelId ?? null,
          ticketId: ticket.id,
          senderType: "system",
          senderId: event.actorType === "agent" ? event.actorId : null,
          receiverId: ticket.customerId,
          textContent: describeTicketEvent(event),
          isInternalNote: true,
          status: MessageStatus.READ,
          metadata: { ticketEvent: event },
          createdAt: new Date(event.occurredAt),
          updatedAt: new Date(),
        })
        .returning();

      publish(ticket.organizationId, {
        type: "message.new",
        customerId: ticket.customerId,
        message: { ...note, senderName: event.actorType === "agent" ? event.actorName : null },
      });
      publish(ticket.organizationId, { type: "conversation.updated", conversationId: ticket.id, customerId: ticket.customerId });
    } catch (err) {
      log.warn("Ticket changed but its audit note could not be saved", { err, ticketId: ticket.id, action: input.action });
    }
  }

  /** Names of the organization's users with these ids */
  async userNames(organizationId: number, ids: Array<number | null | undefined>): Promise<Map<number, string>> {
    const wanted = [...new Set(ids.filter((id): id is number => typeof id === "number"))];
    if (wanted.length === 0) return new Map();
    const rows = await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(and(eq(users.organizationId, organizationId), inArray(users.id, wanted)));
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  /**
   * Teammates a ticket can be assigned to: members who joined the workspace and can reply (viewers can't),
   * by name
   */
  async listAssignableTeammates(organizationId: number): Promise<AssignableTeammate[]> {
    const rows = await db
      .select({ id: users.id, name: users.name, email: users.email, avatarUrl: users.avatarUrl, role: users.role, isOnline: users.isOnline, status: users.status })
      .from(users)
      .where(eq(users.organizationId, organizationId));
    return rows
      .filter((u) => (u.role || "AGENT").toUpperCase() !== "VIEWER" && (u.status || "active") !== "invited")
      .map((u) => ({ id: u.id, name: u.name, email: u.email, avatarUrl: u.avatarUrl, role: (u.role || "AGENT").toUpperCase(), isOnline: Boolean(u.isOnline) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Mock billing: tickets made billable by a teammate's first reply, against the fixed allowance */
  async ticketCredits(organizationId: number): Promise<TicketCredits> {
    const [row] = await db
      .select({ used: sql<number>`count(*)::int` })
      .from(tickets)
      .where(and(eq(tickets.organizationId, organizationId), isNotNull(tickets.billableAt)));
    const used = row?.used ?? 0;
    return { allowance: TICKET_CREDIT_ALLOWANCE, used, remaining: Math.max(0, TICKET_CREDIT_ALLOWANCE - used) };
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

  async listForInbox(organizationId: number, onlyAssigneeId?: number): Promise<ConversationListItem[]> {
    const [withConversation, withoutConversation] = await Promise.all([
      this.listConversations(organizationId, onlyAssigneeId),
      onlyAssigneeId ? [] : this.listContactsWithoutConversation(organizationId),
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
      ticketCustomerMessageAt: null,
      billableAt: null,
      lastMessage: null,
      customer: toListCustomer(customer),
      channel: toListChannel(channel),
    }));
  }

  private async listConversations(organizationId: number, onlyAssigneeId?: number): Promise<ConversationListItem[]> {
    const latestPerCustomer = db
      .selectDistinctOn([tickets.customerId], { id: tickets.id })
      .from(tickets)
      .where(eq(tickets.organizationId, organizationId))
      .orderBy(tickets.customerId, desc(tickets.createdAt));

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
          opensServiceWindow
        )
      )
      .orderBy(messages.customerId, desc(messages.createdAt));
    const lastReceivedMap = new Map(lastReceivedRows.map((r) => [r.customerId, r.createdAt]));

    // Latest customer message on each listed ticket: a ticket the customer wrote on is one the team owes a reply
    const listedTicketIds = [...ticketMap.values()].map((t) => t.ticket.id);
    const ticketCustomerRows = await db
      .selectDistinctOn([messages.ticketId], { ticketId: messages.ticketId, createdAt: messages.createdAt })
      .from(messages)
      .where(and(eq(messages.organizationId, organizationId), inArray(messages.ticketId, listedTicketIds), opensServiceWindow))
      .orderBy(messages.ticketId, desc(messages.createdAt));
    const ticketCustomerMap = new Map(ticketCustomerRows.map((r) => [r.ticketId, r.createdAt]));

    const items: ConversationListItem[] = allCustomers.map(({ customer, channel }) => {
      const ticketEntry = ticketMap.get(customer.id)!;
      const ticket = ticketEntry.ticket;
      const assigneeName = ticketEntry.assigneeName;
      const last = lastMap.get(customer.id);
      const lastMsgText = ticket.lastMessageText || last?.textContent || null;
      const lastMsgAt = ticket.lastMessageAt || last?.createdAt || lastReceivedMap.get(customer.id) || customer.updatedAt || customer.createdAt;

      return {
        id: ticket.id,
        hasConversation: true,
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
        ticketCustomerMessageAt: ticketCustomerMap.get(ticket.id) ?? null,
        billableAt: ticket.billableAt,
        lastMessage: last
          ? { senderType: last.senderType, mediaType: last.mediaType, status: last.status, metadata: last.metadata }
          : null,
        customer: toListCustomer(customer),
        channel: channel ? toListChannel(channel) : null,
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

/** One-line summary stored as the audit note's text (the thread shows it with the time) */
export function describeTicketEvent(event: TicketEvent): string {
  const actor = event.actorName || (event.actorType === "customer" ? "the customer" : "a teammate");
  const assignee = event.assigneeName || "a teammate";
  switch (event.action) {
    case "opened":
      return event.actorType === "customer"
        ? "New ticket opened · the customer wrote after the last ticket was resolved"
        : `New ticket opened by ${actor}`;
    case "resolved":
      return `Resolved by ${actor}`;
    case "reopened":
      return event.actorType === "customer" ? "Reopened · the customer wrote again" : `Reopened by ${actor}`;
    case "status":
      return `Status changed to ${(event.status || "").toLowerCase()} by ${actor}`;
    case "assigned":
      if (event.assignReason === "take_over") return `${actor} took over the ticket`;
      if (event.assignReason === "first_reply") return `Assigned to ${assignee} · first reply`;
      return event.assigneeId === event.actorId ? `${actor} assigned the ticket to themselves` : `Assigned to ${assignee} by ${actor}`;
    case "unassigned":
      return `Unassigned by ${actor}`;
    case "ai_on":
      return `AI agent turned on by ${actor}`;
    case "ai_off":
      return `AI agent paused by ${actor}`;
    case "billable":
      return `Billable · 1 ticket credit used · first reply by ${actor}`;
    default:
      return "Ticket updated";
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
