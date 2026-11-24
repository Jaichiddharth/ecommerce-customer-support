# UnoCX AI Service – API contract (v1)

Machine-readable spec: `docs/openapi.json`. TypeScript types: `docs/nextjs/unocx-types.ts`.

Base URL: internal only (e.g. `http://unocx-ai:8000`). Every endpoint except `/health` and
`/playground` needs `Authorization: Bearer <SERVICE_TOKEN>`. Interactive docs: `/docs` (OpenAPI).

Next.js must set `workspace_id` and `user` from its own session. The service trusts whatever
Next.js sends, so never forward these values from the browser.

## POST /v1/chat

Returns one JSON reply. Use `/v1/chat/stream` for the chat UI.

```json
{
  "workspace_id": "ws_unocx",
  "conversation_id": "c_8f2a",
  "user": { "id": "u_123", "name": "Priya Sharma", "email": "priya@example.com", "plan": "pro" },
  "page": { "path": "/help/returns", "title": "Returns" },
  "messages": [
    { "role": "user", "content": "How long do refunds take?" }
  ],
  "settings": {
    "company_name": "UnoCX",
    "brand_voice": "Friendly, short, helpful",
    "language": "match_customer",
    "max_turns": 10,
    "source_ids": null
  }
}
```

| Field | Required | Notes |
|---|---|---|
| `workspace_id` | yes | every query is filtered by it |
| `conversation_id` | yes | stable for the whole chat; used for turn limit, "second miss" and rate limit |
| `messages` | yes | full history, oldest first. **Last message must be `role: "user"`** (else 422). Sending the last ~12 is enough |
| `user.id` | recommended | rate limit is per user; without it, per conversation |
| `user.name`, `user.email` | optional | first name is used in greetings; both prefill the support form |
| `user.id`, `user.email`, `user.phone` | for order lookups | identify the customer for "where is my order?". `user.id` = the store's customer id; `user.phone` = WhatsApp number with country code. Set them from your session / channel, never from what the customer types |
| `commerce` | optional | the customer's orders from the connected stores, looked up by the app (see below). When present it replaces the demo order data |
| `page` | optional | slightly boosts articles related to the current page |
| `settings.language` | optional | `match_customer` or a fixed language, e.g. `English` |
| `settings.source_ids` | optional | restrict answers to these knowledge sources |

### Order data (`commerce`)

```json
"commerce": {
  "status": "ok",                       // or "no_store": the channel has no store
  "stores": [{
    "ref": "shopify:12", "platform": "shopify", "name": "Main store",
    "status": "ok",                     // or "unavailable": couldn't be read now -> order questions are handed over
    "customer_ref": "gid://shopify/Customer/7", "customer_name": "Asha",   // null: no matching customer
    "orders": [{
      "order_number": "#1001", "order_id": "gid://shopify/Order/1", "items": "Linen shirt + 1 more",
      "quantity": 3, "total": 2499, "currency": "INR",
      "status": "Shipped",              // Pending | Shipped | Delivered | Returned | Cancelled
      "delivery_status": "out_for_delivery", "partially_shipped": false,
      "order_date": "2026-11-10T10:00:00Z", "shipping_date": "2026-11-11T12:00:00Z",
      "expected_delivery": null, "delivered_at": null, "cancelled_at": null,
      "courier": "Delhivery", "tracking_number": "DL123", "tracking_url": "https://..."
    }]
  }]
}
```

Orders from several stores are merged, newest first. When more than one store has orders, each order
is labelled with its store name. Customers can name an order as "#1001", "order 1001" or just
"1001"; a number that isn't theirs gets "not found on your account". Without `commerce`, the demo
`commerce` schema is used if `DEMO_ORDERS=true`.

### Response

```json
{
  "run_id": "run_7fb9694ff03c41f0",
  "conversation_id": "c_8f2a",
  "outcome": "answered",
  "handover_reason": null,
  "handover_summary": null,
  "reply": "Refunds start after a quality check, usually within 2 business days of pickup...",
  "route": "rag",
  "citations": [{ "source_id": "ks_1a2b", "chunk_id": 42, "title": "Returns And Refunds > Refund timelines", "url": "/help/returns-and-refunds" }],
  "suggestions": ["Refunds for Cash on Delivery orders", "No, that's all"],
  "ended": false,
  "action": null,
  "flags": [],
  "usage": { "model": "gpt-4o-mini", "input_tokens": 1830, "output_tokens": 95, "cost_usd": 0.000332 },
  "latency_ms": 2140,
  "confidence": 0.86,
  "trace": {
    "timings_ms": { "rules": 4.1, "embed": 180.2, "cache": 3.0, "retrieval": 9.4, "llm": 1890.5, "post": 1.2, "total": 2140 },
    "retrieval": { "best_sim": 0.61, "gate": 0.3, "fts_hit": true, "passed_gate": true,
                   "top": [{ "title": "Returns And Refunds > Refund timelines", "source_id": "ks_1a2b", "chunk_id": 42,
                             "sim": 0.61, "vec_rank": 1, "fts_rank": 1 }] },
    "followup": false,
    "unsupported_numbers": []
  }
}
```

