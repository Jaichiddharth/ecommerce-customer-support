import {
  conversationRepository,
  type ConversationListItem,
  type ConversationUpdate,
  type TicketEventInput,
} from "../db/repositories";
import { ConversationHandler, TicketStatus, type Ticket } from "../db/schema";
import { AppError } from "../errors";
import { publish } from "../realtime";
import { customerService } from "./customer.service";
import { isClosedTicketStatus, type TicketCredits } from "../../types/ticket";

const HANDLERS: string[] = Object.values(ConversationHandler);
const STATUSES: string[] = Object.values(TicketStatus);

/** The teammate making an inbox change, recorded in the ticket's audit notes */
export interface TicketActor {
  id: number;
  name: string;
}

export class ConversationService {
  async listForInbox(organizationId: number, onlyAssigneeId?: number): Promise<ConversationListItem[]> {
    return await conversationRepository.listForInbox(organizationId, onlyAssigneeId);
  }

  async ticketCredits(organizationId: number): Promise<TicketCredits> {
    return await conversationRepository.ticketCredits(organizationId);
  }

  /**
   * Applies an inbox action (AI/human mode, take over, assign, resolve, tags), records who changed what in the
   * thread, and notifies the organization.
   */
  async update(id: number, organizationId: number, actor: TicketActor, input: Record<string, unknown>): Promise<Ticket> {
    const existing = await conversationRepository.findById(id, organizationId);
    if (!existing) throw AppError.notFound("Conversation not found.");
    await customerService.requireVisible(existing.customerId, organizationId);

    const changes: ConversationUpdate = {};
    const takeOver = input.takeOver === true;

    if (takeOver) {
      changes.handledBy = ConversationHandler.HUMAN;
      changes.needsHuman = false;
      changes.assigneeId = actor.id;
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
      changes.assigneeId = input.assigneeId === "me" ? actor.id : input.assigneeId === null ? null : Number(input.assigneeId);
      if (changes.assigneeId !== null && isNaN(changes.assigneeId)) {
        throw AppError.validation("Invalid assigneeId.", "assigneeId");
      }
    }

    // Only a teammate of this workspace can own its tickets
    let assigneeName: string | null = null;
    if (changes.assigneeId != null) {
      assigneeName = (await conversationRepository.userNames(organizationId, [changes.assigneeId])).get(changes.assigneeId) ?? null;
      if (assigneeName === null) throw AppError.validation("That teammate isn't in this workspace.", "assigneeId");
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

    for (const event of ticketEvents(existing, updated, actor, { takeOver, assigneeName })) {
      await conversationRepository.logEvent(updated, event);
    }

    publish(organizationId, { type: "conversation.updated", conversationId: updated.id, customerId: updated.customerId });
    return updated;
  }
}

/** The audit notes for an inbox action: what actually changed between the ticket before and after */
function ticketEvents(
  before: Ticket,
  after: Ticket,
  actor: TicketActor,
  ctx: { takeOver: boolean; assigneeName: string | null }
): TicketEventInput[] {
  const by = { actorType: "agent" as const, actorId: actor.id, actorName: actor.name };
  const events: TicketEventInput[] = [];

  if (before.status !== after.status) {
    const wasClosed = isClosedTicketStatus(before.status);
    const isClosed = isClosedTicketStatus(after.status);
    events.push({
      ...by,
      action: isClosed && !wasClosed ? "resolved" : wasClosed && !isClosed ? "reopened" : "status",
      previousStatus: before.status,
      status: after.status,
    });
  }

  const assigneeChanged = before.assigneeId !== after.assigneeId;
  const handlerChanged = before.handledBy !== after.handledBy;

  // Taking over is one change for the team, even when it both assigns and pauses the AI agent
  if (ctx.takeOver && (assigneeChanged || handlerChanged)) {
    events.push({ ...by, action: "assigned", assigneeId: after.assigneeId, assigneeName: ctx.assigneeName, assignReason: "take_over" });
    return events;
  }

  if (assigneeChanged) {
    events.push(
      after.assigneeId === null
        ? { ...by, action: "unassigned", assigneeId: null }
        : { ...by, action: "assigned", assigneeId: after.assigneeId, assigneeName: ctx.assigneeName, assignReason: "manual" }
    );
  }

  if (handlerChanged) {
    events.push({ ...by, action: after.handledBy === ConversationHandler.AI ? "ai_on" : "ai_off" });
  }

  return events;
}

export const conversationService = new ConversationService();
