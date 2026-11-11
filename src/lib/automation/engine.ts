import { automationRepository, customerRepository, messageRepository, whatsappFlowRepository } from "../db/repositories";
import {
  AutomationRunStatus,
  WaFlowExecutionStatus,
  type Automation,
  type AutomationGraph,
  type AutomationGraphNode,
  type AutomationRun,
  type AutomationRunContext,
  type Channel,
  type Customer,
  sanitizeTemplateButtons,
} from "../db/schema";
import { whatsAppService } from "../services/channels/whatsapp.service";
import { whatsappFlowSendService } from "../services/whatsapp-flows/flow-send.service";
import { matchConsentKeyword, normalizeKeyword } from "../services/consent.service";
import { mapLimit, sleep } from "@/lib/concurrency";
import { keywordPattern, matchesKeywords, normalizeKeywords } from "./keywords";
import { EMAIL_RE } from "./variables";
import { formatFlowResponse } from "@/lib/whatsapp-flows/flow-response-format";
import { AppError, toAppError } from "@/lib/errors";
import { getObject } from "@/lib/storage/s3";
import { automationMediaOf, automationMediaPrefix } from "./media";
import { createLogger } from "@/lib/logger";

/**
 * Automation runtime for graphs built in the node-based Automation Builder.
 *
 * A run executes node by node until it finishes or reaches a node that must wait
 * (Wait for Flow Submission, Delay). Waiting is a database state, not a blocked request:
 * the run is stored as `waiting` and resumed by the event that satisfies it (Flow submission
 * webhook) or by `sweep()` (delays ending, waits timing out, retries). Resumption is claimed atomically,
 * so retried webhooks and concurrent sweeps can't run a step twice.
 *
 * Reliability without an external queue:
 *  - one unfinished run per (automation, customer) and one run per trigger are unique indexes, so
 *    concurrent webhooks can't start duplicates;
 *  - a `running` run holds a lease (`locked_until`); if the process dies, the sweep releases it;
 *  - transient failures (Meta throttling/5xx/timeouts, DB blips) park the run as `waiting` with a
 *    `retry` wait and backoff instead of failing it;
 *  - an inbound message keeps `automation_pending_since` until its triggers were evaluated, so a start
 *    lost in a restart is replayed by the sweep;
 *  - a run executes the graph version it started with, even if the automation is edited meanwhile.
 */

const log = createLogger("Automation");

const MAX_STEPS_PER_TICK = 50;
const MAX_LOG = 40;

/** Lease of a running run; renewed while a long pass is still executing. */
const LEASE_MS = 10 * 60_000;
/** Matching automations started in parallel per inbound message. */
const START_CONCURRENCY = 4;
/** Durable retries of a step that failed with a transient error: delay before attempt n+1. */
const RETRY_DELAYS_MS = [30_000, 2 * 60_000, 10 * 60_000, 30 * 60_000, 60 * 60_000];
/** One quick in-process retry for a transient Meta error before falling back to a durable retry. */
const QUICK_RETRY_MS = 1_500;
/** Active automations per organization are cached this long (invalidated on every change in this process). */
const ACTIVE_CACHE_TTL_MS = 30_000;
const SWEEP_BATCH = 50;
const SWEEP_CONCURRENCY = 5;
const SWEEP_BUDGET_MS = 25_000;
/** A Flow execution still `pending` after this long was interrupted mid-send. */
const STALE_PENDING_EXECUTION_MS = 10 * 60_000;
/** Inbound messages whose automation evaluation is still pending after this long are replayed… */
const REPLAY_AFTER_MS = 2 * 60_000;
/** …unless the message is older than this (starting an automation that late would surprise the customer). */
const REPLAY_MAX_AGE_MS = 60 * 60_000;

export const SEND_FLOW_NODE = "action_send_whatsapp_flow";
export const WAIT_FLOW_NODE = "flow_wait_flow_submission";
/** How long Wait for Flow Submission waits when the Flow send has no response window. */
const DEFAULT_FLOW_WAIT_MS = 24 * 60 * 60_000;

type StepResult =
  | { kind: "next"; handle?: string } // follow the outgoing edge (optionally a specific handle)
  | { kind: "stop"; outcome: string } // finish the run successfully
  | { kind: "wait"; run: Partial<AutomationRun> }; // persist the wait and return

