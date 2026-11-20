import { createLogger } from "@/lib/logger";
import { isQueueConfigured, setLocalQueueHandler } from "./aws";
import { handleCampaignMessage, sweepCampaigns } from "./engine";

/**
 * Campaign runtime in the app, started once per process from instrumentation.ts (CAMPAIGN_WORKER=off disables it).
 *
 *  - With SQS (CAMPAIGN_QUEUE_URL set): the app does NOT poll the queue. The campaign Lambda receives each SQS
 *    message and calls POST /api/campaigns/worker, which runs the start/tick here and queues the next tick.
 *  - Without SQS (local development): queue messages run in-process via setTimeout.
 *  - Always: a sweep every 30 s starts overdue scheduled campaigns and revives running ones that went quiet.
 */

const log = createLogger("CampaignWorker");
const SWEEP_INTERVAL_MS = 30_000;

const state = ((globalThis as any).__campaignWorker ??= { started: false }) as { started: boolean };

export function startCampaignWorker() {
  if (state.started) return;
  state.started = true;

  setLocalQueueHandler(handleCampaignMessage);

  const sweepTimer = setInterval(() => {
    sweepCampaigns()
      .then((r) => (r.started || r.revived) && log.info("Campaign sweep", r))
      .catch((err) => log.error("Campaign sweep failed", { err }));
  }, SWEEP_INTERVAL_MS);
  sweepTimer.unref?.();

  log.info(
    isQueueConfigured()
      ? "Campaign runtime started (SQS → Lambda → /api/campaigns/worker)"
      : "Campaign runtime started (in-process queue; set CAMPAIGN_QUEUE_URL to use SQS)"
  );
}
