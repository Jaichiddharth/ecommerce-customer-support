# WhatsApp Flows & Automation integration

How Unocx creates, publishes, sends and receives Meta WhatsApp Flows, and how the
Automation Builder uses them. Static Flows only: no data-exchange endpoint.

## Deploying

1. **Migration**: `npm run db:migrate` applies `0006_whatsapp_flows_automations` (new tables), `0007_automation_listing` (new columns on `automations`) and `0008_automation_reliability` (run leases, graph versions, unique keys for open runs and webhook wamids). 0008 closes duplicate open runs (keeps the oldest) and clears the wamid on duplicate message rows before creating the unique indexes; no rows are deleted.
2. **Env**: existing vars (`META_APP_SECRET`, `TOKEN_ENCRYPTION_KEY`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN`) are reused. Optional:
   | Var | Default | Purpose |
   | --- | --- | --- |
   | `AUTOMATION_SCHEDULER` | on | `off` disables the in-process scheduler (then a cron must call the sweep) |
   | `AUTOMATION_SWEEP_INTERVAL_MS` | 10000 | how often the scheduler runs a maintenance pass |
   | `AUTOMATION_RUN_RETENTION_DAYS` | 90 | finished runs older than this are deleted |
   | `WHATSAPP_SEND_RATE_PER_SECOND` | 60 | outbound messages per second per business number (Meta default limit ~80) |
   | `DB_POOL_MAX` / `DB_IDLE_TIMEOUT_SECONDS` / `DB_CONNECT_TIMEOUT_SECONDS` | 20 / 20 / 10 | postgres-js pool |
   | `REALTIME_BUS` | local | `postgres` delivers live events across several app instances via LISTEN/NOTIFY |
   | `CRON_SECRET` | — | only needed if the sweep endpoint is called by a cron |
3. **Scheduler**: runs inside the app (started from `src/instrumentation.ts`), every 10 s. Each pass resumes Delay
   steps, retries steps that failed transiently, times out Flow waits, releases runs interrupted by a restart,
   expires unanswered / interrupted Flow sends, re-processes stored responses, replays automation triggers lost
   in a restart, and prunes old runs. `POST /api/automations/sweep` (`Authorization: Bearer $CRON_SECRET`) runs
   the same pass and can be added as a second trigger; passes are safe to run concurrently and on several instances.
4. **Meta App webhooks**: besides `messages`, subscribe the app to the WABA fields
   `flows` and `message_template_status_update`. They arrive on the existing
   `/api/webhooks/whatsapp` endpoint with the same signature check.
5. **Token scopes**: `whatsapp_business_management` and `whatsapp_business_messaging`.
   Publishing also needs a verified business (Meta requirement).

## Model

| Table | Purpose |
|---|---|
| `whatsapp_flows` | Merchant's Flow: name, categories, number/WABA, **editable draft** (internal editor model), derived status, live version |
| `whatsapp_flow_versions` | **Immutable** published snapshots. Each version is its own Meta Flow (`meta_flow_id`) with the exact JSON uploaded |
| `whatsapp_templates` | Templates created here. The FLOW button pins one **version** (`flow_version_id`). One Flow → many templates |
| `whatsapp_flow_executions` | One Flow sent to one contact: unique `flow_token`, version, template, automation run, wamid, status |
| `whatsapp_flow_submissions` | Customer responses (`nfm_reply`), unique per `(org, wamid)` and per execution |
| `automations` / `automation_runs` | Automation Builder graphs (server copy) and their runs, including waiting state |

The editor model (`src/lib/whatsapp-flows`) is never sent to Meta.
`buildFlowJson` transforms it, and `validateFlow` + `validateMetaJson` run **on the server** before publishing.

## Lifecycles

**Flow**: edit draft → *Publish* → server validates → `POST /{WABA}/flows` (name, categories, flow_json)
→ Meta id stored immediately → `POST /{flow}/publish` → version `published`.
A failed attempt stays resumable: a retry re-uploads `flow.json` to the same Meta Flow instead of
creating another. Editing after publishing only changes the draft. The next publish creates v2, and v1
(and the templates pinned to it) keep working until v1 is deprecated.
Flow status: `draft → publishing → published | failed`, plus `deprecated` / `archived`.

**Template**: created only from a published version. Stored locally first (`SUBMITTING`), then
`POST /{WABA}/message_templates` with a `BUTTONS` → `FLOW` button (`flow_id`, `flow_action: navigate`,
`navigate_screen` = entry screen). Review status comes from the `message_template_status_update`
webhook or *Sync*. It is tracked independently: a published Flow does not make a template approved.

**Send** (`flow-send.service`): resolves the version (the template's pinned one, or the Flow's live one),
checks that the template is `APPROVED`, checks the 24-hour window for interactive sends, and requires the
contact's number to be on the Flow's WABA. It creates the execution with a fresh `flow_token`, then sends
through the existing `whatsAppService.sendMessage`. Template sends use a `button/flow` parameter carrying
the token. Interactive sends use `interactive.type = flow`, version 3.

**Test Flow** (`sendTest`): from the Flow details page or a template row/details. Sends an `APPROVED`
template of the Flow to any number (with country code) from a live number on the template's WABA,
preferring the template's own number. The number is resolved to a contact on that number (created if new,
as any outbound send does), then the normal template send above runs: a real Cloud API request, an
execution with its own `flow_token`, and the tester's answer is stored as a submission.

**Response**: the webhook saves the inbound message as before, then stores the submission inside the
request. The execution is matched by `flow_token`, falling back to `context.id` = the wamid we sent, since
Meta doesn't guarantee the token is in `response_json`. The match is checked for org and contact.
Completing the execution and resuming the automation runs in Next's `after()`, so Meta gets a fast 200.
A retried webhook is deduplicated by wamid. The execution completes atomically, so a run resumes only once.

## Automation runtime (`src/lib/automation/engine.ts`)

- Triggers: *Incoming Message*, *Keyword Trigger*. Each inbound wamid starts at most one run per
  automation, and a contact with an open run of that automation isn't started again.
- New nodes: **Send WhatsApp Flow** (template or interactive) and **Wait for Flow Submission** (timeout, default 24h).
- Waiting is a DB state (`automation_runs.status = waiting`). Nothing blocks a request or a worker.
- Answers are available to later steps as `{{flow.<field>}}` (Send Message, Update Contact) and as the
  condition attribute `flow.<field>`. `{{contact.name}}` and `{{message.text}}` also work.
- Activation (`PUT /api/automations/:id {isActive:true}`) validates the graph: a trigger exists, Flows
  are published, templates are approved and open the selected Flow, and Wait steps come after a Send step.
- Not implemented in the runtime: *Assign Conversation* (no team mapping yet), and *Branch* follows
  the first edge only.

## Automation listing

Flows → Automations opens the listing. Create, or click an automation, to open it in the node builder
by id. The builder now saves every automation to the workspace. The old single graph kept in browser
storage is offered once as an import.

- **Status** is derived, not stored. **Draft**: never activated. **Active**: switched on.
  **Failed**: switched on, but the latest run failed. **Paused**: activated before, now off.
  **Archived**: removed but kept. Migration `0007` adds `description`, `activated_at` and `archived_at`
  to `automations`, and backfills `activated_at` for automations that are already active.
- **Delete** removes automations that never ran. Anything with history is **archived**: switched off,
  waiting runs cancelled, history kept, restorable as Paused. **Duplicate** creates an inactive Draft.
- **Pausing** stops new triggers. Runs already waiting (e.g. for a Flow response) still finish.
- **Execution history** (`/runs`, paginated, status filter) and **details** (`/runs/:runId`: step log,
  waiting state, error, Flow answers) are read from `automation_runs`.

## API

| Route | |
|---|---|
| `GET/POST /api/whatsapp-flows` | list (`q`, `status`, `page`, `pageSize`; `published=1` for pickers) / create |
| `GET/PATCH/DELETE /api/whatsapp-flows/:id` | details / save draft / delete (unused drafts) or archive |
| `POST /api/whatsapp-flows/:id/{publish,sync,duplicate,restore,send}` | |
| `POST /api/whatsapp-flows/:id/test` | Test Flow: `{ phone, templateId }`, a real template send to any number |
| `POST /api/whatsapp-flows/:id/versions/:v/deprecate`, `GET …/preview` | |
| `GET /api/whatsapp-flows/submissions`, `GET /api/whatsapp-flows/recipients?q=` | |
| `GET/POST /api/whatsapp-templates`, `GET/DELETE …/:id`, `POST …/:id/{sync,retry}` | |
| `GET/POST /api/automations` (listing: `q`, `status`, `trigger`, `modified`, `execution`, `page`), `GET/PUT/DELETE …/:id`, `POST …/:id/{duplicate,restore}`, `GET …/:id/runs`, `GET …/:id/runs/:runId` | |
| `GET/POST /api/automations/sweep` | optional cron (`CRON_SECRET`); the app runs it in-process |

Every route except the sweep uses `withAuth` and is scoped to the caller's organization. Webhook updates
resolve the tenant from the stored row and are ignored if the WABA doesn't match.
