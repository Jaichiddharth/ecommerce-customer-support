# AI agent

The AI agent answers customer questions (WISMO, help and FAQ) and hands the chat to the team when
it should. It has two parts:

| Part | Where | What it does |
|---|---|---|
| **AI service** (Python, FastAPI) | `ai-service/` | The conversation pipeline: guardrails, order lookups, knowledge search, the LLM call, metrics, test set. Owns the `ai` Postgres schema. See `ai-service/README.md` and `ai-service/docs/HANDOFF.md`. |
| **Dashboard** (this Next.js app) | `/ai-agent` | The merchant's screens: Overview, Knowledge & actions, Guardrails, Model, Test set, Test the agent. Stores the agent's configuration (versioned) and proxies everything else to the AI service. |

```
Browser ──> Next.js /api/ai-agent/*  ──(UNOCX_AI_TOKEN)──>  ai-service /v1/*
              │  auth + "ai" page permission                    │
              │  workspace_id = org_<organizationId>             │
              └── ai_agent_configs / ai_agent_versions           └── ai.* (knowledge, runs, tests)
```

The workspace id is always derived from the signed-in user's organisation on the server, never taken
from the request. That is the tenant boundary.

## Local setup

1. **AI service.** Postgres with pgvector is required. The simplest option:
   ```bash
   cd ai-service
   cp .env.example .env            # keep LLM_PROVIDER=fake to start (free); set SERVICE_TOKEN
   docker compose up -d --build    # Postgres + pgvector on host port 5433 and the API on :8000
   docker compose exec api python -m scripts.seed --reset          # demo help content (ws_unocx)
   docker compose exec api python -m scripts.load_orders --reset   # demo orders for WISMO
   ```
   The service's database is published on 5433 so it doesn't clash with the app's Postgres on 5432
   (change with `AI_DB_PORT`). For real answers set `LLM_PROVIDER=openai` and `OPENAI_API_KEY`, then re-seed.

2. **Next.js.** Add to `.env.local`:
   ```
   UNOCX_AI_URL=http://localhost:8000
   UNOCX_AI_TOKEN=<same value as SERVICE_TOKEN in ai-service/.env>
   ```
   Never prefix these with `NEXT_PUBLIC_`, and restart `npm run dev` after adding them. Then create
   the agent's tables (idempotent, safe to run again):
   ```bash
   npm run db:apply -- src/lib/db/migrations/0013_ai_agent.sql
   ```
   (Databases created without `drizzle-kit migrate` have no migration history, so `npm run db:migrate`
   would try to replay every migration from 0000. Use `db:apply` for this file.)

3. Open **AI agent** in the sidebar. Each organisation starts empty: add knowledge on the
   *Knowledge & actions* tab. To try WISMO with the demo orders, load them into your organisation's
   workspace: `python -m scripts.load_orders --workspace org_<yourOrgId> --reset`, then in
   *Test the agent* set "Test as" to a store customer id such as `78`.

## What the merchant can configure

All of it is one **policy** (`src/lib/ai-agent/policy.ts`), saved as a new version on every change
(*Model › Versions* can restore any of them) and sent with every chat to the AI service as
`settings.policy`.

| Screen | Setting | Enforced in the AI service by |
|---|---|---|
| Guardrails | Handover rules (ask for a person, angry tone, legal topics, low confidence, turn limit, high-value order, repeat contact) | code (`agent.prepare` / `finalize`), never by the model |
| Guardrails | Never say or promise | prompt rule + post-check that swaps a slip for a polite refusal |
| Guardrails | Tone preset, reply length, brand-voice notes, reply language, max length | prompt (tone only) + language decided in code + length cap |
| Guardrails | Topics: store topics only, declined topics, competitors | code: off-topic classifier (embeddings), topic match on the message, competitor sentences removed from replies |
| Guardrails | Content moderation: abusive language, harmful requests, reply filter | code: word lists (English, Hindi, Hinglish, Tamil) |
| Guardrails | Advanced protection (Pro and Enterprise): double-check weak answers, smarter injection detection, AI moderation | the app sends these only when the plan includes them (`toServiceSettings(policy, company, plan)`) |
| Guardrails | Data & privacy: transcript retention | hourly retention sweep; masking, address, card/UPI and no-training are always on |
| Knowledge & actions | Sources (FAQ, article, website, PDF), draft/live | hybrid search ignores draft sources |
| Knowledge & actions | Answer from knowledge, Order status on/off, welcome message, quick replies | pipeline skips the skill |
| Model | Standard / Advanced | `CHAT_MODEL` / `CHAT_MODEL_ADVANCED` |