/** Where `advance` continues: after a node that already ran, or at a node to (re-)execute. */
type Start = { after: string; handle?: string } | { at: string; attempt: number };

interface Exec {
  run: AutomationRun;
  automation: Automation;
  graph: AutomationGraph;
  customer: Customer;
  /** The org's live WhatsApp channels, loaded once per pass on the first send. */
  connections?: Channel[];
}

const leaseUntil = () => new Date(Date.now() + LEASE_MS);

// ─── Template rendering: {{contact.name}}, {{flow.full_name}}, {{message.text}} ────────────

function render(text: string, x: Exec): string {
  return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path: string) => {
    const [scope, ...rest] = path.split(".");
    const key = rest.join(".");
    let value: unknown;
    if (scope === "contact") value = (x.customer as unknown as Record<string, unknown>)[key];
    // Readable answers (option titles, Yes/No, formatted dates): raw option ids mean nothing to a customer
    else if (scope === "flow") value = x.run.context.flowDisplay?.[key] ?? x.run.context.flow?.[key];
    else if (scope === "message" && key === "text") value = x.run.context.trigger.text;
    if (Array.isArray(value)) return value.join(", ");
    return value === undefined || value === null ? "" : String(value);
  });
}

/** Raw value(s) a condition checks: lists for tags and multi-choice answers, one string otherwise. */
function attributeValue(attribute: string, x: Exec): string | string[] {
  if (attribute === "message") return x.run.context.trigger.text ?? "";
  if (attribute === "tag") return x.customer.tags ?? [];
  const v = attribute.startsWith("flow.")
    ? x.run.context.flow?.[attribute.slice(5)]
    : (x.customer as unknown as Record<string, unknown>)[attribute];
  if (Array.isArray(v)) return v.map(String);
  return v === undefined || v === null ? "" : String(v);
}

function compare(actual: string | string[], operator: string, expected: string): boolean {
  const e = expected.trim().toLowerCase();
  if (Array.isArray(actual)) {
    const items = actual.map((a) => a.trim().toLowerCase());
    switch (operator) {
      case "has": return items.includes(e);
      case "not_has": return !items.includes(e);
      case "is_empty": return items.length === 0;
      case "is_not_empty": return items.length > 0;
      default: return compare(items.join(","), operator, expected); // older steps (e.g. Tag contains)
    }
  }
  const a = actual.toLowerCase();
  switch (operator) {
    case "equals": case "has": return a === e;
    case "not_equals": case "not_has": return a !== e;
    case "contains": return a.includes(e);
    case "starts_with": return a.startsWith(e);
    case "is_empty": return a.trim() === "";
    case "is_not_empty": return a.trim() !== "";
    default: return false;
  }
}

/** Meta rejects template parameters with line breaks, tabs or long runs of spaces. */
const templateParam = (value: string) => value.replace(/\s+/g, " ").trim();

// ─── Active automations per organization (cached, triggers precompiled) ─────────────────────

interface CompiledAutomation {
  automation: Automation;
  /**
   * Trigger nodes in graph order; keyword triggers carry their compiled patterns and their keywords
   * normalized like consent keywords (to recognize triggers built on purpose for STOP / START).
   */
  triggers: { node: AutomationGraphNode; patterns: RegExp[] | null; consentForms: string[] }[];
}

function compile(automation: Automation): CompiledAutomation {
  const triggers: CompiledAutomation["triggers"] = [];
  for (const n of automation.graph?.nodes ?? []) {
    if (n.data?.type === "trigger_incoming_message") triggers.push({ node: n, patterns: null, consentForms: [] });
    else if (n.data?.type === "trigger_keyword") {
      const keywords = normalizeKeywords(n.data.keywords);
      const patterns = keywords.map(keywordPattern);
      if (patterns.length) triggers.push({ node: n, patterns, consentForms: keywords.map(normalizeKeyword) });
    }
  }
  return { automation, triggers };
}

/**
 * The trigger of this automation that an inbound message fires, if any. A consent keyword (STOP, START,
 * UNSUBSCRIBE…) fires only a Keyword trigger that lists that exact keyword — never "Incoming message"
 * or a keyword that merely appears in it — so opting in or out doesn't start unrelated automations.
 */
