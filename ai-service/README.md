# UnoCX AI Service

> **Developers integrating or deploying this service: start with [`docs/HANDOFF.md`](docs/HANDOFF.md).**
> API contract: [`docs/openapi.json`](docs/openapi.json) · examples: [`docs/api-examples.http`](docs/api-examples.http)

The conversational AI behind the UnoCX help section. A Python (FastAPI) service that the UnoCX
Next.js app calls over HTTP. It answers customer questions from your help content, hands over to
a person when it should, and keeps spend inside a fixed budget.

```
Browser ──> Next.js (UnoCX app) ──HTTP + service token──> UnoCX AI Service (this repo)
                    │                                              │
                    └──────────────── Postgres ────────────────────┘
                     public schema (Next.js)          ai schema (this service)
```

## Quick start (5 minutes, no OpenAI cost)

```bash
cp .env.example .env                 # keep LLM_PROVIDER=fake for now
docker compose up -d --build         # Postgres + pgvector + the API on :8000
docker compose exec api python -m scripts.seed --reset
open http://localhost:8000/playground   # paste SERVICE_TOKEN from .env
```

Without Docker: Python 3.11+, Postgres 15+ with the `pgvector` extension, then
`pip install -r requirements.txt`, `python -m scripts.seed --reset`, `uvicorn app.main:app --reload`.

## Switching to real answers (OpenAI)

In `.env` set `LLM_PROVIDER=openai` and `OPENAI_API_KEY=sk-...`, then **re-seed** (fake and
real embeddings are not compatible):

```bash
python -m scripts.seed --reset       # embeds the sample content: well under $0.01
python -m scripts.run_eval           # full test set incl. language cases: roughly $0.05
```

Also set a monthly hard limit in the OpenAI dashboard as a second safety net.

### What the $8 credit buys

| Item | Model | Approx. cost |
|---|---|---|
| One AI answer (≈2,000 input + 150 output tokens) | gpt-4o-mini | $0.0004 |
| Embedding one question | text-embedding-3-small | $0.0000004 |
| Indexing 500 help pages | text-embedding-3-small | ≈ $0.01 |
| Keyword-flow, cached and guardrail replies | none | $0 |

That is roughly 15,000–20,000 AI answers. `BUDGET_USD=7.50` stops paid calls before the credit
runs out; keyword flows and cached answers keep working, everything else hands over to support.
Prices change, so check the OpenAI pricing page and update `PRICES` in `app/config.py`.

## How a message is handled

Each step is cheaper than the next, so most messages never reach the LLM.

| # | Step | Result |
|---|---|---|
| 1 | Mask card numbers, OTPs, PINs, passwords | warn the customer, never send them to the LLM |
| 2 | Empty / emoji-only / rate limit | ask what they need, or slow them down |
| 3 | Self-harm, prompt injection, other customers' data | care message + helpline, or polite refusal |
| 4 | Asked for a human, sensitive topic, turn limit | handover with support form |
| 4b | Order question from an identified customer, recognised by keywords | reply from order data, free; someone else's order is never shown |
| 5 | Keyword flows (exact, then fuzzy for typos) | fixed reply, free and instant |
| 6 | Budget check | handover if the cap is reached |
| 6b | Order question recognised by meaning (layer 2: similarity to example order vs policy questions, reusing the search embedding) | reply from order data, free; unsure cases go to the AI (layer 3), which can hand back to the order lookup |
| 7 | Answer cache (answers rated helpful twice) | reuse answer, no LLM call |
| 8 | Hybrid search (pgvector + full text) + relevance gate | ask to rephrase, then handover on a second miss |
| 9 | LLM answer grounded in the top 5 chunks, with citations | answer, or HANDOVER if the articles don't cover it |
| 10 | Post-checks | strip unknown links and tables, cap length, log the run |

## Project layout