**Not configurable (platform rules):** see *Guardrails* below.

## Guardrails

Three groups. Everything security-relevant is enforced in code before or after the model; the prompt only
repeats it.

**Always on (platform rules):**

- **Refunds and exchanges** always go to a person. Cancellations, payment and account changes too: `app/tools.py` lists them as human-only, so nothing can be wired to run them.
- **Escalation:** self-harm (care message), fraud and safety always hand over. Only legal topics follow the *Legal topics* switch.
- **Privacy:** card numbers, OTPs, PINs and passwords are masked in the customer's message (and the message blocked); credentials and secrets are removed from replies; phone numbers and emails are always masked in the AI logs (the old *Mask phone numbers* switch is ignored).
- **Data isolation:** every AI-service query is scoped to the workspace; order data only for a verified identity and only that customer's orders.
- **Prompt injection in messages:** patterns in English, Hindi and Hinglish, checked on a normalised copy of the message (full-width and styled letters, invisible characters, spaced-out letters and digit swaps like "1gn0re" are undone).
- **Prompt injection in content:** knowledge passages (website, PDF, FAQ, text) that talk to the AI ("AI assistants must…", "SYSTEM:") are left out of the index. *Knowledge* shows "N passages ignored". Product titles and descriptions are checked the same way before they go into the shopping prompt.
- **Price integrity:** in shopping replies, every amount and percentage must match the store's prices, the configured offer or the customer's own words. Sentences with any other amount are removed. Help answers keep the existing check for numbers that aren't in the articles.
- **Shipping addresses** are shown only to the order's own customer, by code, and never reach the model or the logs (see *Shipping address*).
- **Output scan:** model replies lose phone numbers and emails that weren't in the articles or products. The whole sentence goes, so no "please write to" is left dangling. The business's own support email in an article stays.
- **Tool permissions:** `app/tools.py` registers every action with a tier (read / customer read / write / high risk) and checks identity and confirmation in code (`authorize`). Raising a complaint needs an identified customer and their request or yes.
- **Abuse limits:** 12 messages a minute per customer (AI service). The website widget's per-visitor and per-widget limits are now kept in Postgres (`rate_limit_hits`, migration 0016), so they hold across servers and restarts. Input length, history, output tokens, timeouts and the spend budget are capped.
- **Retention:** conversation text older than the workspace's retention (*Keep chat transcripts*; `RETENTION_DEFAULT_DAYS`, default 365, for workspaces that never sent one) is deleted hourly. That covers runs, handover state, knowledge gaps, test runs and resolved complaints (`app/retention.py`).

**Configurable (Guardrails tab, on by default where sensible):**

- **Tone and length:** Friendly / Professional / Casual / Premium / Custom, plus Short / Medium / Detailed. Brand-voice notes are added to the preset.
- **Topics:**
  - *Store topics only* (on by default): questions the knowledge doesn't cover and that are close to general-knowledge, homework, chit-chat and similar examples get "I can only help with questions about …". They are never knowledge gaps. Measured on real embeddings: 16 of 20 off-topic questions caught, 0 of 20 unusual store questions.
  - *Topics the agent declines:* a match gets "can't help with that here" and the team.
  - *Competitors:* sentences naming one are removed from replies.
- **Content moderation:**
  - *Abusive language:* a calm boundary reply, or the angry-tone handover when that rule is on.
  - *Harmful requests:* violence, weapons and drugs, sexual and hateful messages are declined.
  - *Reply filter:* a reply with profanity is never sent.

**Advanced (Pro and Enterprise, off by default):**

- **Double-check weak answers:** a short second model call, only for help answers with numbers not in the articles or a confidence within 0.15 of the threshold. Unsupported answers hand over (or ask to rephrase).
- **Smarter injection detection:** the message's embedding (already computed) against known attempts, with a margin over normal store questions. Measured: 7 of 8 reworded attempts, 0 of 30 normal questions. No extra cost.
- **AI moderation:** the provider's moderation endpoint, only for messages the word lists didn't decide.