function matchTrigger(c: CompiledAutomation, text: string | null, consentKeyword: string | null): AutomationGraphNode | null {
  if (consentKeyword) return c.triggers.find((t) => t.consentForms.includes(consentKeyword))?.node ?? null;
  for (const t of c.triggers) {
    if (!t.patterns) return t.node;
    if (text && t.patterns.some((p) => p.test(text))) return t.node;
  }
  return null;
}

type CacheEntry = { at: number; list: Promise<CompiledAutomation[]> };
const g = globalThis as unknown as { __activeAutomations?: Map<number, CacheEntry>; __graphVersions?: Map<string, AutomationGraph> };
const activeCache = (g.__activeAutomations ??= new Map());
/** Graph versions are immutable: safe to cache without invalidation. */
const graphVersionCache = (g.__graphVersions ??= new Map());

/** Drops the cached active automations of an organization (call after any automation change). */
export function invalidateActiveAutomations(organizationId: number) {
  activeCache.delete(organizationId);
}

// ─── Engine ─────────────────────────────────────────────────────────────────

export class AutomationEngine {
  /** Active automations of the org with compiled triggers. Concurrent callers share one query. */
  private activeFor(organizationId: number): Promise<CompiledAutomation[]> {
    const hit = activeCache.get(organizationId);
    if (hit && Date.now() - hit.at < ACTIVE_CACHE_TTL_MS) return hit.list;
    const list = automationRepository.listActive(organizationId).then((rows) => rows.map(compile));
    const entry = { at: Date.now(), list };
    activeCache.set(organizationId, entry);
    list.catch(() => {
      if (activeCache.get(organizationId) === entry) activeCache.delete(organizationId);
    });
    return list;
  }

  /** True when the organization has at least one active automation with a message trigger. */
  async hasMessageTriggers(organizationId: number): Promise<boolean> {
    return (await this.activeFor(organizationId)).some((c) => c.triggers.length > 0);
  }

  /**
   * Starts every active automation whose trigger matches an inbound message, up to START_CONCURRENCY
   * at once. Idempotent per (automation, wamid); a customer with an unfinished run of the same automation
   * isn't started again (avoids sending the same Flow twice while one is pending) — both enforced by
   * unique indexes. When `pending` is set, the message's pending marker is cleared once every start
   * was decided, so the sweep replays it only if this evaluation was lost or hit a database error.
   * Never throws.
   */
  async handleInboundMessage(params: {
    organizationId: number;
    channelId: number | null;
    customerId: number;
    messageId: number | null;
    wamid: string;
    text: string | null;
    pending?: boolean;
    /** Normalized consent keyword the message holds (STOP, START…), when the caller already matched it */
    consentKeyword?: string | null;
  }): Promise<boolean> {
    let settled = false;
    try {
      // Replayed messages carry only their text: recognize consent keywords from it as well
      const consentKeyword = params.consentKeyword ?? (params.text ? matchConsentKeyword([params.text])?.keyword ?? null : null);
      const active = await this.activeFor(params.organizationId);
      const matched = active
        .map((c) => ({ automation: c.automation, trigger: matchTrigger(c, params.text, consentKeyword) }))
        .filter((m): m is { automation: Automation; trigger: AutomationGraphNode } => !!m.trigger);

      const results = await mapLimit(matched, START_CONCURRENCY, (m) => this.start(m.automation, m.trigger, params));
      settled = results.every((r) => r.status === "fulfilled");
      results.forEach((r, i) => {
        if (r.status === "rejected") {
          log.error("Automation failed to start", { err: r.reason, automationId: matched[i].automation.id, customerId: params.customerId });
        }
      });
    } catch (err) {
      log.error("Automation triggers could not be evaluated", { err, customerId: params.customerId, wamid: params.wamid });
    }
    if (settled && params.pending && params.messageId) {
      await messageRepository.clearAutomationPending(params.messageId).catch((err) =>
        log.warn("Could not clear the automation marker of a message", { err, messageId: params.messageId })
      );
    }
    return settled;
  }