### What the UI should do with each outcome

| `outcome` | Meaning | UI |
|---|---|---|
| `answered` | reply is final | show reply, citations as links, suggestions as chips, thumbs up/down when `route` is `rag` or `cache` |
| `clarify` | needs more detail or a choice | show reply and suggestions as chips |
| `handover` | a person should take over | show reply; if `action.type == "form"` render the support form; create a ticket with `handover_summary`; stop sending messages to the AI for this conversation |
| `blocked` | refused or safety warning | show reply; nothing else |

`suggestions` are one-tap replies; tapping one sends its text as the customer's next message. Finished answers
end with `"No, that's all"`. `ended: true` means the customer closed the chat ("No, that's all", "thanks, bye"):
the reply is a short goodbye, and nothing is open. More thanks after that get an empty `reply`: send nothing.

How wrapping up works: "thank you" / "ok, got it" after an answer is asked "Is there anything else I can help
you with?" (with a "No, that's all" button); "no" / "that's all" / "bye" then gets the goodbye. A message that
also asks something ("thanks, where is my order?") is answered normally. Rules: `closing_kind` in
`app/dialogue.py`, `_wrap_up` in `app/agent.py`.

`handover_reason`: `customer_asked_human`, `sensitive_topic`, `no_answer`, `turn_limit`,
`budget_exceeded`, `error`, `refund_request` (the customer asked for money back; only a person can
approve refunds), `unresolved` (the AI couldn't resolve it: the customer was unhappy twice, or the
reply would have repeated twice).

**Handover is remembered.** Once a conversation is handed over, the AI replies only "Our team has this
conversation and will reply here shortly" (flag `awaiting_agent`) until it is resumed:
`POST /v1/conversations/resume` with `{workspace_id, conversation_id}`. Handovers expire after 24 hours.

`route`: `flow` (keyword flow, free), `cache` (reused answer, free), `rag` (search + LLM),
`guardrail` (rule-based reply), `fallback` (error or budget), `tool` (order status from order
data, free; `trace.tool` lists the order numbers shown).

`trace.embed_source` says where the question's embedding came from: `memory` or `db` (cached, no
OpenAI call) or `api` (one OpenAI round trip).

`trace.tool.matched_by` says how the order question was recognised: `keyword`, `semantic` (meaning,
layer 2) or `llm` (the AI, layer 3); `trace.order_intent` holds the layer-2 scores. Extra flags:
`order_intent_semantic`, `order_intent_llm`.

Order-status flags: `order_lookup` (answered from order data), `order_not_on_account` (the order
number isn't this customer's; nothing about it is revealed), `order_lookup_unverified` (an order
number was given but the customer isn't identified).

`action` (only when present):

```json
{ "type": "form", "form": "contact_support", "fields": ["name", "email", "message"],
  "prefill": { "name": "Priya Sharma", "email": "priya@example.com" } }
```

`flags` are for logs and dashboards, e.g. `prompt_injection`, `other_customer_data`,
`card_number_masked`, `secret_masked`, `sensitive:legal`, `no_relevant_knowledge`,
`rate_limited`, `input_truncated`, `unknown_url_removed`, `reply_truncated`, `unsupported_number`,
`model_said_handover`.

`confidence` is 0–1: 1.0 for rule-based replies, 0.95 for cached answers, computed from retrieval
strength and risk signals for AI answers, null on errors. `trace` is for debugging and metrics;
the chat UI doesn't need it (a "Why this answer" panel can use it). See `docs/EVALUATION.md`.

## POST /v1/chat/stream

Same request. Server-sent events:

```
event: meta    data: {"run_id": "...", "route": "rag"}
event: delta   data: {"text": "Refunds "}          (repeats)
event: done    data: { ...full response as above... }
```

Always replace the streamed text with `done.reply`. The final reply has passed the post-checks
(unknown links removed, length capped); streamed pieces have not. Guardrail and flow replies
arrive as a single `delta` followed by `done`.

## POST /v1/feedback

```json
{ "workspace_id": "ws_unocx", "run_id": "run_7fb9...", "helpful": true, "comment": "optional" }
```

One vote per run (a second call returns `{"ok": true, "note": "feedback already recorded..."}`).
Two thumbs-up on the same answer put it in the cache; two net thumbs-down disable it.

## Complaints

When an order is marked delivered but the customer says it never arrived, the AI first gives next
steps (check with neighbours, contact the courier with the tracking number). If the customer has
already done that, it raises a complaint and the chat reply carries:

```json
"action": { "type": "complaint", "reference": "CMP-000123", "order_number": "UX109216",
            "category": "order_not_received", "status": "open", "created": true, "summary": "Customer 14 reports…" }
```

Create a ticket from it in your system. An open complaint for the same order and category is reused
(`created: false`). Categories: `order_not_received`, `damaged_item`, `wrong_item`, `missing_item`,
`order_delayed`, `payment_issue`, `other`.

**Order problems.** For a signed-in customer, damaged, wrong or missing items, return, cancel,
address-change and payment problems are answered with that customer's order facts, the business's own
process from its help articles, and a next step (complaint offer, or a person for changes only the team
can make). `trace.tool` = `{"name": "order_issue", "issue": "<type>", "orders": [...]}`; flag `issue:<type>`.

**Conversation memory.** Each reply's `trace.dialogue` records what it offered (`support`, `complaint`,
`choose_order`), so the next message ("yes", "no thanks", "the clothing one", "Raise a complaint") is
understood. The same reply is never sent twice in a row (flag `repeat_avoided`); an unhappy customer
("that's not what I asked", "this is taking forever") gets a change of approach (flag
`customer_unhappy`), then a person.