**Before the first deploy with this version:** the retention sweep will delete existing AI transcripts older than each workspace's retention (90 days by default in the app). Apply `src/lib/db/migrations/0016_rate_limits.sql` (`npm run db:apply -- …`). The AI service adds its new columns and tables itself on start.

## On WhatsApp: the AI Agent Reply step (Flows)

Customers reach the agent through an automation: **Flows › Automations**, add the **AI Agent Reply**
action after an **Incoming Message** (or Keyword) trigger. A typical automation:

```
Incoming Message ─> AI Agent Reply ─┬─ Replied ──> End
                                    └─ Handover ─> Assign Conversation (Support) ─> End
```

What the step does (`AutomationEngine.aiAgentReply` in `src/lib/automation/engine.ts`):

- Reads the current ticket's recent messages (last 24 h, up to 12) and sends them to the AI service with
  the live policy and the customer's orders (see *Order data* below). Replies are stored as `senderType = "ai"`.
- **Replied**: the agent answered (or asked for details, or refused safely). The ticket is marked as
  handled by AI.
- **Handover**: the agent decided a person should take over (refund, exchange, angry tone, asked for a
  person, your guardrails...). The step sends the agent's handover message, your own message, or nothing
  (step setting), flags the ticket *needs a person* and adds a team-only note with the reason.
  The agent being paused, an attachment it can't read, or the AI service failing also take this path,
  without the agent's message.
- **Stays quiet** (the run ends) while the conversation is with the team: after a handover until
  someone switches the AI back on, or once a teammate replied, paused the AI or assigned the ticket by
  hand. A resolved ticket starts fresh on the customer's next message.
- Messages the customer sends while the agent is replying are answered in the same run (up to two
  follow-ups), because the automation can't start a second run for that customer meanwhile.
- **Reply buttons** (step setting *Show reply buttons*, on by default): the agent's suggestions go out
  as WhatsApp reply buttons (up to 3 short ones) or a list (more, or longer). A greeting gets the starter
  buttons (*Track my order* first when order status is on); every finished answer ends with *No, that's all*.
  A tap reaches the agent as the option's text (`src/lib/meta/whatsapp/quick-replies.ts`), and the inbox
  shows the options under the message.
- **Ending the chat**: "thank you" or "ok" after an answer gets "Is there anything else I can help you
  with?"; "No, that's all", "bye" and the like get a short goodbye, and the step resolves the ticket (step
  setting *Resolve the ticket when the customer ends the chat*, on by default). More thanks after the
  goodbye get no reply. The customer's next message opens a new ticket.
- **Switching the AI back on** for a ticket a teammate took: *Let AI reply* in the AI AGENT section of the
  inbox's contact panel (*Pause AI for this ticket* turns it off again).

Activation is refused when the server has no `UNOCX_AI_URL` / `UNOCX_AI_TOKEN`.

## Order data (Shopify, several stores)

Order answers (WISMO) come from the connected stores. The app reads them, so store tokens never leave
it. It sends them with each turn as `commerce` in `POST /v1/chat`, in a platform-neutral shape
(`src/lib/ai-agent/commerce/types.ts`, mirrored by `CommerceContext` in `ai-service/app/models.py`).

**Which stores a conversation uses** (`buildCommerceContext` in `src/lib/ai-agent/commerce/index.ts`):

| Case | Stores read |
|---|---|
| The WhatsApp number is connected to a store (Integrations › Shopify › store › channels) | that store |
| The number isn't connected to a store | the stores where the contact is already linked to a Shopify customer |
| Dashboard test chat with a "test as" phone/email | every store, read-only (nothing is linked) |
| The workspace has no store | none: the AI service uses its demo data (`DEMO_ORDERS`) |

**Who the customer is:** the contact's Shopify link in that store. Unlinked contacts are matched
automatically, the same way as the contact panel: exactly one Shopify customer whose phone or email
matches is linked; anything else is left for a teammate. A contact a teammate unlinked is never
matched again automatically.

**What is sent:** the latest 10 orders per store, at most 5 stores. Each order has its number, items
summary, status, and the courier, tracking number/link, ETA and delivery state from Shopify's
fulfillments. Totals are sent only for the "hand over high-value orders" rule. Addresses and payment
details are never sent.

| Shopify | Agent status |
|---|---|
| cancelled | Cancelled |
| no active fulfillment | Pending ("being prepared") |
| fully fulfilled and every shipment delivered | Delivered |
| otherwise | Shipped (partly shipped, out for delivery, delivery attempted... when Shopify knows) |

