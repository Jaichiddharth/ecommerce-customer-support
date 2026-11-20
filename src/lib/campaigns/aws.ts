import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import {
  SchedulerClient,
  CreateScheduleCommand,
  UpdateScheduleCommand,
  DeleteScheduleCommand,
  ConflictException,
  ResourceNotFoundException,
  type CreateScheduleCommandInput,
} from "@aws-sdk/client-scheduler";
import { createLogger } from "@/lib/logger";

/**
 * AWS plumbing for campaigns:
 *
 *   EventBridge Scheduler (one-time schedule per campaign, at scheduled_at)
 *        └─► SQS ─► Lambda (inline in the CloudFormation template) ─► POST /api/campaigns/worker (this app)
 *              {type:"start"} → campaign → running, the app enqueues tick #0
 *              {type:"tick"}  → the app sends a batch (or 1 contact when an interval is set) and, only while the
 *                               campaign is still running, enqueues the next tick (DelaySeconds = interval, max 900)
 *
 * Environment (see docs/campaigns-aws.md and infra/campaigns/cloudformation.yaml):
 *   CAMPAIGN_QUEUE_URL            SQS queue for start/tick messages; unset → ticks run in-process (local development)
 *   CAMPAIGN_QUEUE_ARN            same queue, as the Scheduler target
 *   CAMPAIGN_SCHEDULER_ROLE_ARN   role EventBridge Scheduler assumes to send to the queue
 *   CAMPAIGN_SCHEDULE_GROUP       schedule group (default "default")
 *   CAMPAIGN_SCHEDULE_PREFIX      prefix of schedule names, to keep environments in one account apart (default "unocx")
 * Region and credentials come from the standard AWS_REGION / AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY.
 */

const log = createLogger("CampaignAws");

export type CampaignQueueMessage =
  | { type: "start"; campaignId: number }
  | { type: "tick"; campaignId: number; generation: number; seq: number };

/** SQS's maximum message delay, which is also the longest interval a campaign allows (15 min) */
export const MAX_DELAY_SECONDS = 900;

export const queueUrl = () => process.env.CAMPAIGN_QUEUE_URL || "";
export const isQueueConfigured = () => Boolean(queueUrl());
export const isSchedulerConfigured = () =>
  Boolean(process.env.CAMPAIGN_QUEUE_ARN && process.env.CAMPAIGN_SCHEDULER_ROLE_ARN);

let sqsClient: SQSClient | null = null;
let schedulerClient: SchedulerClient | null = null;
const sqs = () => (sqsClient ??= new SQSClient({}));
const scheduler = () => (schedulerClient ??= new SchedulerClient({}));

// ─── Queue ────────────────────────────────────────────────────────────────────

type LocalHandler = (msg: CampaignQueueMessage) => Promise<void>;
const local = ((globalThis as any).__campaignLocalQueue ??= { handler: null as LocalHandler | null }) as { handler: LocalHandler | null };

/** In-process fallback when no queue is configured (local development, single instance) */
export function setLocalQueueHandler(handler: LocalHandler) {
  local.handler = handler;
}

export async function enqueue(msg: CampaignQueueMessage, delaySeconds = 0): Promise<void> {
  const delay = Math.max(0, Math.min(MAX_DELAY_SECONDS, Math.round(delaySeconds)));
  if (isQueueConfigured()) {
    await sqs().send(new SendMessageCommand({ QueueUrl: queueUrl(), MessageBody: JSON.stringify(msg), DelaySeconds: delay }));
    return;
  }
  const handler = local.handler;
  if (!handler) {
    log.warn("Campaign queue message dropped: no queue configured and the in-process worker isn't running", { msg });
    return;
  }
  const timer = setTimeout(() => {
    handler(msg).catch((err) => log.error("In-process campaign message failed", { err, msg }));
  }, delay * 1000);
  timer.unref?.();
}

export function parseQueueMessage(body: string | undefined): CampaignQueueMessage | null {
  try {
    const msg = JSON.parse(body ?? "");
    if (msg?.type === "start" && Number.isInteger(msg.campaignId)) return { type: "start", campaignId: msg.campaignId };
    if (msg?.type === "tick" && [msg.campaignId, msg.generation, msg.seq].every(Number.isInteger)) {
      return { type: "tick", campaignId: msg.campaignId, generation: msg.generation, seq: msg.seq };
    }
  } catch {
    // fall through
  }
  return null;
}

// ─── Scheduler ────────────────────────────────────────────────────────────────

const group = () => process.env.CAMPAIGN_SCHEDULE_GROUP || "default";
export const scheduleNameFor = (campaignId: number) => `${process.env.CAMPAIGN_SCHEDULE_PREFIX || "unocx"}-campaign-${campaignId}`.slice(0, 64);

/** "2026-11-20T04:30:00" (UTC, no zone suffix) as `at()` expects */
const atExpression = (date: Date) => `at(${date.toISOString().slice(0, 19)})`;

/**
 * Creates (or moves) the one-time schedule that starts the campaign. Returns the schedule name, or null when
 * the scheduler isn't configured; the worker's sweep then starts the campaign when its time comes.
 */
export async function upsertStartSchedule(campaignId: number, startAt: Date): Promise<string | null> {
  if (!isSchedulerConfigured()) return null;
  const name = scheduleNameFor(campaignId);
  const input: CreateScheduleCommandInput = {
    Name: name,
    GroupName: group(),
    ScheduleExpression: atExpression(startAt),
    ScheduleExpressionTimezone: "UTC",
    FlexibleTimeWindow: { Mode: "OFF" },
    ActionAfterCompletion: "DELETE",
    Description: `Starts campaign ${campaignId}`,
    Target: {
      Arn: process.env.CAMPAIGN_QUEUE_ARN!,
      RoleArn: process.env.CAMPAIGN_SCHEDULER_ROLE_ARN!,
      Input: JSON.stringify({ type: "start", campaignId } satisfies CampaignQueueMessage),
      RetryPolicy: { MaximumEventAgeInSeconds: 3600, MaximumRetryAttempts: 10 },
    },
  };
  try {
    await scheduler().send(new CreateScheduleCommand(input));
  } catch (err) {
    if (!(err instanceof ConflictException)) throw err;
    await scheduler().send(new UpdateScheduleCommand(input));
  }
  log.info("Campaign start scheduled", { campaignId, name, startAt: startAt.toISOString() });
  return name;
}

export async function deleteStartSchedule(name: string | null | undefined): Promise<void> {
  if (!name || !isSchedulerConfigured()) return;
  try {
    await scheduler().send(new DeleteScheduleCommand({ Name: name, GroupName: group() }));
  } catch (err) {
    // Already fired (ActionAfterCompletion deletes it) or removed by hand
    if (!(err instanceof ResourceNotFoundException)) throw err;
  }
}
