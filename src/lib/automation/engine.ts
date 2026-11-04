import { automationRepository, customerRepository, whatsappFlowRepository } from "../db/repositories";
import {
  AutomationRunStatus,
  WaFlowExecutionStatus,
  type Automation,
  type AutomationGraphNode,
  type AutomationRun,
  type AutomationRunContext,
  type Customer,
} from "../db/schema";
import { whatsAppService } from "../services/channels/whatsapp.service";
import { whatsappFlowSendService } from "../services/whatsapp-flows/flow-send.service";
import { toAppError } from "@/lib/errors";
import { createLogger } from "@/lib/logger";

/**
 * Automation runtime for graphs built in the node-based Automation Builder.
 *
 * A run executes node by node until it finishes or reaches a node that must wait
 * (Wait for Flow Submission, Delay). Waiting is a database state, not a blocked request:
 * the run is stored as `waiting` and resumed by the event that satisfies it (Flow submission
 * webhook) or by `sweep()` (delays ending, waits timing out). Resumption is claimed atomically,
 * so retried webhooks and concurrent sweeps can't run a step twice.
 */

const log = createLogger("Automation");

const MAX_STEPS_PER_TICK = 50;
const MAX_LOG = 40;
const DEFAULT_FLOW_WAIT_HOURS = 24;

export const SEND_FLOW_NODE = "action_send_whatsapp_flow";
export const WAIT_FLOW_NODE = "flow_wait_flow_submission";

type StepResult =
  | { kind: "next"; handle?: string } // follow the outgoing edge (optionally a specific handle)
  | { kind: "stop"; outcome: string } // finish the run successfully
  | { kind: "wait"; run: Partial<AutomationRun> }; // persist the wait and return

interface Exec {
  run: AutomationRun;
  automation: Automation;
  customer: Customer;
}

// ─── Template rendering: {{contact.name}}, {{flow.full_name}}, {{message.text}} ────────────

function render(text: string, x: Exec): string {
  return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path: string) => {
    const [scope, ...rest] = path.split(".");
    const key = rest.join(".");
    let value: unknown;
    if (scope === "contact") value = (x.customer as unknown as Record<string, unknown>)[key];
    else if (scope === "flow") value = x.run.context.flow?.[key];
    else if (scope === "message" && key === "text") value = x.run.context.trigger.text;
    if (Array.isArray(value)) return value.join(", ");
    return value === undefined || value === null ? "" : String(value);
  });
}

function attributeValue(attribute: string, x: Exec): string {
  if (attribute === "message") return x.run.context.trigger.text ?? "";
  if (attribute === "tag") return (x.customer.tags ?? []).join(",");
  if (attribute.startsWith("flow.")) {
    const v = x.run.context.flow?.[attribute.slice(5)];
    return Array.isArray(v) ? v.join(",") : v === undefined || v === null ? "" : String(v);
  }
  const v = (x.customer as unknown as Record<string, unknown>)[attribute];
  return v === undefined || v === null ? "" : String(v);
}

function compare(actual: string, operator: string, expected: string): boolean {
  const a = actual.toLowerCase();
  const e = expected.toLowerCase();
  switch (operator) {
    case "equals": return a === e;
    case "not_equals": return a !== e;
    case "contains": return a.includes(e);
    case "starts_with": return a.startsWith(e);
    case "is_empty": return a.trim() === "";
    default: return false;
  }
}

export function matchesKeywords(text: string | null | undefined, keywords: unknown): boolean {
  const words = (Array.isArray(keywords) ? keywords : []).map((k) => String(k).trim().toLowerCase()).filter(Boolean);
  const t = (text ?? "").toLowerCase();
  return words.length > 0 && words.some((w) => t.includes(w));
}

// ─── Engine ─────────────────────────────────────────────────────────────────

export class AutomationEngine {
  /**
   * Starts every active automation whose trigger matches an inbound message.
   * Idempotent per (automation, wamid); a customer with an unfinished run of the same automation
   * isn't started again (avoids sending the same Flow twice while one is pending).
   */
  async handleInboundMessage(params: {
    organizationId: number;
    channelId: number;
    customerId: number;
    messageId: number | null;
    wamid: string;
    text: string | null;
  }) {
    const active = await automationRepository.listActive(params.organizationId);
    for (const automation of active) {
      const trigger = (automation.graph?.nodes ?? []).find(
        (n) =>
          n.data?.type === "trigger_incoming_message" ||
          (n.data?.type === "trigger_keyword" && matchesKeywords(params.text, n.data.keywords))
      );
      if (!trigger) continue;
      try {
        if (await automationRepository.hasOpenRun(automation.id, params.customerId)) {
          log.debug("Automation skipped: customer already has an open run", { automationId: automation.id, customerId: params.customerId });
          continue;
        }
        const run = await automationRepository.createRun({
          organizationId: params.organizationId,
          automationId: automation.id,
          customerId: params.customerId,
          channelId: params.channelId,
          triggerKey: `msg:${params.wamid}`,
          status: AutomationRunStatus.RUNNING,
          currentNodeId: trigger.id,
          context: {
            trigger: { type: String(trigger.data.type), messageId: params.messageId, wamid: params.wamid, text: params.text },
            log: [],
          },
        });
        if (!run) continue; // this message already started a run (webhook retry)
        log.info("Automation run started", { runId: run.id, automationId: automation.id, customerId: params.customerId });
        await this.advance(run, automation, { fromNodeId: trigger.id });
      } catch (err) {
        log.error("Automation failed to start", { err, automationId: automation.id, customerId: params.customerId });
      }
    }
  }

