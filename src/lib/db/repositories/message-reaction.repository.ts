import { db } from "..";
import { messageReactions, type MessageReaction, type NewMessageReaction } from "../schema";
import { eq, and, inArray } from "drizzle-orm";
import { createLogger } from "../../logger";

const log = createLogger("MessageReactionRepository");

export interface UpsertReactionData {
  messageId: number;
  userId?: number | null;
  customerId?: number | null;
  emoji: string;
}

export interface DeleteReactionData {
  messageId: number;
  userId?: number | null;
  customerId?: number | null;
}

export class MessageReactionRepository {
  /**
   * Upsert a reaction (add or update emoji for this user/customer on a message).
   * If emoji is empty, deletes the reaction instead.
   */
  async upsertReaction(data: UpsertReactionData): Promise<MessageReaction | null> {
    const emojiTrimmed = (data.emoji || "").trim();
    if (!emojiTrimmed) {
      await this.deleteReaction({
        messageId: data.messageId,
        userId: data.userId,
        customerId: data.customerId,
      });
      return null;
    }

    // Check for existing reaction by this user or customer on the message
    let existingReaction: MessageReaction | null = null;
    if (data.userId) {
      const [found] = await db
        .select()
        .from(messageReactions)
        .where(
          and(
            eq(messageReactions.messageId, data.messageId),
            eq(messageReactions.userId, data.userId)
          )
        )
        .limit(1);
      existingReaction = found || null;
    } else if (data.customerId) {
      const [found] = await db
        .select()
        .from(messageReactions)
        .where(
          and(
            eq(messageReactions.messageId, data.messageId),
            eq(messageReactions.customerId, data.customerId)
          )
        )
        .limit(1);
      existingReaction = found || null;
    }

    if (existingReaction) {
      const [updated] = await db
        .update(messageReactions)
        .set({
          emoji: emojiTrimmed,
          customerId: data.customerId ?? existingReaction.customerId,
          createdAt: new Date(),
        })
        .where(eq(messageReactions.id, existingReaction.id))
        .returning();
      return updated || null;
    }

    const [created] = await db
      .insert(messageReactions)
      .values({
        messageId: data.messageId,
        userId: data.userId ?? null,
        customerId: data.customerId ?? null,
        emoji: emojiTrimmed,
        createdAt: new Date(),
      })
      .returning();

    return created || null;
  }

  /**
   * Delete reaction for a specific user or customer on a message
   */
  async deleteReaction(data: DeleteReactionData): Promise<boolean> {
    if (data.userId) {
      await db
        .delete(messageReactions)
        .where(
          and(
            eq(messageReactions.messageId, data.messageId),
            eq(messageReactions.userId, data.userId)
          )
        );
      return true;
    } else if (data.customerId) {
      await db
        .delete(messageReactions)
        .where(
          and(
            eq(messageReactions.messageId, data.messageId),
            eq(messageReactions.customerId, data.customerId)
          )
        );
      return true;
    }
    return false;
  }

  /**
   * List all reactions for a specific message
   */
  async listByMessageId(messageId: number): Promise<MessageReaction[]> {
    try {
      return await db
        .select()
        .from(messageReactions)
        .where(eq(messageReactions.messageId, messageId));
    } catch (error) {
      log.warn("Could not load reactions for message — returning none", { err: error });
      return [];
    }
  }

  /**
   * List reactions for multiple messages in batch
   */
  async listByMessageIds(messageIds: number[]): Promise<MessageReaction[]> {
    if (messageIds.length === 0) return [];
    try {
      return await db
        .select()
        .from(messageReactions)
        .where(inArray(messageReactions.messageId, messageIds));
    } catch (error) {
      log.warn("Could not load reactions — messages are returned without them", { err: error });
      return [];
    }
  }
}

export const messageReactionRepository = new MessageReactionRepository();