  /** Creates the run (refused by Postgres when it would be a duplicate) and executes it. Throws only on a failed insert. */
  private async start(
    automation: Automation,
    trigger: AutomationGraphNode,
    params: { organizationId: number; channelId: number | null; customerId: number; messageId: number | null; wamid: string; text: string | null }
  ) {
    const run = await automationRepository.createRun({
      organizationId: params.organizationId,
      automationId: automation.id,
      customerId: params.customerId,
      channelId: params.channelId,
      triggerKey: `msg:${params.wamid}`,
      status: AutomationRunStatus.RUNNING,
      currentNodeId: trigger.id,
      lockedUntil: leaseUntil(),
      graphVersion: automation.graphVersion,
      context: {
        trigger: { type: String(trigger.data.type), messageId: params.messageId, wamid: params.wamid, text: params.text },
        log: [],
      },
    });
    if (!run) {
      // This message already started a run (webhook retry / replay), or the customer has an unfinished one
      log.debug("Automation not started: duplicate trigger or open run", { automationId: automation.id, customerId: params.customerId });
      return;
    }
    log.info("Automation run started", { runId: run.id, automationId: automation.id, customerId: params.customerId });
    await this.advance(run, automation, { after: trigger.id });
  }

  /** Resumes the run waiting on this Flow execution (if any). Returns the run id when one was resumed. */
  async resumeOnFlowSubmission(executionId: number, runId: number | null, response: Record<string, unknown>): Promise<number | null> {
    if (!runId) return null;
    const claimed = await automationRepository.claimWaitingRun(runId, { kind: "flow_submission", executionId }, leaseUntil());
    if (!claimed) {
      // Not waiting yet (e.g. still before the Wait node) — the Wait node will find the stored submission
      log.debug("No run waiting for this Flow submission", { runId, executionId });
      return null;
    }
    const automation = await automationRepository.find(claimed.automationId, claimed.organizationId);
    if (!automation) return null;
    const waitNodeId = claimed.waitingFor?.nodeId ?? claimed.currentNodeId!;
    claimed.context = { ...claimed.context, ...(await this.flowAnswers(executionId, claimed.organizationId, response)) };
    claimed.waitingFor = null;
    await this.advance(claimed, automation, { after: waitNodeId });
    return claimed.id;
  }

  /**
   * Periodic work (in-process scheduler and/or cron): release runs whose lease expired, expire
   * unanswered or interrupted Flow executions, then resume due runs (delays ending, retries) and time
   * out Flow waits — claimed in batches with SKIP LOCKED and processed SWEEP_CONCURRENCY at a time
   * until nothing is due or the time budget is spent. Safe to run concurrently and on several instances.
   */
  async sweep(now = new Date()) {
    const [expired, interrupted, released] = await Promise.all([
      whatsappFlowRepository.expireOverdueExecutions(now),
      whatsappFlowRepository.failStalePendingExecutions(new Date(now.getTime() - STALE_PENDING_EXECUTION_MS)),
      automationRepository.failExpiredLeases(now),
    ]);
    if (released) log.warn("Released automation runs whose lease expired (interrupted mid-run)", { count: released });

    const tally = { resumed: 0, retried: 0, timedOut: 0, failed: 0 };
    const deadline = Date.now() + SWEEP_BUDGET_MS;
    while (Date.now() < deadline) {
      const batch = await automationRepository.claimDueRuns(new Date(), leaseUntil(), SWEEP_BATCH);
      if (!batch.length) break;
      const results = await mapLimit(batch, SWEEP_CONCURRENCY, (run) => this.resumeDue(run));
      results.forEach((r, i) => {
        if (r.status === "fulfilled") tally[r.value]++;
        else {
          tally.failed++;
          log.error("Sweep failed to process run", { err: r.reason, runId: batch[i].id });
        }
      });
      if (batch.length < SWEEP_BATCH) break;
    }

    return {
      expiredExecutions: expired.length,
      interruptedExecutions: interrupted,
      releasedRuns: released,
      resumedRuns: tally.resumed,
      retriedRuns: tally.retried,
      timedOutRuns: tally.timedOut,
      failedRuns: tally.failed,
    };
  }

  /**
   * Replays automation triggers of inbound messages whose evaluation was lost (process stopped before
   * the deferred work ran, or the database failed). Run starts are idempotent per wamid, so a replay
   * never starts a second run for an automation that did start.
   */
  async replayPendingMessages(now = new Date()): Promise<number> {
    await messageRepository.dropStaleAutomationPending(new Date(now.getTime() - REPLAY_MAX_AGE_MS));
    const pending = await messageRepository.claimPendingAutomationMessages(new Date(now.getTime() - REPLAY_AFTER_MS));
    await mapLimit(pending, START_CONCURRENCY, async (m) => {
      if (!m.metaMessageId) return messageRepository.clearAutomationPending(m.id);
      await this.handleInboundMessage({
        organizationId: m.organizationId,
        channelId: m.channelId,
        customerId: m.customerId,
        messageId: m.id,
        wamid: m.metaMessageId,
        text: m.mediaType === "text" ? m.textContent : null,
        pending: true,
      });
    });
    if (pending.length) log.info("Replayed automation triggers of inbound messages", { count: pending.length });
    return pending.length;
  }

