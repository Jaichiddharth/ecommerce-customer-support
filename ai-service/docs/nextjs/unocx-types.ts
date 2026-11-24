// lib/unocx-types.ts - TypeScript types for the UnoCX AI Service API v1 (service version 1.4.0).
// Source of truth: docs/openapi.json (regenerate with `python -m scripts.export_openapi`).

export type Role = "user" | "assistant";
export type Outcome = "answered" | "clarify" | "handover" | "blocked";
export type HandoverReason =
  | "customer_asked_human" | "sensitive_topic" | "no_answer" | "turn_limit" | "budget_exceeded" | "error"
  | "refund_request"    // the customer asked for money back: only a person can approve refunds
  | "unresolved";       // the AI couldn't resolve it (customer unhappy twice, or a repeat loop): a person takes over
export type Route = "flow" | "cache" | "rag" | "guardrail" | "fallback" | "tool";
export type Language = "English" | "Hinglish" | "Hindi" | "Tamil" | "Tanglish";

export interface ChatRequest {
  workspace_id: string;                 // from YOUR session, never from the browser
  conversation_id: string;              // stable for the whole chat
  // For order lookups (WISMO): id = the store's customer id; phone = WhatsApp number with country code.
  user?: { id?: string; name?: string; email?: string; phone?: string; plan?: string };
  page?: { path?: string; title?: string } | null;
  messages: { role: Role; content: string }[];   // oldest first; last one must be "user"
  settings?: {
    company_name?: string;              // default "our store"
    brand_voice?: string;               // max 200 chars
    language?: "match_customer" | string;   // or a fixed language, e.g. "English"
    max_turns?: number;
    source_ids?: string[] | null;       // restrict answers to these knowledge sources
  };
}

export interface Citation { source_id: string; chunk_id?: number | null; title?: string | null; url?: string | null }

export interface SupportFormAction {
  type: "form"; form: "contact_support"; fields: string[];
  prefill?: { name?: string | null; email?: string | null };
}

// Returned when the AI raised a complaint for the business's team (e.g. delivered but not received).
// Create a ticket from it in your system; the list is also at GET /v1/complaints.
export interface ComplaintAction {
  type: "complaint"; reference: string; order_number: string | null;
  category: "order_not_received" | "damaged_item" | "wrong_item" | "missing_item" | "order_delayed" | "payment_issue" | "other";
  status: "open" | "in_progress" | "resolved"; created: boolean; summary?: string;
}

export interface ChatResponse {
  run_id: string;                        // send back with feedback
  conversation_id: string;
  outcome: Outcome;
  handover_reason: HandoverReason | null;
  handover_summary: string | null;       // show to the human agent in the inbox
  reply: string;
  route: Route;
  citations: Citation[];
  suggestions: string[];                 // render as quick-reply chips
  action: SupportFormAction | ComplaintAction | null;  // form: render it · complaint: create a ticket
  flags: string[];
  usage: { model: string | null; input_tokens: number; output_tokens: number; cost_usd: number };
  latency_ms: number;
  confidence: number | null;             // 0-1
  trace: {
    timings_ms?: Record<string, number>;
    retrieval?: { best_sim: number; gate: number; fts_hit: boolean; passed_gate: boolean;
                  top: { title: string; source_id: string; chunk_id: number; sim: number;
                         vec_rank: number | null; fts_rank: number | null }[] } | null;
    followup?: boolean;
    unsupported_numbers?: string[];
    language?: Language | null;
    tool?: { name: "order_status"; matched: boolean; matched_by?: "keyword" | "semantic" | "llm";
             orders?: string[]; state?: string } | null;
    order_intent?: { order_sim: number; policy_sim: number; decision: "order" | "maybe" | "no" } | null;
    embed_source?: "memory" | "db" | "api" | null;   // "api" = an OpenAI round trip was needed
  };
}

// Server-sent events from POST /v1/chat/stream
export type StreamEvent =
  | { event: "meta"; data: { run_id: string; route: Route } }
  | { event: "delta"; data: { text: string } }
  | { event: "done"; data: ChatResponse };   // always replace streamed text with data.reply

export interface FeedbackRequest { workspace_id: string; run_id: string; helpful: boolean; comment?: string }

export interface KnowledgeSource {
  id: string; type: "text" | "markdown" | "faq" | "pdf" | "url"; title: string; uri: string | null;
  status: "queued" | "syncing" | "live" | "error"; item_count: number; error: string | null;
  last_synced_at: string | null; created_at: string;
}