| Method | Path | Notes |
|---|---|---|
| GET | `/v1/complaints?workspace_id=&status=open&limit=50` | newest first; `status` optional |
| PATCH | `/v1/complaints/{reference}` | body `{workspace_id, status}`, status `open` / `in_progress` / `resolved` |

Courier contact details shown to customers come from `commerce.couriers` (per workspace). The order
loader adds each courier's official website; set phone numbers yourself, for example:
`UPDATE commerce.couriers SET phone='<number>' WHERE workspace_id='ws_unocx' AND name='Blue Dart';`
The AI never invents contact details.

## Knowledge sources

| Method | Path | Body / params | Notes |
|---|---|---|---|
| POST | `/v1/knowledge/sources` | `{workspace_id, type, title, content?, uri?}` | `type`: `text`, `markdown`, `faq`, `url`. FAQ content: JSON `[{"q","a"}]` or `Q: ... A: ...` text. Returns 202, syncs in background |
| POST | `/v1/knowledge/upload` | multipart: `workspace_id`, `title`, `uri?`, `file` | PDF up to 20 MB. Response lists `scanned_pages` (no text layer, skipped) |
| GET | `/v1/knowledge/sources?workspace_id=` | | list with `status` (`queued`, `syncing`, `live`, `error`), `item_count`, `error` |
| GET | `/v1/knowledge/sources/{id}?workspace_id=` | | one source |
| POST | `/v1/knowledge/sources/{id}/sync?workspace_id=` | | re-sync; old chunks stay live if the sync fails |
| DELETE | `/v1/knowledge/sources/{id}?workspace_id=` | | removes the source and its chunks |

Website sources crawl pages under the given path only, up to 200 pages, respecting robots.txt.

## Keyword flows

| Method | Path | Notes |
|---|---|---|
| GET | `/v1/flows?workspace_id=` | list |
| POST | `/v1/flows` | see body below |
| DELETE | `/v1/flows/{id}?workspace_id=` | |

```json
{
  "workspace_id": "ws_unocx", "name": "Greeting",
  "keywords": ["hi", "hello", "namaste"], "match_type": "exact", "max_words": 3,
  "reply_text": "Hi {name}! What can I help you with?",
  "outcome": "answered", "action": null, "suggestions": ["Return an item", "Talk to support"],
  "priority": 10, "enabled": true
}
```

`match_type: fuzzy` tolerates typos for keywords of 4+ characters. `max_words` limits a flow to
short messages, so "hi, my refund hasn't come" goes to the AI instead of the greeting.
`{name}` is replaced with the customer's first name. `outcome: "handover"` turns a flow into a
handover. Changes apply within 30 seconds.

## Insights

| Path | Returns |
|---|---|
| `GET /v1/insights/summary?workspace_id=&days=7` | runs, answered, handovers, free answers, thumbs up/down, cost, p90 latency |
| `GET /v1/insights/gaps?workspace_id=&days=30` | questions with no good answer or a thumbs-down, most frequent first. Use it to decide which help articles to write |
| `GET /v1/insights/quality?workspace_id=&days=7&low_confidence=0.5` | quality rates (likely resolution, knowledge misses, thumbs-down, low confidence, unsupported numbers, cost per answer), handover reasons, per-article quality, latency by stage, and a review queue of risky answers. Fields explained in `docs/EVALUATION.md` §8 |

