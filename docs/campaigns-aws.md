# Campaigns: storage, scheduling and sending

Bulk WhatsApp template campaigns. A user uploads a contact file, picks an approved template, maps its
variables to file columns, and schedules a start time. Optionally they set a 1–15 minute delay between contacts.

## Flow

```
Browser ── PUT /api/campaigns/:id/audience (file) ──► API ──► S3  organizations/{org}/campaigns/{campaign}/{uuid}.csv|xlsx
                                                         └──► Postgres  campaign_recipients (1 row per number)

Browser ── POST /api/campaigns/:id/actions {schedule} ──► API: checks everything, refreshes the template
                                                          from Meta, draft → scheduled
                                                         └──► EventBridge Scheduler: one-time schedule
                                                              "<prefix>-campaign-<id>" at scheduled_at

at scheduled_at:  Scheduler ──► SQS ──► Lambda ──► POST /api/campaigns/worker (the app)
                                 {"type":"start"} → app: scheduled → running, app queues tick #0 in SQS
                                 {"type":"tick"}  → app: still running? claim next recipients, send to Meta,
                                                    record, and only then queue the next tick in SQS
                                                    (DelaySeconds = interval, max 900 s = 15 min)

WhatsApp status webhooks ──► campaign_recipients (sent → delivered → read / failed, pricing)
```

The Lambda (code inline in `infra/campaigns/cloudformation.yaml`) only delivers messages. It has no business
logic and no database access. The app decides everything and reuses `whatsAppService.sendMessage` with
`skipHistory: true`: it keeps the opt-out check, the per-number rate limit and template header media, but writes
nothing to the `messages` table or the inbox. `campaign_recipients` is the campaign's own log; its `message_id`
column is kept and stays empty for now.

Because the app queues the next tick only while the campaign is `running`, a pause or cancel stops the chain.
A tick that was already waiting in SQS is ignored when it arrives (status not `running`, or an old run number).

If the app answers with an error or is unreachable, the Lambda reports that message as failed. SQS retries it
after 30 s and moves it to the dead-letter queue after 2 retries (`maxReceiveCount: 3`). Retrying is safe
because ticks are numbered and leased. A campaign whose tick ends in the dead-letter queue isn't stuck: the
30 s sweep restarts it within about 5 minutes.

## Guarantees

| Concern | How it's handled |
|---|---|
| One campaign at a time per workspace | Unique index `uq_campaigns_one_active_per_org` allows one `scheduled` or `running` campaign per organization. Scheduling or resuming a second one is refused with the name of the active one. Workspaces are independent, so different workspaces send in parallel. Drafts, paused and finished campaigns don't take the slot. |
| A contact never gets the message twice | `UNIQUE (campaign_id, phone)`. Each recipient is claimed (`pending → sending`) with `FOR UPDATE SKIP LOCKED` before Meta is called. After that it never goes back to `pending`: if the worker dies mid-call, the row becomes `unknown` and is not retried. |
| SQS delivers a message twice | Ticks are numbered (`tick_seq`) and leased (`worker_lease_until`), so only the expected tick runs, and only once. |
| Pause / Resume | Pause is a status change; a running batch notices within ~2 s and puts its unsent claims back. Resume starts a new `run_generation`, so ticks queued before the pause are dropped. |
| Cancel | Status `cancelled`; pending recipients become `cancelled`; the schedule is deleted. Messages already sent stay sent. |
| Edit after scheduling | Not possible. Only drafts can be edited; from `scheduled` on, the campaign and its contact list are locked and shown read-only. To change one, cancel it and duplicate it. |
| Lost schedule / lost message / crash | A sweep every 30 s starts overdue scheduled campaigns and revives running campaigns whose tick chain went quiet. |

## Errors: the campaign keeps going, and stops only after 20 failures in a row

Implemented in `src/lib/campaigns/errors.ts` and `engine.ts`. No single error stops a campaign: the contact
is marked and sending continues. When **20 contacts in a row** fail (no success between them, whatever the
error), the campaign is paused (`error_threshold`) with the last error. The owner checks the problem and
resumes it manually. Contacts already marked failed are not re-sent on resume.

| Error | Contact | Counts toward the 20 |
|---|---|---|
| Opted out | `skipped` | No |
| 131049 (Meta held back a marketing message) | `failed` (code 131049) | No: normal for marketing |
| 130429, 131056, 80007, 4, local rate limit ("too fast") | Back in the queue for 30 s | No |
| Meta 5xx / temporary | Retried after 1 min, then 5 min (3 attempts), then `failed` | Only when its attempts are used up |
| Timeout without a response | `unknown` (not retried; may have been sent) | Yes |
| Anything else: template paused/disabled (132015/132016), token expired (190), account blocked, payment (131042), number disconnected, invalid number (131026)… | `failed` | Yes |

## Marketing Messages API

Campaigns that use a **MARKETING** template are sent through Meta's Marketing Messages API for WhatsApp
(`POST /{phone-number-id}/marketing_messages`); utility and other templates stay on `POST /{phone-number-id}/messages`.
The body, the `wamid` in the response and the status webhooks are the same. Only campaign sends use it; the inbox and
automations are unchanged.

To get the optimized delivery, someone with full control of the business portfolio accepts the Marketing Messages
terms (WhatsApp Manager → Overview → Alerts → Accept terms). Until then, Meta's default policy
(`CLOUD_API_FALLBACK`) delivers the message through Cloud API, so campaigns keep working. The route shows in the
recipient's `pricing_category`: `marketing_lite` = Marketing Messages API, `marketing` = Cloud API.

## Pricing from webhooks

