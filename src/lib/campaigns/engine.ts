import { campaignRepository } from "@/lib/db/repositories/campaign.repository";
import {
  CampaignPauseReason,
  CampaignStatus,
  RecipientStatus,
  type Campaign,
  type CampaignRecipientRow,
} from "@/lib/db/schema";
import { whatsAppService } from "@/lib/services/channels/whatsapp.service";
import { buildTemplateSendComponents } from "@/lib/whatsapp-templates";
import { isMediaHeader } from "@/types/templates";
import { mapLimit } from "@/lib/concurrency";
import { createLogger } from "@/lib/logger";
import { enqueue, isSchedulerConfigured, MAX_DELAY_SECONDS, type CampaignQueueMessage } from "./aws";
import { classifySendError, countsAsFailure } from "./errors";
import { emptyFieldsFor, resolveValues } from "./message";

/**
 * Campaign sending. One "tick chain" per running campaign: each tick claims the next recipients, sends them,
 * then enqueues the next tick (right away, or after the campaign's interval). Rules:
 *
 *  - One active (scheduled or sending) campaign per workspace, database-enforced: a second one can't be
 *    scheduled or resumed. Workspaces are independent and run in parallel.
 *  - No duplicates: a recipient is claimed (`sending`) in the database before Meta is called and never returns
 *    to `pending` after a call may have gone out; ticks are numbered (`tick_seq`) and leased, so a queue
 *    message delivered twice is ignored; pause/resume bumps `run_generation`, so old ticks are dropped.
 *  - Pause / cancel are a status change: ticks stop at the next send, unsent claims go back to `pending`.
 *  - Errors never stop the campaign on their own: the contact is marked failed and sending continues.
 *    Only 20 failures in a row (no success between them) pause it (error_threshold); the owner checks and
 *    resumes. Opted-out contacts are skipped; 131049 (held back by Meta) and "too fast" don't count.
 *  - A safety-net sweep starts campaigns whose schedule didn't fire and restarts chains that went quiet.
 */

const log = createLogger("CampaignEngine");

/** Contacts per tick when no interval is set; the per-number rate limiter in whatsAppService paces them */
const BATCH_SIZE = 50;
const SEND_CONCURRENCY = 8;
/** Tick lease and recipient claim: comfortably longer than a batch takes */
const TICK_LEASE_MS = 5 * 60_000;
const CLAIM_LEASE_MS = 4 * 60_000;
/** How often a running batch re-reads the campaign status, so Pause stops it quickly */
const STATUS_CHECK_MS = 2_000;
const MAX_ATTEMPTS = 3;
const RETRY_BACKOFF_S = [60, 300, 900];
const THROTTLE_BACKOFF_S = 30;
/** Failures in a row (no success between them) that pause the campaign */
export const FAILURE_THRESHOLD = 20;

const secondsUntil = (date: Date) => Math.ceil((date.getTime() - Date.now()) / 1000);

export async function handleCampaignMessage(msg: CampaignQueueMessage): Promise<void> {
  if (msg.type === "start") await startCampaign(msg.campaignId);
  else await runTick(msg.campaignId, msg.generation, msg.seq);
}

/**
 * scheduled → running, then the first tick. A start for a moved, edited or cancelled campaign does nothing.
 * It can't meet another campaign: a scheduled campaign already holds the workspace's only active slot.
 */
export async function startCampaign(campaignId: number): Promise<void> {
  const current = await campaignRepository.findByIdAnyOrg(campaignId);
  if (!current || current.status !== CampaignStatus.SCHEDULED) return;
  // The schedule fired early or for an older time (rescheduled since): the newer schedule will start it
  if (current.scheduledAt && secondsUntil(current.scheduledAt) > 60) return;

  const campaign = await campaignRepository.beginRun(campaignId, null, [CampaignStatus.SCHEDULED], {
    scheduleName: null,
    lastError: null,
  });
  if (!campaign || campaign === "busy") return;
  log.info("Campaign started", { campaignId, organizationId: campaign.organizationId, recipients: campaign.recipientCount });
  await enqueue({ type: "tick", campaignId, generation: campaign.runGeneration, seq: 0 });
}

/**
 * paused → running (new generation) and a fresh tick. Returns "busy" while another campaign of the workspace is
 * scheduled or sending.
 */
export async function resumeCampaign(campaignId: number, organizationId: number): Promise<Campaign | null | "busy"> {
  const campaign = await campaignRepository.beginRun(campaignId, organizationId, [CampaignStatus.PAUSED], { lastError: null });
  if (campaign && campaign !== "busy") await enqueue({ type: "tick", campaignId, generation: campaign.runGeneration, seq: 0 });
  return campaign;
}

interface BatchOutcome {
  /** Failures in a row at the end of the batch, continuing the campaign's count */
  consecutiveFailures: number;
  lastFailure: string | null;
  throttled: boolean;
}