## GET /health

`{"ok": true, "version": "1.0.0", "env": "production", "provider": "openai", "spent_usd": 0.42, "budget_usd": 7.5, "budget_ok": true}`

## Errors and timeouts

| Status | When |
|---|---|
| 401 | wrong or missing service token |
| 404 | run, source or flow not found in that workspace |
| 413 | PDF over 20 MB |
| 422 | invalid body, last message not from the user, file is not a PDF |

LLM errors and timeouts (12 s) do not return an error status: the service replies with
`outcome: handover`, `handover_reason: error`. Next.js should still apply its own 20-second
timeout and show the support form if the service is unreachable (see `docs/nextjs/chat-route.ts`).

## Chat widget: `catalog`, `sales` and `products`

Widget chats add these fields to `POST /v1/chat`:

```json
"sales": { "enabled": true, "assistant_name": "Mia", "offer": "WELCOME10 for 10% off", "goal": "balanced" },
"catalog": [{ "ref": "P1", "title": "Linen shirt", "price": "₹1,499", "compare_at_price": "₹1,999",
              "url": "https://shop/p/linen", "buy_url": "https://shop/cart/123:1", "image_url": "…", "available": true }]
```

- **When the sales assistant answers:** shopping questions (`sales.wants_products`), and questions the help articles don't cover, are answered with `route: "sales"`. Support rules run first.
- **The response** lists the recommended products in `products` (same shape, at most 3). Tags like `[P1]` are removed from `reply`.
- **`goal`:** `helpful`, `balanced` or `proactive`.

## Bring your own model: `settings.llm`

```json
"settings": { "llm": { "provider": "anthropic", "model": "claude-haiku-5-5", "api_key": "…", "monthly_limit_usd": 50 } }
```

- **Providers:** `openai`, `anthropic`, `gemini` or `groq`.
- **Scope:** the key is used only for the reply-writing call. It is never stored or logged by this service.
- **Fallback:** the reply uses UnoCX's model on failure (flag `byo_failed`) or over the limit (`byo_limit_reached`).
- **`POST /v1/llm/test { "llm": {...} }`** makes one tiny call and returns `{ "ok": true, "model", "latency_ms" }` or `{ "ok": false, "error" }`. The error is readable and never contains the key.

## Test cases with order data, products and a source

`POST /v1/tests/cases` accepts `commerce` on each case: the same shape as the chat request's `commerce`. Test runs send it with the case, so order-status tests answer from those orders.