  /** Resumes the run waiting on this Flow execution (if any). Returns the run id when one was resumed. */
  async resumeOnFlowSubmission(executionId: number, runId: number | null, response: Record<string, unknown>): Promise<number | null> {
    if (!runId) return null;
    const claimed = await automationRepository.claimWaitingRun(runId, { kind: "flow_submission", executionId });
    if (!claimed) {
      // Not waiting yet (e.g. still before the Wait node) — the Wait node will find the stored submission
      log.debug("No run waiting for this Flow submission", { runId, executionId });
      return null;
    }
    const automation = await automationRepository.find(claimed.automationId, claimed.organizationId);
    if (!automation) return null;
    const waitNodeId = claimed.waitingFor?.nodeId ?? claimed.currentNodeId!;
    claimed.context = { ...claimed.context, flow: response };
    claimed.waitingFor = null;
    await this.advance(claimed, automation, { fromNodeId: waitNodeId });
    return claimed.id;
  }

  /**
   * Periodic work (call from a cron): resume finished delays, time out Flow waits, expire
   * unanswered Flow executions. Safe to run concurrently — every resume is claimed atomically.
   */
  async sweep(now = new Date()) {
    const expired = await whatsappFlowRepository.expireOverdueExecutions(now);
    let resumed = 0;
    let timedOut = 0;
    for (const run of await automationRepository.listDueRuns(now)) {
      const wait = run.waitingFor;
      if (!wait) continue;
      const claimed = await automationRepository.claimWaitingRun(run.id, wait);
      if (!claimed) continue;
      try {
        if (wait.kind === "delay") {
          const automation = await automationRepository.find(claimed.automationId, claimed.organizationId);
          if (!automation) continue;
          claimed.waitingFor = null;
          await this.advance(claimed, automation, { fromNodeId: wait.nodeId });
          resumed++;
        } else {
          await automationRepository.updateRun(claimed.id, {
            status: AutomationRunStatus.TIMED_OUT,
            waitingFor: null,
            lastError: "No Flow response before the wait timed out.",
            completedAt: now,
          });
          timedOut++;
        }
      } catch (err) {
        log.error("Sweep failed to process run", { err, runId: run.id });
      }
    }
    return { expiredExecutions: expired.length, resumedRuns: resumed, timedOutRuns: timedOut };
  }

  // ── Execution loop ────────────────────────────────────────────────────

  /** Moves past `fromNodeId` (already executed) and keeps executing until finish or wait. */
  private async advance(run: AutomationRun, automation: Automation, opts: { fromNodeId: string; handle?: string }) {
    const customer = await customerRepository.findById(run.customerId, run.organizationId);
    if (!customer) {
      await automationRepository.updateRun(run.id, { status: AutomationRunStatus.CANCELLED, lastError: "Contact no longer exists.", completedAt: new Date() });
      return;
    }
    const x: Exec = { run, automation, customer };
    let nodeId: string | null = this.nextNodeId(automation, opts.fromNodeId, opts.handle);
    let steps = 0;

    try {
      while (nodeId) {
        if (++steps > MAX_STEPS_PER_TICK) throw new Error("Too many steps in one pass — check the automation for loops.");
        const node = automation.graph.nodes.find((n) => n.id === nodeId);
        if (!node) throw new Error(`Node ${nodeId} not found in the automation.`);

        const result = await this.execute(node, x);
        this.record(x, node, result.kind === "stop" ? result.outcome : result.kind === "wait" ? "waiting" : "done");

        if (result.kind === "wait") {
          await automationRepository.updateRun(run.id, {
            ...result.run,
            status: AutomationRunStatus.WAITING,
            currentNodeId: node.id,
            context: x.run.context,
            stepCount: run.stepCount + steps,
          });
          return;
        }
        if (result.kind === "stop") {
          nodeId = null;
          break;
        }
        nodeId = this.nextNodeId(automation, node.id, result.handle);
      }
      await automationRepository.updateRun(run.id, {
        status: AutomationRunStatus.COMPLETED,
        currentNodeId: null,
        waitingFor: null,
        wakeAt: null,
        context: x.run.context,
        stepCount: run.stepCount + steps,
        completedAt: new Date(),
      });
      log.info("Automation run completed", { runId: run.id, automationId: automation.id });
    } catch (err) {
      const appErr = toAppError(err);
      await automationRepository.updateRun(run.id, {
        status: AutomationRunStatus.FAILED,
        currentNodeId: nodeId,
        context: x.run.context,
        lastError: appErr.message,
        completedAt: new Date(),
      });
      log.warn("Automation run failed", { err: appErr, runId: run.id, nodeId });
    }
  }