  /** A claimed due run: time out a Flow wait, or continue after a delay / retry the failed step. */
  private async resumeDue(run: AutomationRun): Promise<"resumed" | "retried" | "timedOut" | "failed"> {
    const wait = run.waitingFor;
    const now = new Date();
    if (!wait || wait.kind === "flow_submission") {
      await automationRepository.updateRunningRun(run.id, {
        status: wait ? AutomationRunStatus.TIMED_OUT : AutomationRunStatus.FAILED,
        waitingFor: null,
        wakeAt: null,
        lockedUntil: null,
        lastError: wait ? "No Flow response before the wait timed out." : "The run was due but had nothing to resume.",
        completedAt: now,
      });
      return wait ? "timedOut" : "failed";
    }
    const automation = await automationRepository.find(run.automationId, run.organizationId);
    if (!automation) {
      await automationRepository.updateRunningRun(run.id, {
        status: AutomationRunStatus.CANCELLED,
        waitingFor: null,
        lockedUntil: null,
        lastError: "Automation no longer exists.",
        completedAt: now,
      });
      return "failed";
    }
    run.waitingFor = null;
    if (wait.kind === "delay") {
      await this.advance(run, automation, { after: wait.nodeId });
      return "resumed";
    }
    await this.advance(run, automation, { at: wait.nodeId, attempt: wait.attempt });
    return "retried";
  }

  // ── Execution loop ────────────────────────────────────────────────────

  /** The graph this run executes: the version it started on (falls back to the current graph). */
  private async graphOf(run: AutomationRun, automation: Automation): Promise<AutomationGraph> {
    if (!run.graphVersion || run.graphVersion === automation.graphVersion) return automation.graph;
    const key = `${automation.id}:${run.graphVersion}`;
    const cached = graphVersionCache.get(key);
    if (cached) return cached;
    const graph = await automationRepository.findGraphVersion(automation.id, run.graphVersion);
    if (!graph) return automation.graph;
    if (graphVersionCache.size > 500) graphVersionCache.clear();
    graphVersionCache.set(key, graph);
    return graph;
  }

  /**
   * Executes from `start` until the run finishes or waits. Every write is conditional on the run still
   * being `running` (it may have been cancelled or released meanwhile). Transient failures schedule a
   * durable retry of the failing step; anything else fails the run. Never throws.
   */
  private async advance(run: AutomationRun, automation: Automation, start: Start) {
    let nodeId: string | null = "at" in start ? start.at : null;
    let attempt = "at" in start ? start.attempt : 0;
    let steps = 0;
    let x: Exec | null = null;
    let renewAt = Date.now() + LEASE_MS / 2;

    try {
      const graph = await this.graphOf(run, automation);
      if ("after" in start) nodeId = this.nextNodeId(graph, start.after, start.handle);
      const customer = await customerRepository.findById(run.customerId, run.organizationId);
      if (!customer) {
        await automationRepository.updateRunningRun(run.id, {
          status: AutomationRunStatus.CANCELLED,
          waitingFor: null,
          lockedUntil: null,
          lastError: "Contact no longer exists.",
          completedAt: new Date(),
        });
        return;
      }
      x = { run, automation, graph, customer };

      while (nodeId) {
        if (++steps > MAX_STEPS_PER_TICK) throw new Error("Too many steps in one pass — check the automation for loops.");
        if (Date.now() > renewAt) {
          await automationRepository.renewLease(run.id, leaseUntil());
          renewAt = Date.now() + LEASE_MS / 2;
        }
        const node = graph.nodes.find((n) => n.id === nodeId);
        if (!node) throw new Error(`Node ${nodeId} not found in the automation.`);

        const result = await this.execute(node, x);
        attempt = 0; // a later step that fails starts its own retry count
        this.record(x, node, result.kind === "stop" ? result.outcome : result.kind === "wait" ? "waiting" : "done");

        if (result.kind === "wait") {
          await automationRepository.updateRunningRun(run.id, {
            ...result.run,
            status: AutomationRunStatus.WAITING,
            currentNodeId: node.id,
            context: x.run.context,
            stepCount: run.stepCount + steps,
            lockedUntil: null,
            lastError: null,
          });
          return;
        }
        if (result.kind === "stop") {
          nodeId = null;
          break;
        }
        nodeId = this.nextNodeId(graph, node.id, result.handle);
      }
      await automationRepository.updateRunningRun(run.id, {
        status: AutomationRunStatus.COMPLETED,
        currentNodeId: null,
        waitingFor: null,
        wakeAt: null,
        lockedUntil: null,
        lastError: null,
        context: x.run.context,
        stepCount: run.stepCount + steps,
        completedAt: new Date(),
      });
      log.info("Automation run completed", { runId: run.id, automationId: automation.id });
    } catch (err) {
      await this.handleFailure(run, x?.run.context ?? run.context, run.stepCount + steps, nodeId, attempt, err);
    }
  }

