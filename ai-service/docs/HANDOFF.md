# UnoCX AI Service – Developer handoff (v1.0.0)

This is the conversational AI for the UnoCX help section, delivered as an internal HTTP API.
The Next.js app calls it; it never talks to browsers directly. This guide covers what the team
needs to integrate, deploy and run it. For a local first run, see `README.md`.

## 1. What you're receiving

| Path | What it is |
|---|---|
| `app/` | The service (FastAPI, Python 3.12) |
| `docs/openapi.json` | **The API contract.** Import into Postman, Insomnia or Swagger, or generate a client |
| `docs/API.md` | The contract explained, with what the UI should do for each outcome |
| `docs/nextjs/` | Drop-in Next.js code: proxy route, streaming hook, feedback route, TypeScript types |
| `docs/api-examples.http` | Ready-to-send requests for every endpoint (VS Code REST Client / JetBrains) |
| `docs/TESTING.md`, `docs/EVALUATION.md` | How quality is tested and measured |
| `tests/` | 88 pytest tests + 116-case conversation test set |
| `.github/workflows/ci.yml` | CI: tests, conversation set and contract check on every push (free, no OpenAI) |
| `Dockerfile`, `docker-compose.yml` | Container image and a local stack (Postgres + pgvector + API) |
| `knowledge/`, `scripts/seed.py` | Demo help content and the loader |

## 2. Who owns what

| Next.js app (your team) | UnoCX AI Service (this repo) |
|---|---|
| Login, tenants, deciding `workspace_id` | Answering from knowledge, with citations |
| Chat UI, storing conversations and messages | Safety rules, handover decisions, masking secrets |
| Creating tickets and assigning people on handover | Keyword flows, answer cache, budget cap |
| Stopping the AI once a person owns the conversation | Knowledge ingestion (text, FAQ, PDF, website) |
| Admin screens for knowledge and flows (later) | Quality metrics and run logs |

The service is **stateless**. Everything it keeps is in Postgres, in its own `ai` schema. It
never reads or writes the Next.js tables.

## 3. Integrating with Next.js

**Step 1. Environment variables (server-side only)**
```
UNOCX_URL=http://unocx-ai:8000          # private network address of the service
UNOCX_SERVICE_TOKEN=<same as SERVICE_TOKEN in the service>
```
Never prefix these with `NEXT_PUBLIC_`. The token must not reach the browser.

**Step 2. Copy the integration code** from `docs/nextjs/`:
- `chat-route.ts` → `app/api/support/chat/route.ts` (proxies the stream, adds the token, 20 s timeout with a fallback)
- `feedback-route.ts` → `app/api/support/feedback/route.ts`
- `useSupportChat.ts` → your hooks folder (streaming client, blocks double-send)
- `unocx-types.ts` → your lib folder

Replace the `TODO` session lines: `workspace_id` and `user` must come from your authenticated
session. The service trusts whatever Next.js sends; that is the tenant isolation boundary.

**Step 3. Render each outcome**

| `outcome` | UI |
|---|---|
| `answered` | Reply, citations as links, `suggestions` as chips, thumbs up/down when `route` is `rag` or `cache` |
| `clarify` | Reply and `suggestions` as chips |
| `handover` | Reply; render the support form if `action.type == "form"` (prefill provided); create a ticket with `handover_summary`; **stop sending this conversation to the AI** |
| `blocked` | Reply only |

With streaming, always replace the streamed text with `done.reply`: only the final reply has
passed the post-checks.

**Step 4. Conversation rules**
- Keep one `conversation_id` per chat and send the history oldest first (the last 12 messages is
  enough). The last message must have `role: "user"`.
- Don't send a new message while a reply is pending (the hook already blocks this).
- After a handover, route the customer's messages to your inbox, not to this API.
- Send thumbs up/down to `/v1/feedback` with the `run_id`. It powers the answer cache and the
  quality metrics.

**Step 5. Knowledge management** (for an admin screen, or a script for now)
- Add: `POST /v1/knowledge/sources` (text, markdown, FAQ, website URL) or `POST /v1/knowledge/upload` (PDF, max 20 MB).
- Both return `202` and process in the background. Poll `GET /v1/knowledge/sources/{id}` until
  `status` is `live` or `error`; `error` holds the reason (and scanned-PDF page warnings).
- Update: website sources → `POST .../sync`. Text, FAQ and PDF → delete and add again (no
  edit endpoint yet; see §9).
- Keyword replies: `GET/POST/DELETE /v1/flows`. Changes apply within 30 seconds.