export async function runTick(campaignId: number, generation: number, seq: number): Promise<void> {
  const campaign = await campaignRepository.acquireTick(campaignId, generation, seq, new Date(Date.now() + TICK_LEASE_MS));
  if (!campaign) return; // stale generation, duplicate message, or not running anymore

  let nextDelay: number | null = null;
  let completed = false;
  let outcome: BatchOutcome | null = null;

  try {
    const stuck = await campaignRepository.expireStuckSending(campaignId);
    if (stuck) log.warn("Recipients left mid-send were marked unknown (not retried)", { campaignId, count: stuck });

    const claimed = await campaignRepository.claimDue(
      campaignId,
      campaign.intervalSeconds ? 1 : BATCH_SIZE,
      new Date(Date.now() + CLAIM_LEASE_MS)
    );

    if (claimed.length === 0) {
      const left = await campaignRepository.remaining(campaignId);
      if (left.pending === 0 && left.sending === 0) completed = true;
      // Only retries waiting for their back-off are left: come back when the first one is due
      else nextDelay = left.nextAttemptAt ? Math.max(1, secondsUntil(left.nextAttemptAt)) : THROTTLE_BACKOFF_S;
    } else {
      outcome = await sendBatch(campaign, claimed);
      nextDelay = campaign.intervalSeconds ?? (outcome.throttled ? THROTTLE_BACKOFF_S : 0);
    }
  } catch (err) {
    // Database or unexpected error: keep the chain alive and try again shortly
    log.error("Campaign tick failed", { err, campaignId, generation, seq });
    nextDelay = THROTTLE_BACKOFF_S;
  }

  const failures = outcome?.consecutiveFailures ?? campaign.consecutiveFailures;
  const finished = await campaignRepository.finishTick(campaignId, generation, seq, { consecutiveFailures: failures });
  if (!finished) return;

  // Cancelled while this batch was sending: contacts the batch put back must not stay pending
  if (finished.status === CampaignStatus.CANCELLED) {
    await campaignRepository.cancelPending(campaignId);
    return;
  }

  // Status changes are compare-and-set from `running`, so a Pause or Cancel made meanwhile always wins
  if (completed) {
    if (await campaignRepository.update(campaignId, null, { status: CampaignStatus.COMPLETED, completedAt: new Date() }, [CampaignStatus.RUNNING])) {
      log.info("Campaign completed", { campaignId, organizationId: campaign.organizationId });
    }
    return;
  }

  if (failures >= FAILURE_THRESHOLD) {
    const message = `${failures} messages in a row failed, so sending was stopped. Last error: ${outcome?.lastFailure ?? "unknown"}. Check the problem, then resume.`;
    await campaignRepository.update(
      campaignId,
      null,
      { status: CampaignStatus.PAUSED, pauseReason: CampaignPauseReason.ERROR_THRESHOLD, lastError: message },
      [CampaignStatus.RUNNING]
    );
    log.warn("Campaign stopped after consecutive failures", { campaignId, organizationId: campaign.organizationId, failures, lastError: outcome?.lastFailure });
    return;
  }

  if (finished.status === CampaignStatus.RUNNING && nextDelay !== null) {
    await enqueue({ type: "tick", campaignId, generation, seq: seq + 1 }, Math.min(nextDelay, MAX_DELAY_SECONDS));
  }
}

