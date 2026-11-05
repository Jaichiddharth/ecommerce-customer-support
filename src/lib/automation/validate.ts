import { normalizeKeywords } from "./keywords";

/**
 * Configuration checks for an automation graph, shared by the builder (live issue list, node
 * config panel) and the server (activation). Pure: no database access — the server adds the
 * checks that need it (Flow published, template approved) in AutomationService.assertActivatable.
 *
 * The rules mirror what the runtime (engine.ts) actually does, so anything reported here would
 * otherwise make a run fail, silently skip steps or never start.
 */

export interface AutomationIssue {
  /** Step the issue is about; null when it concerns the automation as a whole. */
  nodeId: string | null;
  nodeLabel?: string;
  message: string;
}

interface GraphNode {
  id: string;
  position?: { x: number; y: number };
  data: Record<string, unknown>;
}

interface GraphEdge {
  source: string;
  target: string;
  sourceHandle?: string | null;
}

/** Triggers the runtime starts runs from. */
const RUNNABLE_TRIGGERS = new Set(["trigger_incoming_message", "trigger_keyword"]);
const SEND_FLOW = "action_send_whatsapp_flow";
const WAIT_FLOW = "flow_wait_flow_submission";

const text = (d: Record<string, unknown>, key: string) => String(d[key] ?? "").trim();

/** Field-level checks for one step (what its config panel must have before it can be saved). */
export function nodeConfigIssues(type: string, d: Record<string, unknown>): string[] {
  const out: string[] = [];
  switch (type) {
    case "trigger_incoming_message":
    case "flow_branch":
    case "flow_end":
      break;

    case "trigger_keyword":
    case "condition_keyword_match":
      if (!normalizeKeywords(d.keywords).length) out.push("Add at least one keyword.");
      break;

    case "trigger_conversation_event":
      if (!text(d, "event")) out.push("Choose the conversation event.");
      break;

    case "condition_if_else":
    case "condition_contact_attribute":
      if (!text(d, "attribute")) out.push("Choose the attribute to check.");
      if (!text(d, "operator")) out.push("Choose an operator.");
      else if (d.operator !== "is_empty" && !text(d, "value")) out.push("Enter the value to compare with.");
      break;

    case "action_send_message":
      if (!text(d, "messageContent")) out.push("Enter the message to send.");
      break;

    case "action_send_template":
      if (!text(d, "templateId")) out.push("Enter the template to send.");
      break;

    case "action_assign_conversation":
      if (!text(d, "assignTo")) out.push("Choose who the conversation is assigned to.");
      break;

    case "action_update_contact":
      if (!text(d, "updateField")) out.push("Choose the contact field to update.");
      else if (!text(d, "updateValue")) out.push("Enter the new value.");
      break;

    case SEND_FLOW:
      if (!d.flowId) {
        out.push("Choose a published WhatsApp Flow.");
      } else if (d.sendMethod === "interactive") {
        if (!text(d, "flowBody")) out.push("Enter the message text.");
        if (!text(d, "flowCta")) out.push("Enter the button text.");
      } else if (!d.templateId) {
        out.push("Choose an approved template that opens this Flow.");
      }
      break;

    case "flow_delay": {
      const amount = Number(d.delayAmount);
      if (!Number.isFinite(amount) || amount < 1) out.push("Set how long to wait (at least 1).");
      break;
    }

    case WAIT_FLOW:
      if (d.timeoutHours !== undefined && !(Number(d.timeoutHours) >= 1)) out.push("Set a timeout of at least 1 hour.");
      break;

    default:
      out.push(`Unknown step type "${type}".`);
  }
  return out;
}

/**
 * Every problem that would stop the automation from running as drawn, in reading order
 * (automation-level first, then steps top to bottom). Pass `name` to also check the name.
 */