**Step 6. Order status (WISMO).** Send `user.id` (the store's customer id), `user.email` or
`user.phone` from your session or the WhatsApp sender, and order questions are answered from
order data. Today that data is the test `commerce` schema loaded from a CSV
(`scripts/load_orders.py`). For production, replace the three read-only functions in
`app/commerce.py` (`find_customer`, `recent_orders`, `customer_order`) with calls to the real
order system (Shopify, or a Next.js tools API that checks the order belongs to the customer).
The rest of the agent doesn't change.

## 4. Deployment

**Container.** `docker build -t unocx-ai:1.0.0 .` One image; it runs 2 Uvicorn workers. Run it
on the same private network as the Next.js app. **Do not expose it to the internet.** Only
Next.js should be able to reach it.

**Database requirements**
- PostgreSQL 15+ with the **pgvector extension (0.5 or newer)**. Managed services that support
  it include AWS RDS / Aurora, Google Cloud SQL, Azure Flexible Server, Supabase and Neon.
- If the service's database user can't create extensions, run `CREATE EXTENSION vector;` once
  as an admin before the first start.
- It can share the Next.js database. It creates and uses only the `ai` schema.
- **Schema setup is automatic and idempotent** on startup (an advisory lock makes it safe with
  many workers or replicas). There is no migration tool yet; schema changes are additive
  (`IF NOT EXISTS`).
- `EMBED_DIM` is fixed when the tables are first created. Changing it requires dropping
  `ai.knowledge_chunks` and `ai.answer_cache` and re-loading the content.

**Environment variables**

| Variable | Production value | Notes |
|---|---|---|
| `APP_ENV` | `production` | Refuses to start with a weak token, fake mode, or the demo database password, and lists the problems |
| `SERVICE_TOKEN` | 32+ random characters | Shared with Next.js. Rotate: set the new value on both sides and restart both |
| `DATABASE_URL` | your Postgres URL | |
| `LLM_PROVIDER` | `openai` | `fake` is for development and CI only |
| `OPENAI_API_KEY` | secret | Store in your secret manager, not in the image |
| `CHAT_MODEL` / `EMBED_MODEL` | `gpt-4o-mini` / `text-embedding-3-small` | |
| `EMBED_DIM` | `1536` | See above |
| `BUDGET_USD` | your limit | Lifetime cap on recorded OpenAI spend, all tenants combined |
| `ENABLE_PLAYGROUND` | leave empty | Off in production by default; set `true` only on a staging instance |
| `RATE_LIMIT_PER_MIN`, `MAX_TURNS`, `MAX_REPLY_CHARS`, `CACHE_MIN_VOTES`, `MIN_SIMILARITY_OPENAI` | defaults | Tuning; see `docs/EVALUATION.md` before changing the threshold |

Empty values in `.env` are treated as "not set". Don't put comments after values on the same
line.

**Health and scaling**
- Health check: `GET /health` (no token). It returns version, environment, provider and spend.
- The service is stateless, so scale by adding replicas behind a load balancer. Rate limits and
  conversation state are read from Postgres, so they work across replicas.
- Each replica handles roughly 80 requests in flight (2 workers × ~40 threads). Requests mostly
  wait on OpenAI, so CPU stays low; 1 vCPU / 1 GB RAM per replica is a reasonable start.
- The practical ceiling is **your OpenAI account's rate limit** (tokens per minute for your tier),
  at about 2,000 tokens per AI reply. Check it before launch.
- It has not been load-tested yet. Run k6 or Locust against a staging instance in fake mode
  first (tests the service at no cost), then a short run with OpenAI.

**Caches and warm-up.** On startup each worker loads the order-intent example vectors from
`ai.intent_vectors` (embedding any missing ones once) and removes cached question embeddings unused
for 60 days. `ai.embedding_cache` stores, per workspace, an HMAC of each question (keyed with
`CACHE_HASH_SECRET`, or a secret derived from `SERVICE_TOKEN`) and its vector, never the question
text; it is shared by all workers and replicas. Changing the secret or the token simply starts the
cache afresh. Each worker also keeps up to 5,000 recent embeddings in memory (about 31 MB).
`embed_cache.forget_workspace(ws)` removes one business's cached embeddings. If OpenAI or the database is unavailable at
startup, warm-up logs a warning and the vectors load on first use. After changing `EMBED_MODEL` or
`EMBED_DIM`, both tables start fresh automatically (rows are keyed by provider and model).

**Logs.** Standard output, one line per request plus errors. Every reply is also recorded in
`ai.agent_runs` with its `run_id`, outcome, flags, confidence, timings, tokens and cost. Phone
numbers and emails are masked there.

## 5. Operations runbook

| Task | How |
|---|---|
| Load or replace a workspace's content | `python -m scripts.seed --workspace <ws> --dir <folder> --reset` (also clears that workspace's logs and cache), or the knowledge API |
| Check spend | `GET /health` → `spent_usd`; per workspace: `GET /v1/insights/summary` |
| Budget reached | Customers get handed over (`budget_exceeded`); flows and cache still work. Raise `BUDGET_USD` and restart |
| OpenAI down or slow | Automatic: 12 s timeout, 1 retry, then handover with the support form. Check logs for `LLM call failed` |
| Service down | Next.js proxy falls back after 20 s and shows the support form |
| Weekly quality review | `GET /v1/insights/quality` → read `review_queue` and the worst `articles`; turn failures into test cases (`docs/EVALUATION.md` §9) |
| Before each release | `python -m scripts.run_eval --workspace ws_eval` with `LLM_PROVIDER=openai` (about $0.05); ship only with no regressions and a green scorecard |