```
app/
  main.py         HTTP endpoints
  agent.py        the pipeline above
  guardrails.py   deterministic safety rules (pure functions, unit tested)
  router.py       keyword flows + answer cache
  retrieval.py    hybrid search
  ingest.py       text / markdown / FAQ / PDF / website ingestion and chunking
  llm.py          OpenAI + free fake provider, cost tracking, budget
  evaluation.py   eval metrics: stage-level failure diagnosis, retrieval/handover metrics, threshold sweep
  db.py           schema (ai.*) and connection pool
  static/playground.html   tester UI at /playground
knowledge/        sample help content for the demo workspace (replace with yours)
scripts/          seed.py, run_eval.py, export_cases.py, make_size_guide_pdf.py
tests/            eval_cases.yaml (conversation test set) + pytest suites
docs/             API.md, TESTING.md, EVALUATION.md, test-cases.csv, nextjs/ examples
```

## Order status (WISMO) test data

`data/ecommerce_orders_clean.csv` holds 10,000 orders from 2,713 customers. Load it into the
`commerce` schema (a stand-in for the store's real order system) to test "where is my order?":

```bash
python -m scripts.load_orders --reset                       # into ws_unocx
python -m scripts.load_orders --workspace ws_eval --reset   # for the test set
# Docker: docker compose exec api python -m scripts.load_orders --reset
```

The importer shifts the dates so the newest order was placed yesterday (`--dates keep` turns this
off), adds short order numbers (`UX100001`…), couriers, tracking numbers and delivery dates, and
generates **synthetic** contact details because the CSV has none: phone `+919000` + the 6-digit
customer id, email `customer<ID>@example.com`. Old orders still marked Shipped or Pending become
realistic delayed orders.

The AI identifies the customer from what Next.js sends: `user.id` (the store's customer id),
`user.email` or `user.phone`. It only ever shows that customer's own orders, answers straight from
the data (no AI call, $0), and never includes prices, addresses or payment details. In the
playground, set **Store customer ID** (try 78, 74, 68, 12, 14, 41 or 1).

## Using your own help content

Put files in a folder and run `python -m scripts.seed --workspace ws_yours --dir path/to/folder --reset`.
Supported: `.md`, `.txt`, `.json` (FAQ as `[{"q": "...", "a": "..."}]`) and `.pdf`. Or add sources
from the app through `POST /v1/knowledge/sources` (text, markdown, FAQ, website URL) and
`POST /v1/knowledge/upload` (PDF). Then edit `tests/eval_cases.yaml` so the expected answers match
your content.

The files in `knowledge/` are sample content for the demo workspace `ws_unocx`, written to
exercise the edge cases in the test set (returns, payments, a PDF with a scanned page, and so on).

## Configuration

All settings are environment variables; see `.env.example`. The important ones:

| Variable | Default | Notes |
|---|---|---|
| `APP_ENV` | `development` | `production` refuses to start with unsafe settings and turns the playground off |
| `LLM_PROVIDER` | `fake` | `openai` for real answers |
| `SERVICE_TOKEN` | — | shared secret with Next.js; use a long random string |
| `EMBED_DIM` | 1536 | fixed when the tables are created; changing it means re-embedding |
| `BUDGET_USD` | 7.50 | lifetime cap on recorded OpenAI spend |
| `RATE_LIMIT_PER_MIN` | 12 | per user (or per conversation if no user id) |
| `MAX_TURNS` | 10 | user messages in one conversation before handover |
| `CACHE_MIN_VOTES` | 2 | thumbs-up before an answer is reused |

## Commands

```bash
python -m pytest -q                      # 164 unit + integration tests (needs Postgres, fake mode)
python -m scripts.run_eval               # conversation test set + metrics; report in eval_results/
python -m scripts.run_eval --repeat 3    # also measure answer stability (real model)
python -m scripts.run_eval --only H,X,I  # just handover, sensitive and security cases
python -m scripts.export_cases           # regenerate docs/test-cases.csv for manual testers
```

## Resolving issues across a whole conversation

- **No loops:** the same reply is never sent twice in a row. The bot changes approach (latest status +
  "is something wrong? complaint or a person"), and a second repeat hands over (`unresolved`).
- **Unhappy customers:** "that's not what I asked" → apology and a question, then a person; "this is
  taking forever" after a late order → a delay complaint.
- **Remembers its own offers:** "yes", "no thanks", "Raise a complaint", "the clothing one", "the second
  one" answer what the bot just offered or listed. Two matching orders → it asks which.
- **Order problems, not just status:** damaged, wrong, missing, return, cancel, address change and payment
  problems get the customer's order facts + the business's own process + a next step.
- **Handover is remembered:** after a handover the AI stays quiet until `POST /v1/conversations/resume`.
- Measured: the eval fails any conversation that repeats a reply; `/v1/insights/quality` reports repeats
  avoided, unhappy customers, unresolved handovers and order problems, and queues those chats for review.

## Delivered but not received, complaints and refunds

- A customer whose order is marked delivered but who says it never arrived gets an apology and next
  steps (check with family, neighbours, security; contact the courier with the tracking number), not
  the delivery status again.
- If they've already done that, or report it again, the AI raises a complaint (`ai.complaints`,
  reference `CMP-000123`) for the business's team, returned as `action.type = "complaint"` and listed
  at `GET /v1/complaints`. An open complaint for the same order is reused.
- Asking for money back ("I want a refund", "give me my money back") hands over to a person with
  reason `refund_request`. Questions about refunds ("how long do refunds take?") are still answered.
- Courier contacts: `commerce.couriers`, websites added by the loader; phone numbers are set by the
  business (see docs/API.md). Nothing is invented.

## Speed: embedding cache and warm-up

Most of a reply's waiting time is network round trips to OpenAI. Two things cut them:

- **Warm-up.** The order-intent example vectors are stored in `ai.intent_vectors` and loaded when the
  service starts, so no customer waits for them (about 0.05 s at startup once stored).
- **Embedding cache.** A question's embedding is reused when the same question comes again in the same
  workspace (case and trailing punctuation ignored): from memory (compact float32, about 6 KB per
  question, at most 5,000 per worker, about 31 MB), else from `ai.embedding_cache`, shared by all
  workers. A repeated order question then answers in tens of milliseconds instead of one OpenAI round
  trip. The database stores an HMAC of the question (keyed with a server secret and the workspace) and
  its vector, never the text. Entries unused for 60 days are removed at startup.

`trace.embed_source` on each reply says where the embedding came from: `memory`, `db` or `api`.

## Finding what to improve

Every reply carries a `confidence` score and a `trace` (time per stage, the top-5 retrieved articles,
unsupported numbers). The eval report uses them to blame each failure on one stage (retrieval,
relevance gate, generation, rules or flows) and to say what to change, with a threshold sweep,
retrieval Hit@1 / Recall@5, handover precision and recall, calibration, latency per stage and a
comparison with the previous run. After release, `GET /v1/insights/quality` gives the same signals
from real conversations. See `docs/EVALUATION.md`.

## Integrating with Next.js

See `docs/API.md` for the contract and `docs/nextjs/` for a ready proxy route, streaming hook and
feedback route. The rule that matters most: the browser talks to Next.js, Next.js talks to this
service. Never expose `SERVICE_TOKEN` or let the browser choose `workspace_id`.

## Known limits (planned next)

- Order look-ups and actions (cancel, address change) are not included; questions about a specific
  order go to the "Track order" flow or to support.
- Ingestion runs in FastAPI background tasks. Move it to a queue worker if you add large websites.
- Website crawling handles server-rendered pages; JavaScript-only pages return little text.
- Answer quality in Tamil, Hindi and Hinglish depends on the model; check the `L` cases in the
  eval report after switching to OpenAI.