  /** Transient error → durable retry of the failing step with backoff; otherwise the run fails. */
  private async handleFailure(
    run: AutomationRun,
    context: AutomationRunContext,
    stepCount: number,
    nodeId: string | null,
    attempt: number,
    err: unknown
  ) {
    const appErr = toAppError(err);
    try {
      if (nodeId && appErr.retryable && attempt < RETRY_DELAYS_MS.length) {
        const delay = RETRY_DELAYS_MS[attempt];
        const applied = await automationRepository.updateRunningRun(run.id, {
          status: AutomationRunStatus.WAITING,
          currentNodeId: nodeId,
          waitingFor: { kind: "retry", nodeId, attempt: attempt + 1 },
          wakeAt: new Date(Date.now() + delay),
          lockedUntil: null,
          context,
          stepCount,
          lastError: `Retry ${attempt + 1}/${RETRY_DELAYS_MS.length} scheduled: ${appErr.message}`,
        });
        if (applied) log.warn("Automation step failed with a transient error — retry scheduled", { err: appErr, runId: run.id, nodeId, attempt: attempt + 1, delayMs: delay });
        return;
      }
      await automationRepository.updateRunningRun(run.id, {
        status: AutomationRunStatus.FAILED,
        currentNodeId: nodeId,
        waitingFor: null,
        wakeAt: null,
        lockedUntil: null,
        context,
        stepCount,
        lastError: appErr.message,
        completedAt: new Date(),
      });
      log.warn("Automation run failed", { err: appErr, runId: run.id, nodeId });
    } catch (writeErr) {
      // The lease reaper releases the run if even this write failed
      log.error("Could not record automation run failure", { err: writeErr, cause: appErr, runId: run.id, nodeId });
    }
  }

  private nextNodeId(graph: AutomationGraph, fromNodeId: string, handle?: string): string | null {
    const edges = graph.edges.filter((e) => e.source === fromNodeId);
    const edge = handle ? edges.find((e) => e.sourceHandle === handle) : edges[0];
    return edge?.target ?? null;
  }

  private record(x: Exec, node: AutomationGraphNode, outcome: string) {
    const entry = { at: new Date().toISOString(), nodeId: node.id, type: String(node.data.type), outcome };
    const logEntries = [...(x.run.context.log ?? []), entry];
    x.run.context = { ...x.run.context, log: logEntries.slice(-MAX_LOG) } as AutomationRunContext;
  }

  /** Rows every send in this pass reuses instead of re-reading them. */
  private async preloaded(x: Exec) {
    x.connections ??= await whatsAppService.getConnections(x.run.organizationId);
    return { contact: x.customer, connections: x.connections };
  }

