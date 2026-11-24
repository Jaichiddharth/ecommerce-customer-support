# Changelog

All notable changes to the UnoCX AI Service. The API is versioned by URL (`/v1`); within a
version, changes are additive only.

## 1.5.0 – per-workspace policy and the dashboard API

The UnoCX dashboard (AI agent screens) now configures the agent per business. All additions are
backwards compatible: a request without `settings.policy` behaves exactly like 1.4.0.

- `settings.policy` on every chat request: handover rules (ask for a person: any language / English
  only; angry tone with low / medium / high sensitivity; legal, fraud and safety topics; low confidence
  with a threshold; turn limit; high-value order above an amount; repeat contact within N hours),
  a "never say or promise" list (in the prompt, plus a post-check that replaces a slip with a polite
  refusal), allowed reply languages, max reply length, model tier (standard / advanced via
  `CHAT_MODEL_ADVANCED`), WISMO and FAQ on/off, welcome message and quick replies, phone masking in
  logs, transcript retention.
- Platform rules that can't be switched off: refunds **and exchanges** always go to a person
  (new `exchange_request`), self-harm care, injection and other-customers'-data refusals, card/OTP masking.
- Order questions from customers who aren't signed in get `action: {"type": "login"}` instead of a
  policy answer; the UI shows a sign-in button.
- `test: true` and `channel` on chat requests; test chats are flagged and left out of every metric and
  of the rate limit.
- New endpoints: `GET /v1/insights/overview` (resolution rate vs previous period, handovers, first-reply
  time, resolutions by day, top topics, recent handovers), `GET /v1/insights/usage` (month to date),
  `PATCH /v1/knowledge/sources/{id}` (rename, edit and re-index, draft/live via `enabled`),
  `GET /v1/knowledge/sources/{id}/content`, `GET /v1/knowledge/stats`, `POST /v1/knowledge/rebuild`,
  and the test set: `GET/POST /v1/tests/cases`, `DELETE /v1/tests/cases/{id}`, `POST /v1/tests/runs`,
  `GET /v1/tests/runs[/latest|/{id}]` (deterministic checks, then an LLM judge for free-text expectations).
- Schema (additive): `knowledge_sources.enabled/updated_at`, `agent_runs.channel`, `ai.test_cases`,
  `ai.test_runs`.
- Fix: order dates crashed on Windows (`%-d` is Linux-only).
- 25 new tests (`test_policy.py`, `test_admin_api.py`).

## 1.4.0 – resolve issues across the whole conversation

From an audit of 15 mixed WISMO + help conversations, almost all of which needed a fix:

- Phase 1, every conversation:
  - Never sends the same reply twice in a row: changes approach (latest status + complaint or a person),
    and hands over as `unresolved` if it would repeat again. Help answers reusing an article for a genuine
    follow-up are allowed.
  - Detects an unhappy customer ("that's not what I asked", "you already told me", "this is taking
    forever"): apologises and asks, then hands over; a late order + frustration raises a delay complaint.
  - Remembers what it offered (`trace.dialogue`): "yes" / "no thanks" / "Raise a complaint" answer the
    offer; "the electronics one" / "the second one" pick from listed orders; two matches → asks which.
  - "where is mine?" / "when will it come?" are understood as order questions for signed-in customers.
  - Handover is remembered (`ai.conversation_state`): the AI stays quiet until
    `POST /v1/conversations/resume` (24-hour expiry).
- Phase 2, order problems: damaged, wrong, missing items, return, cancel, address change and payment
  deducted (scenario O) get the customer's order facts, the business's own process from its help
  articles, and a next step (complaint for problems, a person for changes). Complaints for any category,
  de-duplicated per order and category.
- Phase 3, measurement: 19 whole-conversation cases (C01–C19); the eval fails any conversation step that
  repeats the previous reply; new "Conversation quality" report section and scorecard line; new failure
  causes; `/v1/insights/quality` adds repeat, unhappy, unresolved and order-problem signals and queues
  those chats for review.
- Tests: per-test user ids so back-to-back runs never hit the per-customer rate limit; the answer-cache
  case uses separate chats. 164 automated tests, 134 offline cases, all passing on repeated runs.
- API (additive): handover reason `unresolved`; complaint categories; `POST /v1/conversations/resume`;
  `trace.dialogue`; flags `repeat_avoided`, `customer_unhappy`, `awaiting_agent`, `order_issue`, `issue:<type>`.

## 1.3.0 – delivered but not received, complaints, refund requests

- Fix: when an order shows delivered but the customer says it never arrived, the AI no longer repeats
  "it was delivered". It apologises and gives next steps: check with family, neighbours and the
  building's security; contact the courier (contact details from `commerce.couriers`) with the
  tracking number.
- If the customer has already done that, or reports it again, the AI raises a complaint for the
  business's team: new table `ai.complaints` (reference `CMP-000123`), chat reply
  `action.type = "complaint"`, and `GET /v1/complaints` / `PATCH /v1/complaints/{reference}`. An open
  complaint for the same order is reused, never duplicated.
- Follow-ups inside that conversation ("no, I still didn't get it", "I already called them",
  "still nothing?") continue it, using the conversation's earlier runs. A bare "still nothing?" in
  any other order chat goes to the normal pipeline instead of repeating the status.
- Refund requests ("I want my money back", "mujhe paisa wapas chahiye") hand over to a person:
  new handover reason `refund_request`. Refund information questions are still answered.
- An order still in transit or late keeps its status reply when the customer says it hasn't arrived.
- Loader: courier websites added per workspace; phone numbers are left for the business to set.
- Playground: two new order test messages. 21 new automated tests, 5 new conversation cases (W42–W46).
- API (additive): handover reason `refund_request`, complaint action, complaints endpoints.

## 1.2.2 – leaner, private embedding cache

- Memory: cached vectors are stored as float32 arrays: 48.4 KB → 6.1 KB per question (measured), a
  full cache of 5,000 questions per worker 248 MB → 31 MB. Intent example vectors use the same format.
- Privacy: cache entries are scoped per workspace, and the stored hash is an HMAC keyed with a server
  secret (`CACHE_HASH_SECRET`, default derived from `SERVICE_TOKEN`), so a guessed question can't be
  checked against the table without the secret. New `workspace_id` column; `forget_workspace()` removes
  one business's entries.
- Migration: automatic on startup. Entries written by 1.2.1 (unscoped, now unreachable) are removed.
- Lifecycle unchanged: 5,000 most recent per worker in memory, 60 days unused in the database.
- No behaviour change: same answers, same test results; 4 new tests.

## 1.2.1 – faster order replies

- Startup warm-up: the order-intent example vectors are stored in `ai.intent_vectors` and loaded when
  the service starts, instead of being embedded on a customer's first order question in each worker.
- Embedding cache (`ai.embedding_cache` + an in-memory layer): repeated questions reuse their
  embedding instead of an OpenAI round trip. Stores only a hash of the question, never its text; stale
  entries (60 days) are removed at startup. Also removes a double embedding for signed-in customers
  whose message matched a keyword reply.
- Measured with a simulated 0.6 s OpenAI delay: a repeated question goes from about 625 ms to 9–22 ms;
  after a restart, warm-up takes 0.05 s instead of embedding on the first customer question.
- API (additive): `trace.embed_source` (`memory`, `db` or `api`).
- No behaviour change: same answers, same test results.

## 1.2.0 – order questions recognised by meaning

- Layer 2: after the question is embedded (already done for search, so no extra cost), it's compared
  with example order questions and example policy questions (`app/intent.py`). Clearly closer to an
  order question → order lookup; unsure → layer 3.
- Layer 3: for identified customers the AI may reply `ORDER_STATUS` when the question is about their
  own order; the system then does the lookup. The AI never writes order details. Unsure cases reach
  the AI even when no help article matches.
- Fix: for a signed-in customer, a generic keyword reply ("track it in My Orders") no longer beats
  their real order when the question is an order question by meaning.
- Streaming never shows the control words (`HANDOVER`, `ORDER_STATUS`).
- Eval: order-intent failure causes, which layer caught each order question, and a layer-2 threshold
  sweep. 26 new cases: the reported paraphrase, 20 more (English, Hinglish, Hindi, Tamil) and 5
  delivery-policy questions that must not become order lookups.
- Settings: `ORDER_INTENT_OPENAI`, `ORDER_MAYBE_OPENAI`, `ORDER_INTENT_MARGIN` (and `_FAKE` variants).
- API (additive): `trace.tool.matched_by`, `trace.order_intent`, flags `order_intent_semantic`,
  `order_intent_llm`.

## 1.1.0 – order status (WISMO) with test data

- New pipeline step after the safety and handover rules: order questions from an identified
  customer are answered from order data, with no AI call. Covers in transit, not yet dispatched,
  dispatch delayed, delivery late, delivered and returned; asks which order when there are
  several recent ones; accepts typed order numbers (`UX109946`, `#ux-109946`, order UUID).
- Privacy: only the identified customer's orders are shown; someone else's order number gets "not
  found on your account"; no prices, addresses or payment details in replies; store policy (e.g.
  refund timelines) comes from help articles, offered as follow-up suggestions.
- API (additive): `user.phone`; route `tool`; `trace.tool`; flags `order_lookup`,
  `order_not_on_account`, `order_lookup_unverified`.
- `commerce` schema and `scripts/load_orders.py`: imports `data/ecommerce_orders_clean.csv`
  (10,000 orders), shifts dates to today, adds order numbers, couriers, tracking and delivery
  dates, and synthetic customer contacts.
- Playground: Store customer ID and WhatsApp phone fields, order-status test messages.
- 15 new conversation cases (W), 22 new automated tests.

## 1.0.0 – first handoff to the development team

**API (v1)**
- `POST /v1/chat` and `POST /v1/chat/stream` (server-sent events): grounded answers with
  citations, suggestions, support-form action on handover, confidence and trace.
- `POST /v1/feedback`: thumbs up/down; powers the answer cache and quality metrics.
- Knowledge: add text / markdown / FAQ / website sources, upload PDFs, list, re-sync, delete.
- Keyword flows: list, create, delete (exact and fuzzy matching).
- Insights: `summary`, `gaps`, `quality`.
- `GET /health` with version, environment, provider and spend.

**Behaviour**
- Cheapest-first pipeline: safety rules → handover rules → keyword flows → answer cache →
  hybrid search (pgvector + full text) → relevance gate → LLM → post-checks.
- Handover on request (English, Hindi, Hinglish, Tamil), sensitive topics, repeated misses,
  turn limit, budget and errors.
- Card numbers, OTPs, PINs and passwords removed before the LLM and logs; prompt injection and
  other customers' data refused.
- Reply language detected in code (English, Hinglish, Hindi, Tamil, Tanglish).
- Spend cap (`BUDGET_USD`) and per-user rate limit.

**Operations**
- `APP_ENV=production` refuses to start with unsafe settings; playground off in production.
- Safe concurrent schema setup with many workers or replicas.
- OpenAPI spec (`docs/openapi.json`), TypeScript types, example requests, CI workflow.

**Quality**
- 88 automated tests; 116-case conversation test set with stage-level failure diagnosis,
  threshold sweep, retrieval and handover metrics, and run-to-run comparison.