  private nextNodeId(automation: Automation, fromNodeId: string, handle?: string): string | null {
    const edges = automation.graph.edges.filter((e) => e.source === fromNodeId);
    const edge = handle ? edges.find((e) => e.sourceHandle === handle) : edges[0];
    return edge?.target ?? null;
  }

  private record(x: Exec, node: AutomationGraphNode, outcome: string) {
    const entry = { at: new Date().toISOString(), nodeId: node.id, type: String(node.data.type), outcome };
    const logEntries = [...(x.run.context.log ?? []), entry];
    x.run.context = { ...x.run.context, log: logEntries.slice(-MAX_LOG) } as AutomationRunContext;
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
      case "flow_branch": // single-path runtime: follows the first branch
        return { kind: "next" };

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
        if (!text) throw new Error("Send Message has no content.");
        await whatsAppService.sendMessage({
          organizationId: x.run.organizationId,
          customerId: x.customer.id,
          to: x.customer.phone ?? "",
          text,
          metadata: { automation: { automationId: x.automation.id, runId: x.run.id, nodeId: node.id } },
        });
        return { kind: "next" };
      }

      case "action_send_template": {
        // Builder stores either a template record id or a raw template name
        const ref = String(d.templateId ?? "").trim();
        if (!ref) throw new Error("Send Template has no template.");
        const record = /^\d+$/.test(ref) ? await whatsappFlowRepository.findTemplate(Number(ref), x.run.organizationId) : null;
        await whatsAppService.sendMessage({
          organizationId: x.run.organizationId,
          customerId: x.customer.id,
          to: x.customer.phone ?? "",
          type: "template",
          templateName: record?.name ?? ref,
          languageCode: record?.language ?? "en_US",
          metadata: { automation: { automationId: x.automation.id, runId: x.run.id, nodeId: node.id } },
        });
        return { kind: "next" };
      }

      case "action_update_contact": {
        const field = String(d.updateField ?? "");
        const value = render(String(d.updateValue ?? ""), x).trim();
        if (field === "name" || field === "email" || field === "language") {
          if (value) {
            const updated = await customerRepository.updateCustomer(x.customer.id, x.run.organizationId, { [field]: value });
            if (updated) x.customer = updated;
          }
        } else if (field === "tag") {
          if (value && !(x.customer.tags ?? []).includes(value)) {
            const updated = await customerRepository.updateCustomer(x.customer.id, x.run.organizationId, {
              tags: [...(x.customer.tags ?? []), value],
            });
            if (updated) x.customer = updated;
          }
        } else {
          return { kind: "next" }; // fields without storage (e.g. notes) are skipped
        }
        return { kind: "next" };
      }

      case "action_assign_conversation":
        // Builder options are placeholders (no team/agent mapping yet): recorded, no side effect
        return { kind: "next" };

      case SEND_FLOW_NODE: {
        const execution = await whatsappFlowSendService.send({
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
        });
        x.run.context = { ...x.run.context, lastFlowExecutionId: execution.id };
        return { kind: "next" };
      }

      case WAIT_FLOW_NODE: {
        const executionId = x.run.context.lastFlowExecutionId;
        if (!executionId) throw new Error("Wait for Flow Submission needs a Send WhatsApp Flow step before it.");
        // The customer may have answered before the run reached this node
        const existing = await whatsappFlowRepository.findSubmissionByExecution(executionId);
        if (existing) {
          x.run.context = { ...x.run.context, flow: existing.response };
          return { kind: "next" };
        }
        const execution = await whatsappFlowRepository.findExecution(executionId, x.run.organizationId);
        if (execution?.status === WaFlowExecutionStatus.FAILED) throw new Error("The Flow could not be sent.");
        const hours = Math.max(Number(d.timeoutHours) || DEFAULT_FLOW_WAIT_HOURS, 1);
        return {
          kind: "wait",
          run: {
            waitingFor: { kind: "flow_submission", executionId, nodeId: node.id },
            wakeAt: new Date(Date.now() + hours * 60 * 60 * 1000),
          },
        };
      }

      case "flow_delay": {
        const amount = Math.max(Number(d.delayAmount) || 0, 0);
        const unitMs = { seconds: 1e3, minutes: 6e4, hours: 36e5, days: 864e5 }[String(d.delayUnit ?? "minutes")] ?? 6e4;
        if (!amount) return { kind: "next" };
        return {
          kind: "wait",
          run: { waitingFor: { kind: "delay", nodeId: node.id }, wakeAt: new Date(Date.now() + amount * unitMs) },
        };
      }

      case "flow_end":
        return { kind: "stop", outcome: "end" };

      default:
        throw new Error(`Unsupported node type "${d.type}".`);
    }
  }
}

export const automationEngine = new AutomationEngine();
