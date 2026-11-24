// hooks/useSupportChat.ts - minimal client hook for the streaming endpoint.
"use client";
import { useRef, useState } from "react";

export type ChatResponse = {
  run_id: string; outcome: "answered" | "clarify" | "handover" | "blocked";
  handover_reason: string | null; reply: string; route: string;
  citations: { source_id: string; title?: string; url?: string }[];
  suggestions: string[]; action: { type: "form"; form: string; fields: string[]; prefill?: Record<string, string> } | null;
  flags: string[];
};
export type Msg = { role: "user" | "assistant"; content: string; meta?: ChatResponse };

export function useSupportChat(page?: { path: string; title?: string }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const conversationId = useRef(crypto.randomUUID());

  async function send(text: string) {
    if (busy) return;                                   // prevents double-send
    setBusy(true);
    const history: Msg[] = [...messages, { role: "user", content: text }];
    setMessages([...history, { role: "assistant", content: "" }]);
    try {
      const res = await fetch("/api/support/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: conversationId.current, page,
          messages: history.map(({ role, content }) => ({ role, content })) }),
      });
      const reader = res.body!.getReader(); const dec = new TextDecoder(); let buf = "", text = "";
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          const event = block.match(/^event: (.*)$/m)?.[1];
          const data = JSON.parse(block.match(/^data: (.*)$/m)?.[1] ?? "{}");
          if (event === "delta") { text += data.text; setLast({ role: "assistant", content: text }); }
          // Always replace streamed text with the final reply: it has passed the safety post-checks.
          if (event === "done") setLast({ role: "assistant", content: data.reply, meta: data });
        }
      }
    } catch {
      setLast({ role: "assistant", content: "Something went wrong. Please try again or contact support." });
    } finally { setBusy(false); }
  }

  function setLast(m: Msg) { setMessages(prev => [...prev.slice(0, -1), m]); }

  async function feedback(runId: string, helpful: boolean) {
    await fetch("/api/support/feedback", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId, helpful }) });
  }

  return { messages, busy, send, feedback, reset: () => { setMessages([]); conversationId.current = crypto.randomUUID(); } };
}
