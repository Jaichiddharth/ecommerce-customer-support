import { conversationRepository, type ConversationListItem, type ConversationUpdate } from "../db/repositories";
import { ConversationHandler, TicketStatus, type Ticket } from "../db/schema";
import { AppError } from "../errors";
import { publish } from "../realtime";

const HANDLERS: string[] = Object.values(ConversationHandler);
const STATUSES: string[] = Object.values(TicketStatus);

export class ConversationService {
  async listForInbox(organizationId: number): Promise<ConversationListItem[]> {
    return await conversationRepository.listForInbox(organizationId);
  }

  /**
   * Applies an inbox action (AI/human mode, take over, assign, resolve, tags) and notifies the organization.
   */
  async update(id: number, organizationId: number, userId: number, input: Record<string, unknown>): Promise<Ticket> {
    const existing = await conversationRepository.findById(id, organizationId);
    if (!existing) throw AppError.notFound("Conversation not found.");

    const changes: ConversationUpdate = {};

    if (input.takeOver === true) {
      changes.handledBy = ConversationHandler.HUMAN;
      changes.needsHuman = false;
      changes.assigneeId = userId;
    }

    if (input.handledBy !== undefined) {
      if (typeof input.handledBy !== "string" || !HANDLERS.includes(input.handledBy)) {
        throw AppError.validation("handledBy must be 'ai' or 'human'.", "handledBy");
      }
      changes.handledBy = input.handledBy;
      if (input.handledBy === ConversationHandler.AI) changes.needsHuman = false;
    }

    if (input.needsHuman !== undefined) changes.needsHuman = Boolean(input.needsHuman);

    if (input.assigneeId !== undefined) {
      changes.assigneeId = input.assigneeId === "me" ? userId : input.assigneeId === null ? null : Number(input.assigneeId);
      if (changes.assigneeId !== null && isNaN(changes.assigneeId)) {
        throw AppError.validation("Invalid assigneeId.", "assigneeId");
      }
    }

    if (input.status !== undefined) {
      const status = String(input.status).toUpperCase();
      if (!STATUSES.includes(status)) throw AppError.validation("Invalid conversation status.", "status");
      changes.status = status;
    }

    if (input.tags !== undefined) {
      if (!Array.isArray(input.tags)) throw AppError.validation("tags must be a list.", "tags");
      changes.tags = input.tags.map((t) => String(t).trim()).filter(Boolean);
    }

    const updated = await conversationRepository.update(id, organizationId, changes);
    if (!updated) throw AppError.notFound("Conversation not found.");

    publish(organizationId, { type: "conversation.updated", conversationId: updated.id, customerId: updated.customerId });
    return updated;
  }
}

export const conversationService = new ConversationService();