export function validateAutomation(input: { name?: string; nodes: GraphNode[]; edges: GraphEdge[] }): AutomationIssue[] {
  const issues: AutomationIssue[] = [];
  const nodes = [...input.nodes].sort(
    (a, b) => (a.position?.y ?? 0) - (b.position?.y ?? 0) || (a.position?.x ?? 0) - (b.position?.x ?? 0)
  );
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const typeOf = (n: GraphNode) => String(n.data?.type ?? "");
  const labelOf = (n: GraphNode) => String(n.data?.label ?? "").trim() || "Untitled step";
  const add = (n: GraphNode, message: string) => issues.push({ nodeId: n.id, nodeLabel: labelOf(n), message });

  if (input.name !== undefined && !input.name.trim()) {
    issues.push({ nodeId: null, message: "Give the automation a name." });
  }
  if (!nodes.some((n) => RUNNABLE_TRIGGERS.has(typeOf(n)))) {
    issues.push({ nodeId: null, message: "Add an Incoming Message or Keyword trigger to start the automation." });
  }

  const edges = input.edges.filter((e) => byId.has(e.source) && byId.has(e.target));
  const outgoing = new Map<string, GraphEdge[]>();
  const incoming = new Map<string, GraphEdge[]>();
  for (const e of edges) {
    outgoing.set(e.source, [...(outgoing.get(e.source) ?? []), e]);
    incoming.set(e.target, [...(incoming.get(e.target) ?? []), e]);
  }

  // Steps reachable from a trigger — anything else never runs
  const reachable = new Set<string>();
  const queue = nodes.filter((n) => typeOf(n).startsWith("trigger_")).map((n) => n.id);
  while (queue.length) {
    const id = queue.shift()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const e of outgoing.get(id) ?? []) queue.push(e.target);
  }

  // Steps that close a loop (the runtime gives up after 50 steps in one pass)
  const loopTargets = new Set<string>();
  const state = new Map<string, "visiting" | "done">();
  const visit = (id: string) => {
    state.set(id, "visiting");
    for (const e of outgoing.get(id) ?? []) {
      const s = state.get(e.target);
      if (s === "visiting") loopTargets.add(e.target);
      else if (!s) visit(e.target);
    }
    state.set(id, "done");
  };
  for (const n of nodes) if (!state.has(n.id)) visit(n.id);

  for (const n of nodes) {
    const type = typeOf(n);
    const out = outgoing.get(n.id) ?? [];
    const isTrigger = type.startsWith("trigger_");

    if (type === "trigger_conversation_event") {
      add(n, "Conversation Event triggers don't run yet. Use an Incoming Message or Keyword trigger instead.");
    }

    for (const message of nodeConfigIssues(type, n.data ?? {})) add(n, message);

    if (isTrigger) {
      if (!out.length) add(n, "Connect this trigger to the first step.");
    } else if (!reachable.has(n.id)) {
      add(n, "Not connected to a trigger, so it never runs. Connect it or delete it.");
      continue; // its position in the flow can't be judged
    }

    if (type === "condition_if_else") {
      if (!out.some((e) => e.sourceHandle === "true" || e.sourceHandle === "false")) {
        add(n, "Connect the TRUE or FALSE path to a next step.");
      }
    } else if (type !== "flow_end" && out.length > 1) {
      add(n, `Has ${out.length} outgoing connections, but only the first one runs. Keep one connection.`);
    }

    if (loopTargets.has(n.id)) add(n, "Is part of a loop, so the automation would never finish. Remove a connection to break it.");

    if (type === WAIT_FLOW) {
      const upstream = new Set<string>();
      const stack = [n.id];
      while (stack.length) {
        const cur = stack.pop()!;
        for (const e of incoming.get(cur) ?? []) {
          if (!upstream.has(e.source)) {
            upstream.add(e.source);
            stack.push(e.source);
          }
        }
      }
      if (![...upstream].some((id) => typeOf(byId.get(id)!) === SEND_FLOW)) {
        add(n, "Place it after a Send WhatsApp Flow step.");
      }
    }
  }

  return issues;
}

/** One-line summary, e.g. for an error message: `"Send Reply": Enter the message to send. (+2 more)`. */
export function summarizeIssues(issues: AutomationIssue[]): string {
  if (!issues.length) return "";
  const [first] = issues;
  const head = first.nodeLabel ? `"${first.nodeLabel}": ${first.message}` : first.message;
  return issues.length > 1 ? `${head} (+${issues.length - 1} more)` : head;
}