async function sendBatch(campaign: Campaign, claimed: CampaignRecipientRow[]): Promise<BatchOutcome> {
  // The "in a row" count carries over between ticks and is updated in the order sends finish
  const outcome: BatchOutcome = { consecutiveFailures: campaign.consecutiveFailures, lastFailure: null, throttled: false };
  const template = campaign.template;
  const unsent: number[] = [];
  let stopped = false;
  let lastStatusCheck = Date.now();

  const recordFailure = (message: string) => {
    outcome.consecutiveFailures++;
    outcome.lastFailure = message;
    // Reached the limit: send nothing more in this batch (the tick then pauses the campaign)
    if (outcome.consecutiveFailures >= FAILURE_THRESHOLD) stopped = true;
  };

  if (!template) {
    outcome.consecutiveFailures = FAILURE_THRESHOLD;
    outcome.lastFailure = "The campaign has no template";
    await campaignRepository.release(claimed.map((r) => r.id));
    return outcome;
  }
  const header = template.components?.find((c) => c.type === "HEADER");
  const headerSampleOf = header && isMediaHeader(header.format) ? template.id : undefined;
  // Loaded once per batch instead of once per message
  const connections = await whatsAppService.getConnections(campaign.organizationId);

  await mapLimit(claimed, SEND_CONCURRENCY, async (recipient) => {
    if (!stopped && Date.now() - lastStatusCheck > STATUS_CHECK_MS) {
      lastStatusCheck = Date.now();
      const current = await campaignRepository.currentStatus(campaign.id);
      if (!current || current.status !== CampaignStatus.RUNNING || current.runGeneration !== campaign.runGeneration) stopped = true;
    }
    if (stopped) {
      unsent.push(recipient.id);
      return;
    }

    try {
      const values = resolveValues(campaign.variables, recipient);
      // An empty variable would be rejected by Meta (131008): don't send, and don't count it toward the
      // "failures in a row" pause, since it's this contact's data, not a problem with the campaign
      const empty = emptyFieldsFor(template, campaign.variables, values);
      if (empty.length) {
        await campaignRepository.settle(recipient.id, {
          status: RecipientStatus.FAILED,
          errorCode: null,
          errorMessage: `Not sent: no value for ${empty.map((f) => f.label).join(", ")} (the mapped column is empty for this contact).`,
        });
        return;
      }
      const result = await whatsAppService.sendMessage({
        organizationId: campaign.organizationId,
        channelId: campaign.channelId ?? undefined,
        phoneNumberId: campaign.channelId ? undefined : campaign.phoneNumberId ?? undefined,
        senderType: "system",
        senderName: `Campaign · ${campaign.name}`,
        to: recipient.phone,
        type: "template",
        templateName: template.name,
        languageCode: template.language,
        components: buildTemplateSendComponents(template, values),
        templateHeaderSampleOf: headerSampleOf,
        // Marketing templates go through Meta's Marketing Messages API; utility and others stay on /messages
        useMarketingApi: String(template.category).toUpperCase() === "MARKETING",
        preloaded: { connections },
        // Campaign sends stay out of the messages table and the inbox; campaign_recipients is their log
        skipHistory: true,
      });
      await campaignRepository.settle(recipient.id, {
        status: RecipientStatus.SENT,
        wamid: result.metaResponse?.messages?.[0]?.id ?? null,
        // Kept (always empty for now) in case campaign sends are linked to the inbox later
        messageId: null,
        sentAt: new Date(),
        errorCode: null,
        errorMessage: null,
      });
      outcome.consecutiveFailures = 0;
    } catch (err) {
      const verdict = classifySendError(err);
      const base = { errorCode: verdict.metaCode, errorMessage: verdict.message };
      switch (verdict.kind) {
        case "skip":
          await campaignRepository.settle(recipient.id, { status: RecipientStatus.SKIPPED, ...base });
          break;
        case "held":
          // Meta's marketing limit for this person: not sent, but nothing is wrong with the campaign
          await campaignRepository.settle(recipient.id, { status: RecipientStatus.FAILED, ...base });
          break;
        case "throttle":
          outcome.throttled = true;
          await campaignRepository.release([recipient.id], new Date(Date.now() + THROTTLE_BACKOFF_S * 1000));
          break;
        case "retry":
          if (recipient.attempts < MAX_ATTEMPTS) {
            const wait = RETRY_BACKOFF_S[Math.min(recipient.attempts - 1, RETRY_BACKOFF_S.length - 1)];
            await campaignRepository.settle(recipient.id, { status: RecipientStatus.PENDING, nextAttemptAt: new Date(Date.now() + wait * 1000), ...base });
            break;
          }
          await campaignRepository.settle(recipient.id, { status: RecipientStatus.FAILED, ...base });
          recordFailure(verdict.message);
          break;
        case "unknown":
          await campaignRepository.settle(recipient.id, { status: RecipientStatus.UNKNOWN, ...base });
          recordFailure(verdict.message);
          break;
        default:
          await campaignRepository.settle(recipient.id, { status: RecipientStatus.FAILED, ...base });
          if (countsAsFailure(verdict.kind)) recordFailure(verdict.message);
      }
    }
  });

  await campaignRepository.release(unsent);
  return outcome;
}

// ─── Safety net ───────────────────────────────────────────────────────────────

/** How late a scheduled start may be before the sweep starts it itself (EventBridge normally fires on time) */
const START_GRACE_MS = () => (isSchedulerConfigured() ? 2 * 60_000 : 0);
/** Extra quiet time on top of the interval before a running chain is considered lost */
const STALL_MS = 5 * 60_000;

/**
 * Runs every ~30 s in each app instance (safe concurrently):
 *  - starts scheduled campaigns whose time passed (scheduler not configured, or the schedule was lost)
 *  - re-enqueues the current tick of running campaigns whose chain went silent (queue message lost,
 *    enqueue failed after a tick, process killed). A duplicate is harmless: only one tick number is accepted.
 */
export async function sweepCampaigns(): Promise<{ started: number; revived: number }> {
  let started = 0;
  let revived = 0;
  const overdue = await campaignRepository.findOverdueScheduled(new Date(Date.now() - START_GRACE_MS()));
  for (const c of overdue) {
    await startCampaign(c.id);
    started++;
  }

  const stalled = await campaignRepository.findStalledRunning(new Date(Date.now() - STALL_MS));
  for (const c of stalled) {
    const lastActivity = (c.lastTickAt ?? c.startedAt ?? c.updatedAt).getTime();
    if (Date.now() - lastActivity < (c.intervalSeconds ?? 0) * 1000 + STALL_MS) continue;
    log.warn("Restarting a campaign whose sending loop went quiet", { campaignId: c.id, tickSeq: c.tickSeq });
    await enqueue({ type: "tick", campaignId: c.id, generation: c.runGeneration, seq: c.tickSeq });
    revived++;
  }
  return { started, revived };
}
