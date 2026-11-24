// app/api/support/chat/route.ts  (Next.js App Router)
// Browser -> this route -> UnoCX Python API. The service token never reaches the browser.
import { NextRequest } from "next/server";

const UNOCX_URL = process.env.UNOCX_URL!;            // e.g. http://unocx:8000 (private network)
const UNOCX_TOKEN = process.env.UNOCX_SERVICE_TOKEN!; // same value as SERVICE_TOKEN in the Python .env

export async function POST(req: NextRequest) {
  const { conversationId, messages, page } = await req.json();

  // TODO: replace with your auth. Never trust workspace/user ids sent by the browser.
  const session = { workspaceId: "ws_unocx", user: { id: "u_123", name: "Priya Sharma", email: "priya@example.com" } };

  const upstream = await fetch(`${UNOCX_URL}/v1/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${UNOCX_TOKEN}` },
    body: JSON.stringify({
      workspace_id: session.workspaceId,
      conversation_id: conversationId,
      user: session.user,
      page,                                             // { path: "/help/returns", title: "Returns" }
      messages: messages.slice(-12),                    // last few turns are enough
      settings: { company_name: "UnoCX", brand_voice: "Friendly, short, helpful" },
    }),
    signal: AbortSignal.timeout(20_000),
  }).catch(() => null);

  if (!upstream || !upstream.ok || !upstream.body) {
    // Python service down or slow: send a fallback "done" event so the UI can show the support form.
    const fallback = {
      outcome: "handover", handover_reason: "error", route: "fallback",
      reply: "Let me connect you with our support team. They'll pick this up shortly.",
      action: { type: "form", form: "contact_support", fields: ["name", "email", "message"] },
      citations: [], suggestions: [], flags: ["service_unavailable"],
    };
    return new Response(`event: done\ndata: ${JSON.stringify(fallback)}\n\n`, {
      headers: { "Content-Type": "text/event-stream" },
    });
  }

  // Optional: when the "done" event has outcome === "handover", create a ticket / assign
  // the conversation in your own DB here, using done.handover_summary for the agent.
  return new Response(upstream.body, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
  });
}