**When things go wrong:** a store needing re-authorization, an error, or no answer within 6 s is sent as
`unavailable`. If no other store identified the customer, order questions are handed to the team
("I can't check orders right now"), not answered with "no orders".

**Caching:** results are cached in memory for 60 s per store and contact (5 min when there's no
matching customer). Shopify `orders/*` webhooks clear a store's cache. With several app instances,
each instance has its own cache.

**Adding a platform** (WooCommerce, ...): implement `CommerceProvider` (`commerce/types.ts`) like
`commerce/shopify.ts` and add it to `PROVIDERS` in `commerce/index.ts`. The AI service and the
automation engine don't change.

## Shipping address

Customers check the address on their order ("may I know the shipping address?") and correct it (in India the flat
number, landmark and PIN code decide whether a parcel arrives). *Knowledge & actions › Actions › Shipping address*
switches it on (on by default). The change link is set below it.

- **Who sees it:** only the customer identified from the session (WhatsApp sender matched to the store customer, or a signed-in visitor), and only for their own orders.
  - An order number that isn't theirs gets "not found on your account".
  - Visitors who aren't signed in are asked to sign in.
  - Asking for someone else's address ("my neighbour's address") is refused.
  - The delivery phone shows only its last 4 digits.
- **How it's shown:** the reply is built by code (`ai-service/app/address.py`), no model call.
  - The AI model never receives the address. It's blanked out of the chat history the model sees later, and out of the AI logs (`[shipping address shown to the customer]`).
  - With several open orders the agent asks which one.
  - The reply ends with "Is everything correct?" and the buttons *Yes, it's correct* / *Change address*.
- **Changing it:** the agent never changes the address itself.
  - **Pending orders:** it explains how, from your Knowledge (add an FAQ such as "How do I change the delivery address?"), then adds "Change your address here: <your link>".
  - **No link set yet:** the line shows the placeholder **Sample link**, and the dashboard warns about it.
  - **Shipped orders:** it says it may be too late, then explains.
  - **Delivered or cancelled orders:** it says the address can't be changed and offers the team.
  - Questions about changing an address from visitors who aren't signed in get the normal knowledge answer (no personal data involved).