- **`catalog`:** shopping checks carry the products on offer (same shape as the chat request's `catalog`, at most 8). Those checks run with the shopping assistant on.
- **`source`:** `manual` (default), `sample_orders`, `sample_products` or `knowledge_gap` (made from a knowledge gap). Generated checks are replaced with `DELETE /v1/tests/cases?workspace_id=…&source=sample_orders`.
- **Category:** `Shopping` is a test category.

## Knowledge gaps

Help questions answered badly are recorded in `ai.knowledge_gaps` while the run is logged (route `rag` and: the `no_relevant_knowledge` flag, a `low_confidence` handover, or an answer with confidence below 0.70), and on a thumbs-down (`POST /v1/feedback`). Wordings are grouped by content words, or by embedding similarity of 0.78 or more. Conversations starting `trun_` (test runs) or `gaprt_` (re-tests) are skipped.

- **`GET /v1/gaps?workspace_id&status=open|resolved|ignored|all`** returns `{ threshold, summary, gaps }`. Gaps come most worth fixing first. `summary` has open / resolved / ignored counts, `open_asks`, `verified` (re-tested at the threshold or above), `avg_gain`, and `help` (help questions in the last 30 days: `asked`, `confident`, `avg_confidence`).
- **`POST /v1/gaps/{id}/resolve { workspace_id, answer, question?, add_to_knowledge = true, add_check = true, settings }`** writes the Q&A into the workspace's FAQ source (`uri = unocx:knowledge-gaps`, created on first use) and a check (`source = knowledge_gap`), then marks the gap resolved. In the background it indexes the FAQ, asks the question again (`retest_*` fields), and re-tests up to 5 open gaps at least 0.6 similar. Open gaps answered at the threshold or above close by themselves.
- **`POST /v1/gaps/{id}/retest { workspace_id, settings }`** asks again now and returns the gap.
- **`POST /v1/gaps/{id}/check { workspace_id }`** adds the question to the checks without an answer.
- **`PATCH /v1/gaps/{id} { workspace_id, status: "ignored" | "open" }`** ignores a gap or puts it back.
- **Reopening:** a resolved gap asked again with a gap-level answer goes back to `open` with `reopened = true`.
- **Test runs:** a test run updates the `retest_*` fields of gaps whose check it ran.

## Guardrail settings in `settings.policy`

New policy fields (all optional; defaults shown):

```json
"policy": {
  "tone": "friendly",                       // professional | friendly | casual | premium | custom
  "reply_length": "medium",                 // short | medium | detailed
  "topics": { "business_only": true, "restricted": [], "competitors": [] },
  "moderation": { "profanity": true, "harmful": true, "output_filter": true },
  "advanced": { "groundedness_check": false, "injection_classifier": false, "ai_moderation": false },
  "retention_days": 90
}
```

- **`advanced`:** this service trusts the flags. The app sends `true` only when the workspace's plan includes the check.
- **`mask_phone_in_logs`:** ignored; logs are always masked.
- **`handover.sensitive_topics`:** covers legal topics only. Self-harm, fraud and safety always hand over.
- **`retention_days`:** stored per workspace (`ai.workspace_settings`) and enforced by an hourly sweep (`RETENTION_SWEEP`, `RETENTION_SWEEP_INTERVAL_S`, `RETENTION_DEFAULT_DAYS`).
- **New flags in responses:**
  - `off_topic`, `restricted_topic`, `moderation:<category>`, `prompt_injection_semantic` (with `injection_score:<n>`);
  - `output_email_removed`, `output_phone_removed`, `output_credential_removed`, `output_card_number_masked`, `output_secret_masked`;
  - `unsupported_price_removed`, `competitor_removed`, `output_profanity_blocked`, `catalog_injection_removed`;
  - `groundedness_checked`, `ungrounded`, `tool_denied:<reason>`.
- **Knowledge sources** have `flagged_count`: passages left out because they carried instructions aimed at the AI. The reason is in `error`, and the source stays `live`.
- **Streaming:** `/v1/chat/stream` deltas are the raw model text. Only the final `done` event has passed the output checks, so clients must show `done.reply`. The UnoCX app uses `/v1/chat`.

## Shipping address (`commerce` orders, `settings.policy`)

Each order in `commerce.stores[].orders` may carry the shipping address:

```json
"shipping_address": { "name": "Asha Kumar", "line1": "Flat 4B, 12 MG Road", "line2": "Near Trinity Metro",
                      "city": "Bengaluru", "province": "Karnataka", "zip": "560001", "country": "India", "phone_last4": "0001" }
```

- **Phone:** send only the last 4 digits of the delivery phone. Send `null` when the store didn't give the address.
- **Policy:** `address_enabled` (default true) and `address_change_url` (https, optional; without it, replies show "Sample link").
- **Who sees it:** the address is shown only to the identified customer for their own order, in a reply built by this service. It is never put in a model prompt.
- **Redaction:** earlier replies containing it are redacted from the history sent to the model, and the logged reply has it replaced with `[shipping address shown to the customer]`.
- **Flags:** `address_lookup`, `address_shown`, `address_unavailable`, `address_change`.
- **Tool states:** `trace.tool.name = "shipping_address"`; states `shown`, `choose`, `not_found`, `unavailable`, `change_requested`, `delivered`, `cancelled`, `confirmed`.

## Website chat (`channel: "web"`)

`sales` carries the visitor's requirements and where order questions go:

```json
"sales": { "enabled": true, "assistant_name": "Mia", "offer": null, "goal": "balanced",
           "criteria": "budget up to $100 · for women · size M", "criteria_matched": false, "relaxed": ["size"],
           "order_help_url": "https://wa.me/15551945818?text=Hi!%20I%20need%20help%20with%20my%20order." }
```

- **`criteria`:** the visitor's requirements, read by the app; the shopping prompt states them.
- **`criteria_matched: false`:** the reply must first say honestly what isn't available. `relaxed` lists what was dropped (`product`, `colour`, `size`, `budget`, `gender`).
- **Order questions:** with `channel: "web"` and `sales` present, order questions (status, problems, address, refunds, exchanges, cancellations) are not answered. The reply has flag `order_redirect`, and `action: {"type": "whatsapp", "url": order_help_url}` when a URL is given.
- **Asking for a person:** on the web it replies "A member of our team will reply here shortly." (no contact form).
- **Markdown:** `**bold**` is stripped from replies; chat windows show text as typed.
