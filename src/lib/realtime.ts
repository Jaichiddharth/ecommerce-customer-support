import { EventEmitter } from "events";

/* --------------------------------------------------------------
   Every event that can travel over SSE.
   Add a new line here for each future realtime feature.
---------------------------------------------------------------*/
export type RealtimeEvent =
    | {
        type: "message.new";
        customerId: number;
        customer?: { id: number; name?: string | null; phone?: string | null; channelId?: number | null };
        message: any;
    }
    | {
        type: "message.status";
        customerId?: number;
        metaMessageId: string;
        status: number | string;
        errorCode?: number | null;
    }
    | {
        type: "message.reaction";
        customerId?: number;
        messageId: number;
        emoji: string | null; // null = reaction removed
        userId?: number | null;
    }
    | { type: "conversation.updated"; conversationId: number; customerId: number }
    | { type: "channel.updated"; channelId: number } // connected, reconnected or disconnected
    | {
        type: "template.status"; // Meta reviewed, paused or disabled a message template
        wabaId: string;
        templateId: string;
        name: string;
        language: string;
        status: string; // APPROVED, REJECTED, PENDING, PAUSED, DISABLED, …
        reason?: string | null; // Meta's rejection reason, e.g. PROMOTIONAL
    }
    | { type: "notification.count"; unread: number };

// globalThis keeps ONE bus across Next.js hot reloads / route modules
const g = globalThis as unknown as { __realtimeBus?: EventEmitter };
const bus = g.__realtimeBus ?? (g.__realtimeBus = new EventEmitter());
bus.setMaxListeners(0);

/** Everyone in the organization receives it (messages, statuses, reactions) */
export const publishToOrg = (orgId: number, event: RealtimeEvent) =>
    bus.emit(`org:${orgId}`, event);

/** Only one user receives it (personal notifications) */
export const publishToUser = (userId: number, event: RealtimeEvent) =>
    bus.emit(`user:${userId}`, event);

/** Old name kept so existing calls keep working */
export const publish = publishToOrg;

/** Listen to several channels at once. Returns an unsubscribe function. */
export const subscribe = (
    channels: string[],
    fn: (e: RealtimeEvent) => void
) => {
    channels.forEach((c) => bus.on(c, fn));
    return () => channels.forEach((c) => bus.off(c, fn));
};