- **Shopify:** the orders query asks for `shippingAddress`. This needs the app's protected customer data access to **Address** (as well as Name, Email and Phone). Without it, orders are read without addresses for an hour at a time, so order status keeps working, and the agent says it can't see the address.
- **Sample orders:** shipping columns are read (`Shipping Address1/2`, `Shipping City`, `Shipping Zip`, `Pincode`, `Landmark`, `State`…, and Shopify's export columns). Billing addresses are not kept. The CSV and JSON templates include addresses.

## Test data: sample data and checks

**AI agent › Test data** lets a business try the agent without real customers or a live store. It has two parts.

**1. Sample data** (stored in the app database, `ai_sample_data`, one row per kind; parsing in `src/lib/ai-agent/sample-data.ts`):

| Kind | Upload | Used by |
|---|---|---|
| Sample orders | CSV: any orders export with an order ID column (one row per order or per item; rows with the same order ID become one order, partly shipped when only some items shipped), the template, or Shopify's *Orders › Export*. Many column names are recognised (Order ID / Order no, Order item / Product name, Order date, Ship date, Delivery date, Courier, AWB, Customer ID…); dates may be ISO, day-first or month-first (decided per file) or Excel serials; without a status column the status comes from the dates. Addresses are never kept, and the upload shows which columns were read. JSON: Shopify Admin API orders (REST, GraphQL or bulk export). | Test chat › *Test as: Sample customer*: order questions answer from that customer's sample orders. |
| Sample products | CSV: the template, or Shopify's *Products › Export* (one row per variant). JSON: a product list, or Shopify Admin API products. | Test chat › *Website* view, and the widget preview's *Use sample products*: the shopping assistant recommends from them. |
| Help & FAQ | No upload here: answers come from **Knowledge**, as in production. | Everything. |

- Uploading replaces that kind.
- Files are decoded in the browser whatever Excel saved them as (UTF-8, UTF-16 or ANSI).
- Limits: 2000 orders (50 per customer), 1000 products, 10 MB.

**2. Checks** (`ai.test_cases`; *Run all* scores the agent):

- **Generated from sample orders** (`source = sample_orders`):
  - one order-status check per order, up to 50, latest order of each customer first;
  - the reply must mention the order number and the right status words;
  - each check carries the customer's orders (`commerce`).
- **Generated from sample products** (`source = sample_products`):
  - one shopping check per product, up to 30: "Do you have the Linen shirt?";
  - the reply must name the product, or say a sold-out one is sold out;
  - each check carries the product plus alternatives (`catalog`) and runs with the shopping assistant on.
- **Replacing:** uploading the same kind again replaces its generated checks (`DELETE /v1/tests/cases?source=…`). Removing the data removes them.
- **Your own checks** (`source = manual`) are kept: *Add check*, *Add to test set* in the test chat, or *Upload checks* (CSV with a `question` column, or JSON).

## Knowledge gaps

*AI agent › Knowledge gaps* lists the help questions the agent didn't answer well, so the business knows what to add to its Knowledge.

- **What counts as a gap:** only help questions (the knowledge route), when
  - the agent found no answer in the knowledge, or the model declined to answer from it (*No answer*, confidence 0%);
  - it handed over for low confidence, or answered with a confidence score below **70%** (*Low confidence*);
  - the customer gave the answer a thumbs-down (*Customer said unhelpful*).

  Order, shopping, keyword-flow and guardrail replies are never gaps. Test runs and gap re-tests don't create gaps; test chats do (shown as *Test chat*).
- **Score:** the agent's confidence score (0–100%): how strongly the retrieved articles support the answer, whether the top article was cited, minus penalties (for example a number in the reply that isn't in the sources).
- **Grouping:** wordings with the same content words, or with embeddings at least 0.78 similar, are one gap. The gap shows how many times it was asked, the other wordings (up to 5), and the agent's last reply. The list is sorted by times asked × (1 − confidence).
- **Fixing:** *Write answer* adds the Q&A to a Knowledge FAQ source, "Answers from knowledge gaps" (editable in Knowledge like any FAQ). That is what lets the agent answer next time. The answer also becomes a check in *Test data › Checks* (`source = knowledge_gap`), so every test run confirms it stays answered. Answering again updates the same FAQ entry and check.
- **Re-test:** after the FAQ is indexed, the question is asked again as a new customer and the new confidence is stored. The *Fixed* list shows before → after. Open gaps at least 0.6 similar are re-tested too, and close by themselves if they're now answered with 70% or more confidence. *Re-test* asks again at any time; test runs update the score of gaps whose check they ran.
- **Coming back:** if customers still get a gap-level answer after a fix, the gap reopens (*Came back after a fix*).
- **Ignore:** for questions the agent shouldn't answer. They're still counted, but stay out of the list.
- **Summary:** the share of help questions answered with 70% or more confidence (last 30 days, test chats excluded), gaps to fix, gaps fixed and confirmed, and the average gain in confidence.

The agent isn't retrained: answers come from the Knowledge, and the checks guard them.

## Website chat (inbox channel)

**Settings › Channels › Website chat** (or *Add channel › Website chat*) adds a chat widget for any website. It is an
inbox channel (`channels.type = 'webchat'`, one per organisation, linked from `ai_widgets.channel_id`; migration 0017
linked existing widgets). Its settings (install code, sales assistant, look, order questions) and a live preview live
on the channel's card. The AI agent page no longer has a widget tab, and its test chat has no "Website" view.

- **Install:** one line on any website, before `</body>`:
  `<script src="<app>/api/widget/<publicKey>/loader.js" async></script>`.
  - **Shopify:** Online Store › Themes › Edit code › `layout/theme.liquid`.
  - **Where it runs:** *Allowed websites* is optional. Empty means any site (`frame-ancestors *`); listed domains restrict it.
  - **What the loader adds:** the launcher, an optional invitation bubble, and an iframe with the chat (`/api/widget/<key>/frame?p=<page>`). It also shows a red dot when the team replies while the chat is closed.
