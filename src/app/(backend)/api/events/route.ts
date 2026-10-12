import { subscribe } from "@/lib/realtime";
// Adjust these imports to where your auth helper lives
import { withAuth, type AuthenticatedRequest } from "@/lib/security/auth";
import { NextResponse } from "next/server";

export const runtime = "nodejs";        // EventEmitter needs Node, not Edge
export const dynamic = "force-dynamic"; // never cache a stream

/**
 * GET /api/events
 * Long-lived SSE stream. One per browser tab.
 * Subscribes to the user's organization + the user's personal channel.
 */
export const GET = withAuth(async (req: AuthenticatedRequest) => {
    const orgId = req.user.organizationId;
    const userId = req.user.id;
    const encoder = new TextEncoder();
    let cleanup = () => { };

    const stream = new ReadableStream({
        start(controller) {
            let closed = false;
            const send = (chunk: string) => {
                if (closed) return;
                try {
                    controller.enqueue(encoder.encode(chunk));
                } catch {
                    cleanup();
                }
            };

            // Tell the browser to wait 3s before reconnecting after a drop
            send("retry: 3000\n\n");
            send(": connected\n\n");

            const unsubscribe = subscribe(
                [`org:${orgId}`, `user:${userId}`],
                (event) => {
                    send(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
                }
            );

            // Comment lines keep proxies/load balancers from closing idle streams
            const heartbeat = setInterval(() => send(": ping\n\n"), 25_000);

            cleanup = () => {
                if (closed) return;
                closed = true;
                clearInterval(heartbeat);
                unsubscribe();
                try {
                    controller.close();
                } catch { }
            };

            // Fires when the tab closes or the network drops
            req.signal.addEventListener("abort", cleanup);
        },
        cancel() {
            cleanup();
        },
    });

    return new NextResponse(stream, {
        headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no", // disables Nginx buffering
        },
    });
});