import { automationRepository } from "../db/repositories";
import { automationEngine } from "./engine";
import { whatsappFlowSubmissionService } from "../services/whatsapp-flows/flow-submission.service";
import { createLogger } from "@/lib/logger";

/**
 * Automation maintenance without an external scheduler or queue.
 *
 * `runAutomationMaintenance` does every periodic job (resume delays and retries, time out Flow waits,
 * release interrupted runs, replay lost automation starts, re-process stored Flow responses, prune old
 * runs). The in-process scheduler calls it every few seconds; `/api/automations/sweep` can still call it
 * from a cron. All of it is safe to run concurrently and on several instances (atomic claims, SKIP LOCKED).
 */

const log = createLogger("AutomationScheduler");

const INTERVAL_MS = Math.max(2_000, Number(process.env.AUTOMATION_SWEEP_INTERVAL_MS) || 10_000);
const RETENTION_DAYS = Math.max(1, Number(process.env.AUTOMATION_RUN_RETENTION_DAYS) || 90);
const PRUNE_EVERY_MS = 60 * 60_000;
const PRUNE_MAX_BATCHES = 20;

const state = ((globalThis as any).__automationScheduler ??= {
  timer: null as ReturnType<typeof setInterval> | null,
  running: false,
  lastPruneAt: 0,
  lastSuccessAt: 0,
}) as { timer: ReturnType<typeof setInterval> | null; running: boolean; lastPruneAt: number; lastSuccessAt: number };

/** Deletes finished runs older than the retention period, in batches (at most once an hour per process). */
async function pruneOldRuns(): Promise<number> {
  if (Date.now() - state.lastPruneAt < PRUNE_EVERY_MS) return 0;
  state.lastPruneAt = Date.now();
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60_000);
  let total = 0;
  for (let i = 0; i < PRUNE_MAX_BATCHES; i++) {
    const n = await automationRepository.deleteFinishedRunsBefore(cutoff);
    total += n;
    if (n === 0) break;
  }
  if (total) log.info("Pruned finished automation runs", { count: total, retentionDays: RETENTION_DAYS });
  return total;
}

/**
 * One maintenance pass. A pass already running in this process is not started twice (returns
 * `skipped`); other processes/instances may run theirs at the same time.
 */
export async function runAutomationMaintenance() {
  if (state.running) return { skipped: true as const };
  state.running = true;
  try {
    const reprocessedSubmissions = await whatsappFlowSubmissionService.processStale();
    const sweep = await automationEngine.sweep();
    const replayedMessages = await automationEngine.replayPendingMessages();
    const prunedRuns = await pruneOldRuns();
    state.lastSuccessAt = Date.now();
    return { skipped: false as const, ...sweep, reprocessedSubmissions, replayedMessages, prunedRuns };
  } finally {
    state.running = false;
  }
}

/** Time of the last completed maintenance pass in this process (0 = none yet), for health checks. */
export function lastMaintenanceAt(): number {
  return state.lastSuccessAt;
}

/** Starts the in-process scheduler once per process (called from instrumentation `register`). */
export function startAutomationScheduler() {
  if (state.timer) return;
  const tick = () => {
    runAutomationMaintenance()
      .then((r) => {
        if (!r.skipped && (r.resumedRuns || r.retriedRuns || r.timedOutRuns || r.releasedRuns || r.replayedMessages || r.reprocessedSubmissions)) {
          log.info("Automation maintenance pass", r);
        }
      })
      .catch((err) => log.error("Automation maintenance pass failed", { err }));
  };
  state.timer = setInterval(tick, INTERVAL_MS);
  state.timer.unref?.();
  log.info("Automation scheduler started", { intervalMs: INTERVAL_MS, retentionDays: RETENTION_DAYS });
}