- **Inbox:**
  - **Visitors:** each one is a contact (`customers.external_id = 'web:<visitor id>'`, a random 128-bit id kept in the widget's storage on that site). Their messages and the AI's replies are saved on a ticket and appear live in the inbox under *Website chat*.
  - **Team replies:** a teammate replies from the inbox (`POST /api/channels/webchat/send`, text only). The widget polls `GET /api/widget/<key>/messages?visitor=&after=`: every 3 s while a person is on the chat, every 6 s while it's open, less often otherwise.
  - **AI stays out of team chats:** once the team handles the chat (AI handover, a teammate's reply, *Pause AI* or a manual assignment), the AI stays quiet, as on WhatsApp. *Let AI reply* hands it back.
  - **AI agent paused:** messages simply wait in the inbox.
- **Shopping assistant:**
  - **Reading what the visitor wants:** `src/lib/ai-agent/shopping.ts` reads it from the conversation: budget ("my budget is $100", "under 2k", "between 40 and 90"), size ("size M", "UK 8"), who it's for ("women", "for my wife"), colour, and product words. Newer messages override older ones.
  - **Fetching products:** `shopifyService.agentCandidates` fetches up to 40 active products with every variant's price, stock and options. It searches title, tag and type, or falls back to the newest products when the store has nothing of that kind.
  - **Picking products:** `pickProducts` keeps those that fit, choosing the variant in the right size and colour within the budget, so its price and its *Buy now* link are used.
  - **When nothing fits:** it relaxes colour, then size, then budget, then gender, and tells the AI what had to be dropped (`sales.criteria`, `criteria_matched`, `relaxed`). The reply then says so honestly ("we don't have shoes", "nothing under $10").
  - **Price check:** prices in the reply are checked against the store data, the offer and the visitor's stated budget.
- **Order questions:** order status, problems, address, refunds, exchanges and cancellations are never answered in the website chat, because visitors aren't verified. They get "Continue on WhatsApp" (`action.type = "whatsapp"`), linking to the chosen WhatsApp number, or automatically to the connected one.
- **Limits:** 20 messages a minute per visitor IP, 300 per widget, 40 polls a minute per visitor, 12 messages of history for the AI.
- **Preview:** the live preview on the channel card uses the unsaved settings (`/api/ai-agent/widget/frame` + `/preview`) and the real agent and store. Nothing is saved to the inbox. With sample products uploaded (Test data), *Use sample products* recommends from them instead.
- **Products not published to the Online Store:** used only when a store has none published (development stores), linked by handle.

## Bring your own model

**Model › Bring your own model** connects the business's own OpenAI, Anthropic, Gemini or Groq key.

- **Saving:**
  - *Save* tests the key first (`POST /v1/llm/test`); a key that fails is never stored.
  - The key is encrypted in `ai_agent_configs.byo_api_key` and only its last 4 characters are shown.
  - Choosing *Bring your own model* as the model, and saving the version, makes it live.
- **What it's used for:**
  - Only for writing replies. Knowledge search (embeddings), guardrails and order lookups stay on UnoCX, so switching never needs a re-index.
  - All four providers are called through their OpenAI-compatible APIs (`ByoProvider` in `ai-service/app/llm.py`).
- **Fallback:** if the provider fails, or the estimated monthly spend reaches the limit, that reply uses UnoCX Standard (flags `byo_failed` / `byo_limit_reached`).
- **Usage:**
  - Logged as `byo_chat`, with a cost estimate. Unknown models are estimated at a deliberately high rate.
  - Excluded from UnoCX's own budget and credits.
- **Removing the key:** a live version that used it is replaced by one on Standard.

## Not built yet

- **Instagram.** Automations only run on WhatsApp today.
- **Outside business hours.** Stored in the policy but not applied yet.
- **Orders older than 60 days** need Shopify's `read_all_orders` scope (public app distribution only).
- **Fulfillment-update webhooks.** Tracking changes show up after the 60 s cache expires, not instantly.
- **Customer-chosen store** when the same order number exists in two stores (the newer order is used).
- **Bring your own model** (shown as Enterprise, disabled) and the 80% usage alert.

## Tests

```bash
cd ai-service
LLM_PROVIDER=fake DATABASE_URL=postgresql://unocx:unocx@localhost:5432/unocx python -m pytest -q
```
`tests/test_policy.py` (pure) and `tests/test_admin_api.py` (needs the seeded database) cover the
policy and the dashboard endpoints. `tests/test_guardrails_v2.py` covers the guardrails (injection and its
false positives, content scanning, output and price checks, moderation, topics, tool tiers, retention, plan-gated
checks). On the app side, `npm run test:ai-guardrails` checks policy validation, plan gating and the shared rate
limit.