  /** Retries a Meta call once after a short pause when the error is transient (throttling, 5xx, timeout). */
  private async quickRetry<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (!toAppError(err).retryable) throw err;
      await sleep(QUICK_RETRY_MS + Math.floor(Math.random() * 500));
      return fn();
    }
  }

  /** Run context for a Flow submission: raw answers (conditions) and readable ones (message variables). */
  private async flowAnswers(executionId: number, organizationId: number, response: Record<string, unknown>) {
    const execution = await whatsappFlowRepository.findExecution(executionId, organizationId);
    const version = execution ? await whatsappFlowRepository.findVersion(execution.flowVersionId, organizationId) : null;
    const flowDisplay = Object.fromEntries(
      formatFlowResponse(response, version?.definition).map((a) => [a.key, a.value === "—" ? "" : a.value])
    );
    return { flow: response, flowDisplay };
  }

  private async execute(node: AutomationGraphNode, x: Exec): Promise<StepResult> {
    const d = node.data;
    // An opted-out contact receives nothing until they reply START: end the run quietly instead of failing at the send
    if (x.customer.isOptedOut && (d.type === "action_send_message" || d.type === "action_send_template" || d.type === SEND_FLOW_NODE)) {
      return { kind: "stop", outcome: "contact opted out" };
    }
    switch (d.type) {
      case "trigger_incoming_message":
      case "trigger_keyword":
      case "trigger_conversation_event":
        return { kind: "next" }; // runs start after their trigger; nothing to evaluate

      case "condition_if_else": {
        const ok = compare(attributeValue(String(d.attribute ?? ""), x), String(d.operator ?? ""), String(d.value ?? ""));
        return { kind: "next", handle: ok ? "true" : "false" };
      }
      case "condition_contact_attribute": {
        const ok = compare(attributeValue(String(d.attribute ?? ""), x), String(d.operator ?? ""), String(d.value ?? ""));
        return ok ? { kind: "next" } : { kind: "stop", outcome: "condition not met" };
      }
      case "condition_keyword_match":
        return matchesKeywords(x.run.context.trigger.text, d.keywords) ? { kind: "next" } : { kind: "stop", outcome: "no keyword match" };

      case "action_send_message": {
        const text = render(String(d.messageContent ?? ""), x).trim();
        const media = automationMediaOf(d);
        if (!text && !media) throw new Error("Send Message has no content.");
        const preloaded = await this.preloaded(x);
        const base = {
          organizationId: x.run.organizationId,
          customerId: x.customer.id,
          to: x.customer.phone ?? "",
          metadata: { automation: { automationId: x.automation.id, runId: x.run.id, nodeId: node.id } },
          preloaded,
        };
        if (!media) {
          await this.quickRetry(() => whatsAppService.sendMessage({ ...base, text }));
          return { kind: "next" };
        }
        // Only this organization's files: the key comes from the saved graph
        if (!media.key.startsWith(automationMediaPrefix(x.run.organizationId))) {
          throw new AppError("MEDIA_NOT_FOUND", { message: "The attached file isn't available. Attach it again.", expected: true });
        }
        // Read from S3 on every run and upload to Meta like an inbox attachment; the message stores Meta's media id
        const file = await this.quickRetry(() => getObject(media.key));
        // WhatsApp drops captions on audio, so the text follows as its own message
        const caption = media.kind === "audio" ? undefined : text || undefined;
        await this.quickRetry(() =>
          whatsAppService.sendMessage({ ...base, text: caption, mediaFile: file, mimeType: media.mimeType, filename: media.filename })
        );
        if (media.kind === "audio" && text) await this.quickRetry(() => whatsAppService.sendMessage({ ...base, text }));
        return { kind: "next" };
      }

      case "action_send_template": {
        const preloaded = await this.preloaded(x);
        const metadata = { automation: { automationId: x.automation.id, runId: x.run.id, nodeId: node.id } };
        if (d.templateName) {
          // Components were built when the step was configured; only their text parameters hold variables
          const components = (Array.isArray(d.templateComponents) ? (d.templateComponents as Record<string, unknown>[]) : []).map((c) => ({
            ...c,
            parameters: (Array.isArray(c.parameters) ? (c.parameters as Record<string, unknown>[]) : []).map((p) => {
              if (p.type !== "text" && p.type !== "coupon_code") return p;
              const field = p.type === "text" ? "text" : "coupon_code";
              const value = templateParam(render(String(p[field] ?? ""), x));
              if (!value) throw new Error(`A variable of template "${d.templateName}" is empty for this contact, so WhatsApp would reject it.`);
              return { ...p, [field]: value };
            }),
          }));
          await this.quickRetry(() =>
            whatsAppService.sendMessage({
              organizationId: x.run.organizationId,
              customerId: x.customer.id,
              to: x.customer.phone ?? "",
              type: "template",
              templateName: String(d.templateName),
              languageCode: String(d.templateLanguage || "en_US"),
              components,
              text: d.templatePreview ? render(String(d.templatePreview), x) : undefined,
              templateButtons: sanitizeTemplateButtons(d.templateButtons),
              metadata,
              preloaded,
            })
          );
          return { kind: "next" };
        }
        // Older steps: a template record id or a typed name, without variables
        const ref = String(d.templateId ?? "").trim();
        if (!ref) throw new Error("Send Template has no template.");
        const record = /^\d+$/.test(ref) ? await whatsappFlowRepository.findTemplate(Number(ref), x.run.organizationId) : null;
        await this.quickRetry(() =>
          whatsAppService.sendMessage({
            organizationId: x.run.organizationId,
            customerId: x.customer.id,
            to: x.customer.phone ?? "",
            type: "template",
            templateName: record?.name ?? ref,
            languageCode: record?.language ?? "en_US",
            metadata,
            preloaded,
          })
        );
        return { kind: "next" };
      }

      case "action_update_contact": {
        const field = String(d.updateField ?? "");
        const value = render(String(d.updateValue ?? ""), x).trim();
        if (!value) return { kind: "next" }; // e.g. a variable that's empty for this contact: keep what's there
        const tags = x.customer.tags ?? [];
        let patch: Parameters<typeof customerRepository.updateCustomer>[2] | null = null;
        if (field === "name" || field === "language") patch = { [field]: value };
        else if (field === "email") patch = EMAIL_RE.test(value) ? { email: value } : null;
        else if (field === "tag") patch = tags.some((t) => t.toLowerCase() === value.toLowerCase()) ? null : { tags: [...tags, value] };
        else if (field === "remove_tag") {
          const kept = tags.filter((t) => t.toLowerCase() !== value.toLowerCase());
          patch = kept.length === tags.length ? null : { tags: kept };
        }
        if (patch) {
          const updated = await customerRepository.updateCustomer(x.customer.id, x.run.organizationId, patch);
          if (updated) x.customer = updated;
        }
        return { kind: "next" };
      }

      case "action_assign_conversation":
        // Builder options are placeholders (no team/agent mapping yet): recorded, no side effect
        return { kind: "next" };

      case SEND_FLOW_NODE: {
        const connections = (await this.preloaded(x)).connections;
        const execution = await this.quickRetry(() =>
          whatsappFlowSendService.send({
            organizationId: x.run.organizationId,
            customerId: x.customer.id,
            flowId: Number(d.flowId),
            method: d.sendMethod === "interactive" ? "interactive" : "template",
            templateId: d.templateId ? Number(d.templateId) : null,
            cta: d.flowCta ? String(d.flowCta) : undefined,
            bodyText: d.flowBody ? render(String(d.flowBody), x) : undefined,
            expiresInHours: Number(d.expiresInHours) || undefined,
            automationRunId: x.run.id,
            automationNodeId: node.id,
            preloaded: { customer: x.customer, connections },
          })
        );
        x.run.context = { ...x.run.context, lastFlowExecutionId: execution.id };
        return { kind: "next" };
      }

      case WAIT_FLOW_NODE: {
        const executionId = x.run.context.lastFlowExecutionId;
        if (!executionId) throw new Error("Wait for Flow Submission needs a Send WhatsApp Flow step before it.");
        // The customer may have answered before the run reached this step
        const existing = await whatsappFlowRepository.findSubmissionByExecution(executionId);
        if (existing) {
          x.run.context = { ...x.run.context, ...(await this.flowAnswers(executionId, x.run.organizationId, existing.response)) };
          return { kind: "next" };
        }
        const execution = await whatsappFlowRepository.findExecution(executionId, x.run.organizationId);
        if (execution?.status === WaFlowExecutionStatus.FAILED) throw new Error("The Flow could not be sent.");
        // Waits exactly as long as the customer can answer (the Send WhatsApp Flow response window)
        const wakeAt = execution?.expiresAt ?? new Date(Date.now() + DEFAULT_FLOW_WAIT_MS);
        return { kind: "wait", run: { waitingFor: { kind: "flow_submission", executionId, nodeId: node.id }, wakeAt } };
      }

      case "flow_end":
        return { kind: "stop", outcome: "end" };

      default:
        throw new Error(`Unsupported node type "${d.type}".`);
    }
  }
}

export const automationEngine = new AutomationEngine();