WhatsApp status webhooks carry a `pricing` object. Each campaign recipient stores `billable`,
`pricing_category` (marketing / utility / authentication…) and `pricing_model` (e.g. PMP). Meta does **not**
send the amount; that depends on Meta's rate for the recipient's country.

## Logs export

Campaigns list → row menu → **Export logs (CSV)** (`GET /api/campaigns/:id/export`). One line per contact:
phone, every column of the uploaded file, status, error code/message, attempts, sent/delivered/read times,
billable, pricing category and model. It's streamed in pages of 2,000, so large campaigns export without
loading into memory. Log retention (deleting old recipient rows) is planned, not implemented.

## Number limits in the wizard

When a sender number is picked, the wizard shows Meta's live values for it: 24 h messaging limit (tier),
throughput, and quality rating. It warns when the campaign has more contacts than the tier allows.

## Setup

1. **Database**: `npm run db:migrate` applies `0015_campaigns.sql` (`campaigns`, `campaign_recipients`),
   `0016_campaigns_one_running_pricing.sql` (pricing columns) and `0017_campaigns_one_active_per_org.sql`
   (one scheduled or sending campaign per workspace).
2. **Worker secret**: generate one with `openssl rand -hex 32`. The same value goes into the stack parameter
   `WorkerSecret` and the app's `CAMPAIGN_WORKER_SECRET`.
3. **AWS resources**: deploy `infra/campaigns/cloudformation.yaml` once per environment. It creates the queue,
   the dead-letter queue, the schedule group and role, the Lambda with its SQS trigger, a DLQ alarm, and the
   app policy:
   ```sh
   aws cloudformation deploy \
     --stack-name unocx-dev-campaigns \
     --template-file infra/campaigns/cloudformation.yaml \
     --parameter-overrides Stage=dev AppUrl=https://<app-url> WorkerSecret=<secret> MaxConcurrency=5 \
     --capabilities CAPABILITY_NAMED_IAM
   aws cloudformation describe-stacks --stack-name unocx-dev-campaigns --query "Stacks[0].Outputs"
   ```
   `Stage` defaults to `dev` and names every resource `unocx-<stage>-…`; use another value (e.g. `prod`) for a
   separate environment. Changing `Stage` on an existing stack replaces all its resources (new queue URL/ARN,
   schedule group, roles, Lambda, log group, app policy): update the app's variables and re-attach the policy.
   `AppUrl` must be reachable from the Lambda; the public URL works.
4. **IAM**: attach the `AppPolicyArn` output to the IAM user or role the app runs with. It allows sending to
   the queue and managing schedules; the app doesn't read the queue.
5. **Environment variables** (from the stack outputs):

   | Variable | Value |
   |---|---|
   | `CAMPAIGN_QUEUE_URL` | `CampaignQueueUrl` |
   | `CAMPAIGN_QUEUE_ARN` | `CampaignQueueArn` |
   | `CAMPAIGN_SCHEDULER_ROLE_ARN` | `SchedulerRoleArn` |
   | `CAMPAIGN_SCHEDULE_GROUP` | `ScheduleGroup` |
   | `CAMPAIGN_WORKER_SECRET` | the secret from step 2 |
   | `CAMPAIGN_SCHEDULE_PREFIX` | optional, default `unocx` (keeps environments apart in one account) |
   | `CAMPAIGN_WORKER` | `off` to disable the 30 s sweep and in-process mode on an instance |
   | `AWS_S3_BUCKET` | your bucket (created by you, e.g. `unocx-dev-assets-2026-731904`); contact files go to `organizations/{orgId}/campaigns/{campaignId}/` |

   `AWS_REGION`, `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` are the existing variables.

6. **Monitoring**: the stack creates the alarm `unocx-<stage>-campaigns-dlq-not-empty`. Add an SNS action to it
   to get notified. Lambda logs are in CloudWatch under `/aws/lambda/unocx-<stage>-campaign-worker`.

To change the Lambda code, edit the `ZipFile` block in the template and deploy again. The Lambda stores the
secret as an environment variable; move it to Secrets Manager if your policy requires that.

## Running without AWS (local development)

The app falls back to in-process mode for whichever AWS variables are unset:

- **No queue** (`CAMPAIGN_QUEUE_URL` unset): ticks run in-process with `setTimeout`.
- **No scheduler** (role or queue ARN unset): the 30 s sweep starts campaigns when their time comes.

This works for a single instance. In production, configure SQS so ticks survive restarts and spread across
instances.

## Code map

| Path | What |
|---|---|
| `src/lib/db/schema/campaigns.ts` | Tables, statuses, pause reasons |
| `src/lib/db/repositories/campaign.repository.ts` | Claims, leases, stats, webhook status updates |
| `src/lib/campaigns/contact-file.ts` | CSV/Excel parsing and phone validation (browser preview and server import) |
| `src/lib/campaigns/aws.ts` | SQS send, EventBridge schedules, in-process fallback |
| `src/lib/campaigns/engine.ts` | start / tick / sweep |
| `src/lib/campaigns/errors.ts` | Meta error → reaction |
| `src/lib/campaigns/worker.ts` | Sweep timer and in-process mode, started from `instrumentation.ts` |
| `src/app/(backend)/api/campaigns/worker/route.ts` | Endpoint the Lambda calls (Bearer `CAMPAIGN_WORKER_SECRET`) |
| `infra/campaigns/cloudformation.yaml` | All AWS resources, including the inline Lambda code |
| `src/lib/services/campaign.service.ts` | API logic: validation, state changes, DTO |
| `src/app/(backend)/api/campaigns/**` | REST endpoints |
