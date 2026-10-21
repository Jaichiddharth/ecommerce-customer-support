import { db } from "..";
import {
  messages,
  users,
  type Message,
  type SenderType,
  type MessageReaction,
  type MessageMetadata,
  MessageStatus,
  normalizeMessageStatus,
} from "../schema";
import { eq, and, asc, ne, getTableColumns } from "drizzle-orm";
import { messageReactionRepository } from "./message-reaction.repository";
import { conversationRepository } from "./conversation.repository";
import { createLogger } from "../../logger";

const log = createLogger("MessageRepository");

export type MessageWithReactions = Message & {
  senderName?: string | null; // Name of the agent (users.name) who sent it; null for customer messages
  reactions?: MessageReaction[];
};

export interface CreateMessageData {
  organizationId: number;
  customerId: number;
  channelId?: number | null;
  ticketId?: number | null;
  senderType: SenderType;
  senderId?: number | null;
  receiverId?: number | null;
  textContent?: string | null;
  mediaUrl?: string | null;
  mediaType?: string | null;
  isInternalNote?: boolean;
  status?: MessageStatus | number | string;
  errorCode?: number | null;
  isRead?: boolean; // Backward compatibility
  metaMessageId?: string | null;
  repliedToId?: number | null;
  metadata?: MessageMetadata | null;
  createdAt?: Date;
}

export class MessageRepository {
  /**
   * Create and store a new message (outbound agent message or inbound webhook message)
   */
  async createMessage(data: CreateMessageData): Promise<Message | null> {
    // Every message belongs to the customer's inbox conversation
    const conversation = data.ticketId
      ? await conversationRepository.findById(data.ticketId, data.organizationId)
      : await conversationRepository.ensureForCustomer(data.organizationId, data.customerId, data.channelId);

    const initialStatus =
      data.status !== undefined
        ? normalizeMessageStatus(data.status)
        : data.isRead
        ? MessageStatus.READ
        : MessageStatus.SENT;

    const [created] = await db
      .insert(messages)
      .values({
        organizationId: data.organizationId,
        customerId: data.customerId,
        channelId: data.channelId || null,
        ticketId: conversation?.id ?? null,
        senderType: data.senderType,
        senderId: data.senderId ?? null,
        receiverId: data.receiverId ?? data.customerId,
        textContent: data.textContent || null,
        mediaUrl: data.mediaUrl || null,
        mediaType: data.mediaType || null,
        isInternalNote: data.isInternalNote ?? false,
        status: initialStatus,
        errorCode: data.errorCode ?? null,
        metaMessageId: data.metaMessageId || null,
        repliedToId: data.repliedToId || null,
        metadata: data.metadata ?? null,
        createdAt: data.createdAt || new Date(),
        updatedAt: new Date(),
      })
      .returning();

    if (created && conversation) {
      try {
        await conversationRepository.recordMessage(conversation, created);
      } catch (err) {
        // The message itself is saved; a stale conversation preview must not fail the send/webhook
        log.warn("Could not update conversation for message", { err, messageId: created.id, ticketId: conversation.id });
      }
    }

    return created || null;
  }

  /**
   * Find a message by Meta message ID (wamid) within an organization, for deduplication, status updates, or reply mapping
   */
  async findByMetaMessageId(metaMessageId: string, organizationId: number): Promise<Message | null> {
    const [message] = await db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.metaMessageId, metaMessageId),
          eq(messages.organizationId, organizationId)
        )
      )
      .limit(1);

    return message || null;
  }

  /**
   * Find a message by primary key ID within an organization
   */
  async findById(id: number, organizationId: number): Promise<Message | null> {
    const [message] = await db
      .select()
      .from(messages)
      .where(and(eq(messages.id, id), eq(messages.organizationId, organizationId)))
      .limit(1);

    return message || null;
  }

  /**
   * List all messages for a specific customer in chronological order along with their reactions
   */
  async listByCustomer(
    customerId: number,
    organizationId: number,
    limit?: number
  ): Promise<MessageWithReactions[]> {
    const query = db
      .select({ ...getTableColumns(messages), senderName: users.name })
      .from(messages)
      .leftJoin(users, eq(messages.senderId, users.id))
      .where(
        and(
          eq(messages.organizationId, organizationId),
          eq(messages.customerId, customerId)
        )
      )
      .orderBy(asc(messages.createdAt));

    const messageList = limit ? await query.limit(limit) : await query;
    if (messageList.length === 0) return [];

    const messageIds = messageList.map((m) => m.id);
    const allReactions = await messageReactionRepository.listByMessageIds(messageIds);

    const reactionsMap = new Map<number, MessageReaction[]>();
    for (const rx of allReactions) {
      const list = reactionsMap.get(rx.messageId) || [];
      list.push(rx);
      reactionsMap.set(rx.messageId, list);
    }

    return messageList.map((m) => ({
      ...m,
      reactions: reactionsMap.get(m.id) || [],
    }));
  }

  /**
   * Mark all unread customer messages as read (Status: 2 / READ)
   */
  async markAsReadByCustomer(
    customerId: number,
    organizationId: number
  ): Promise<boolean> {
    try {
      await db
        .update(messages)
        .set({ status: MessageStatus.READ, updatedAt: new Date() })
        .where(
          and(
            eq(messages.organizationId, organizationId),
            eq(messages.customerId, customerId),
            eq(messages.senderType, "customer"),
            ne(messages.status, MessageStatus.READ)
          )
        );

      return true;
    } catch (error) {
      log.warn("Could not mark messages as read", { err: error });
      return false;
    }
  }

  /**
   * Update message status by Meta message ID within an organization (0 = sent, 1 = delivered, 2 = read, 3 = failed)
   */
  async updateStatusByMetaId(
    metaMessageId: string,
    organizationId: number,
    status: MessageStatus | number | string,
    errorCode?: number | null
  ): Promise<Message | null> {
    const normalizedStatus = normalizeMessageStatus(status);
    const updatePayload: Record<string, any> = {
      status: normalizedStatus,
      updatedAt: new Date(),
    };
    if (errorCode !== undefined) {
      updatePayload.errorCode = errorCode;
    }

    const [updated] = await db
      .update(messages)
      .set(updatePayload)
      .where(
        and(
          eq(messages.metaMessageId, metaMessageId),
          eq(messages.organizationId, organizationId)
        )
      )
      .returning();

    return updated || null;
  }

  /**
   * Update message status by primary key ID within an organization
   */
  async updateStatusById(
    id: number,
    organizationId: number,
    status: MessageStatus | number | string,
    errorCode?: number | null
  ): Promise<Message | null> {
    const normalizedStatus = normalizeMessageStatus(status);
    const updatePayload: Record<string, any> = {
      status: normalizedStatus,
      updatedAt: new Date(),
    };
    if (errorCode !== undefined) {
      updatePayload.errorCode = errorCode;
    }

    const [updated] = await db
      .update(messages)
      .set(updatePayload)
      .where(and(eq(messages.id, id), eq(messages.organizationId, organizationId)))
      .returning();

    return updated || null;
  }

  /**
   * Update message status (compatibility wrapper for read status)
   */
  async updateReadStatusByMetaId(
    metaMessageId: string,
    organizationId: number,
    isRead: boolean = true
  ): Promise<Message | null> {
    return this.updateStatusByMetaId(
      metaMessageId,
      organizationId,
      isRead ? MessageStatus.READ : MessageStatus.DELIVERED
    );
  }
}

export const messageRepository = new MessageRepository();