## 6. Security checklist

- [ ] Service reachable only from the Next.js app's network
- [ ] `APP_ENV=production` set (enforces a strong token, real provider, non-demo database)
- [ ] `SERVICE_TOKEN` and `OPENAI_API_KEY` stored in a secret manager
- [ ] `workspace_id` and `user` always set from the server-side session
- [ ] Playground disabled in production (the default)
- [ ] OpenAI organisation data controls reviewed (API data isn't used for training by default)
- [ ] Hard monthly limit set in the OpenAI dashboard as a second cap
- [ ] Data-retention decision made for `ai.agent_runs` (no automatic purge yet; see §9)

Built in: card numbers, OTPs, PINs and passwords are removed before the LLM and logs; prompt
injection and requests for other customers' data are refused; every query is filtered by
`workspace_id`.

## 7. Testing and CI

```bash
python -m pytest -q                                 # 88 tests (Postgres, LLM_PROVIDER=fake)
python -m scripts.run_eval --workspace ws_eval      # conversation test set + metrics report
python -m scripts.export_openapi                    # regenerate docs/openapi.json
```

`.github/workflows/ci.yml` runs all three on every push at no OpenAI cost. It fails the build if
any test or conversation case fails, or if `docs/openapi.json` doesn't match the code.

## 8. API contract and versioning

- All endpoints are under `/v1`. Within v1, changes are **additive only**: new optional request
  fields, new response fields, new endpoints. Clients must ignore unknown response fields.
- Breaking changes (renamed or removed fields, changed meanings) go to `/v2`, with `/v1` kept
  until Next.js has migrated.
- Agree contract changes with the Next.js team first, update `docs/openapi.json`
  (`python -m scripts.export_openapi`), and record them in `CHANGELOG.md`.

## 9. Known limitations and recommended next work

In priority order:

1. **Per-workspace credits.** `BUDGET_USD` is one cap for all tenants, so one busy tenant could
   stop the agent for everyone. Add per-workspace monthly quotas, keeping the global cap.
2. **Ingestion queue.** Ingestion runs as background tasks inside the API process: large crawls
   compete with chat traffic, and jobs are lost on restart. Move to a queue (Celery + Redis, or a
   Postgres-based queue).
3. **Edit endpoint for sources** (`PATCH /v1/knowledge/sources/{id}`) for an admin editor.
4. **Scheduled re-sync** of website sources (nightly).
5. **Retention job** for `ai.agent_runs` (for example 90 days) to match your privacy policy.
6. **Load test** (see §4).
7. **Cost optimisations** already designed (`docs/EVALUATION.md`): learned declines,
   off-topic examples, smaller context for weak matches, shorter prompts.
8. **Provider abstraction** (LiteLLM) if you plan to offer other models or bring-your-own-key.
9. **JavaScript-rendered websites** can't be crawled (they return nearly empty pages); scanned
   PDFs are skipped (no OCR).
10. **Order look-ups and actions** (track, exchange, cancel) through a Next.js tools API.

## 10. Before go-live

1. Replace the demo content in `knowledge/` with real help content, and update the expected
   answers and `gold` article names in `tests/eval_cases.yaml` and the replies in
   `scripts/seed.py` (`FLOWS`).
2. Run the full evaluation with OpenAI and confirm the scorecard is green.
3. Check that the confidence calibration section of the report rises with confidence before using
   confidence in any decision.
4. Complete the security checklist (§6).
