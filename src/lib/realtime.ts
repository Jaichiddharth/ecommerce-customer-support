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
    | { type: "customer.consent"; customerId: number; isOptedOut: boolean } // WhatsApp marketing consent changed
    | { type: "channel.updated"; channelId: number } // connected, reconnected or disconnected
    | { type: "notification.count"; unread: number }
    | { type: "permissions.updated" }
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
const g = globalThis as unknown as {
    __realtimeBus?: EventEmitter;
    __realtimeOrigin?: string;
    __realtimePg?: Promise<PgClient>;
};
const bus = g.__realtimeBus ?? (g.__realtimeBus = new EventEmitter());
bus.setMaxListeners(0);

/* --------------------------------------------------------------
   Cross-instance delivery (REALTIME_BUS=postgres).
   With one app instance the in-process bus is enough. With several, an
   event published on instance A must reach SSE clients connected to B:
   every event is also sent with Postgres NOTIFY and every instance
   LISTENs and re-emits events that came from another instance.
   No extra infrastructure: it uses the existing database.
---------------------------------------------------------------*/
type PgClient = {
    listen: (channel: string, fn: (payload: string) => void, onlisten?: () => void) => Promise<unknown>;
    notify: (channel: string, payload: string) => Promise<unknown>;
};

const PG_CHANNEL = "unocx_realtime";
/** NOTIFY payloads must stay under 8000 bytes. */
const MAX_NOTIFY_BYTES = 7900;
const crossInstance = () => process.env.REALTIME_BUS === "postgres";
const origin = g.__realtimeOrigin ?? (g.__realtimeOrigin = `${process.pid}-${Math.random().toString(36).slice(2)}-${Date.now()}`);

async function warn(message: string, context: Record<string, unknown>) {
    const { createLogger } = await import("./logger");
    createLogger("Realtime").warn(message, context);
}

/** Starts listening once per process; resolves to the client used for NOTIFY. */
function pgBus(): Promise<PgClient> {
    if (!g.__realtimePg) {
        g.__realtimePg = (async () => {
            const { getPgClient } = await import("./db");
            const client = getPgClient() as unknown as PgClient;
            await client.listen(PG_CHANNEL, (payload) => {
                try {
                    const m = JSON.parse(payload) as { o: string; c: string; e: RealtimeEvent };
                    if (m.o !== origin) bus.emit(m.c, m.e); // our own events were already emitted locally
                } catch {
                    /* malformed payload: ignore */
                }
            });
            return client;
        })();
        g.__realtimePg.catch((err) => {
            g.__realtimePg = undefined; // retried on the next publish/subscribe
            void warn("Realtime Postgres bus unavailable — events reach this instance only", { err });
        });
    }
    return g.__realtimePg;
}

/** Serialized NOTIFY payload, shrunk (metadata dropped, long text cut) when it would exceed the limit. */
function encodeForNotify(channel: string, event: RealtimeEvent): string | null {
    let payload = JSON.stringify({ o: origin, c: channel, e: event });
    if (Buffer.byteLength(payload) <= MAX_NOTIFY_BYTES) return payload;
    if (event.type === "message.new" && event.message && typeof event.message === "object") {
        const { metadata: _metadata, ...message } = event.message as Record<string, unknown>;
        if (typeof message.textContent === "string" && message.textContent.length > 1500) {
            message.textContent = `${message.textContent.slice(0, 1500)}…`;
        }
        payload = JSON.stringify({ o: origin, c: channel, e: { ...event, message } });
        if (Buffer.byteLength(payload) <= MAX_NOTIFY_BYTES) return payload;
    }
    return null;
}

function emit(channel: string, event: RealtimeEvent) {
    const delivered = bus.emit(channel, event);
    if (crossInstance()) {
        const payload = encodeForNotify(channel, event);
        if (!payload) {
            void warn("Realtime event too large for cross-instance delivery — delivered on this instance only", { channel, type: event.type });
        } else {
            pgBus()
                .then((client) => client.notify(PG_CHANNEL, payload))
                .catch((err) => void warn("Realtime NOTIFY failed", { err, channel, type: event.type }));
        }
    }
    return delivered;
}

/** Everyone in the organization receives it (messages, statuses, reactions) */
export const publishToOrg = (orgId: number, event: RealtimeEvent) =>
    emit(`org:${orgId}`, event);

/** Only one user receives it (personal notifications) */
export const publishToUser = (userId: number, event: RealtimeEvent) =>
    emit(`user:${userId}`, event);

/** Old name kept so existing calls keep working */
export const publish = publishToOrg;

/** Listen to several channels at once. Returns an unsubscribe function. */
export const subscribe = (
    channels: string[],
    fn: (e: RealtimeEvent) => void
) => {
    if (crossInstance()) void pgBus().catch(() => undefined);
    channels.forEach((c) => bus.on(c, fn));
    return () => channels.forEach((c) => bus.off(c, fn));
};