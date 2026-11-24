import { normalizeKeywords } from "./keywords";
import { automationMediaOf } from "./media";
import {
  CONTACT_UPDATE_FIELDS,
  NO_VALUE_OPERATORS,
  OPERATOR_LABELS,
  attributeDef,
  variableProblems,
  type FlowField,
  type FlowScope,
  type OperatorId,
} from "./variables";

/**
 * Configuration checks for an automation graph, shared by the builder (live issue list, node
 * config panel) and the server (activation). Pure: no database access — the server adds the
 * checks that need it (Flow published, template approved) in AutomationService.assertActivatable.
 *
 * The rules mirror what the runtime (engine.ts) actually does, so anything reported here would
 * otherwise make a run fail, silently skip steps, send blank text or never start.
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
export const SEND_FLOW = "action_send_whatsapp_flow";
export const WAIT_FLOW = "flow_wait_flow_submission";
/** Replies with the workspace's AI agent (see engine.ts › aiAgentReply). */
export const AI_AGENT = "action_ai_agent";

/**
 * Steps with named outputs, in the order they're drawn (left → right). Every other step has one
 * unnamed output (End has none). Each named output must be connected.
 */
export const BRANCH_OUTPUTS: Record<string, { handle: string; label: string }[]> = {
  condition_if_else: [
    { handle: "true", label: "True" },
    { handle: "false", label: "False" },
  ],
  [AI_AGENT]: [
    { handle: "replied", label: "Replied" },
    { handle: "handover", label: "Handover" },
  ],
};

/** Text fields the engine fills variables into, per step type. */
export const VARIABLE_FIELDS: Record<string, string[]> = {
  action_send_message: ["messageContent"],
  [AI_AGENT]: ["handoverMessage"],
  action_update_contact: ["updateValue"],
  [SEND_FLOW]: ["flowBody"],
};

const text = (d: Record<string, unknown>, key: string) => String(d[key] ?? "").trim();


/** One field-level problem; `field` is the node data key the message is about. */
export interface NodeFieldIssue {
  field: string;
  message: string;
}

/**
 * Field-level checks for one step, keyed by the data field each one is about (for inline form errors).
 * Pass `scope` (Flow answers available at this step) to also check `{{flow.…}}` variables and Flow conditions.
 */
export function nodeConfigFieldIssues(type: string, d: Record<string, unknown>, scope?: FlowScope): NodeFieldIssue[] {
  const out: NodeFieldIssue[] = [];
  const push = (field: string, message: string) => out.push({ field, message });
  const checkVariables = (field: string) => {
    const [first] = variableProblems(d[field], scope);
    if (first) push(field, first);
  };

  switch (type) {
    case "trigger_incoming_message":
    case "flow_end":
    case WAIT_FLOW:
      break;

    case AI_AGENT:
      // The agent itself is set up on the AI agent page; only a custom handover message is optional here
      if (d.handoverReply === "custom") {
        if (!text(d, "handoverMessage")) push("handoverMessage", "Enter the message to send when the agent hands over.");
        else checkVariables("handoverMessage");
      }
      break;

    case "trigger_keyword":
    case "condition_keyword_match":
      if (!normalizeKeywords(d.keywords).length) push("keywords", "Add at least one keyword.");
      break;

    case "trigger_conversation_event":
      if (!text(d, "event")) push("event", "Choose the conversation event.");
      break;

    case "condition_if_else":
    case "condition_contact_attribute": {
      const attribute = text(d, "attribute");
      const operator = text(d, "operator");
      if (!attribute) {
        push("attribute", "Choose what to check.");
        break;
      }
      const isFlow = attribute.startsWith("flow.");
      if (isFlow && scope && !scope.available) {
        push("attribute", "Flow answers need a Wait for Flow Submission step earlier on this path.");
        break;
      }
      // Flow questions are only known with a scope; without one, only the operator/value presence is checked
      const def = attributeDef(attribute, scope?.fields);
      if (!def && (!isFlow || scope?.fields)) {
        push("attribute", isFlow ? "This question isn't in the Flow any more. Choose another one." : "This can't be checked. Choose another attribute.");
        break;
      }
      if (!operator) push("operator", "Choose an operator.");
      else if (def && !def.operators.includes(operator as OperatorId)) {
        push("operator", `“${OPERATOR_LABELS[operator as OperatorId] ?? operator}” doesn't work for ${def.label}. Choose another operator.`);
      } else if (!NO_VALUE_OPERATORS.has(operator) && !text(d, "value")) {
        push("value", def?.valueOptions ? "Choose a value." : "Enter the value to compare with.");
      } else if (def?.valueOptions && !NO_VALUE_OPERATORS.has(operator) && !def.valueOptions.some((o) => o.value === text(d, "value"))) {
        push("value", "This option isn't in the Flow any more. Choose another one.");
      }
      break;
    }

    case "action_send_message":
      // With an attachment the text is its caption, so it may be left empty
      if (!text(d, "messageContent")) {
        if (!automationMediaOf(d)) push("messageContent", "Enter the message to send or attach a file.");
      } else checkVariables("messageContent");
      break;

    case "action_send_template": {
      if (!text(d, "templateName")) {
        // Older steps stored a typed name, sent in en_US without its variables
        push("templateName", text(d, "templateId") ? "Choose the template again from the list." : "Choose an approved template.");
        break;
      }
      // A header file is sent as approved, looked up by the template's Meta id
      if (text(d, "templateHeaderFormat") && !text(d, "templateMetaId")) {
        push("templateName", "Choose the template again from the list.");
        break;
      }
      // Automations only send templates without variables; older steps may still use one that has them
      const fieldIds = (Array.isArray(d.templateFieldIds) ? (d.templateFieldIds as string[]) : []).filter((id) => id !== "header_media");
      if (fieldIds.length) push("templateName", "This template has variables, which an automation can't fill. Choose a template without variables.");
      break;
    }

    case "action_assign_conversation":
      if (!text(d, "assignTo")) push("assignTo", "Choose who the conversation is assigned to.");
      break;

    case "action_update_contact": {
      const field = text(d, "updateField");
      if (!field) push("updateField", "Choose what to update.");
      else if (!CONTACT_UPDATE_FIELDS.some((f) => f.value === field)) push("updateField", "This field can't be updated. Choose another one.");
      else if (!text(d, "updateValue")) push("updateValue", "Enter the new value.");
      else checkVariables("updateValue");
      break;
    }

    case SEND_FLOW:
      if (!d.flowId) {
        push("flowId", "Choose a published WhatsApp Flow.");
      } else if (d.sendMethod === "interactive") {
        if (!text(d, "flowBody")) push("flowBody", "Enter the message text.");
        else checkVariables("flowBody");
        if (!text(d, "flowCta")) push("flowCta", "Enter the button text.");
      } else if (!d.templateId) {
        push("templateId", "Choose an approved template that opens this Flow.");
      }
      break;

    default:
      push("type", `Unknown step type "${type}".`);
  }
  return out;
}

/** Field-level checks for one step (what its config panel must have before it can be saved). */
export function nodeConfigIssues(type: string, d: Record<string, unknown>, scope?: FlowScope): string[] {
  return nodeConfigFieldIssues(type, d, scope).map((i) => i.message);
}

// ─── Flow answers in scope ──────────────────────────────────────────────────

/** Steps upstream of `nodeId` (every step that can run before it). */
function upstreamOf(nodeId: string, edges: GraphEdge[]): Set<string> {
  const seen = new Set<string>();
  const stack = [nodeId];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const e of edges) {
      if (e.target === cur && !seen.has(e.source)) {
        seen.add(e.source);
        stack.push(e.source);
      }
    }
  }
  return seen;
}

/**
 * Flows whose answers a step can use: those sent by a Send WhatsApp Flow step before a Wait for Flow
 * Submission step that comes before this one. `waitsFor` is set for a Wait step: the Flows it waits for.
 */
export function flowsInScope(
  nodeId: string,
  nodes: GraphNode[],
  edges: GraphEdge[]
): { available: boolean; flowIds: number[]; waitsFor: number[] } {
  const typeById = new Map(nodes.map((n) => [n.id, String(n.data?.type ?? "")]));
  const flowIdOf = (id: string) => Number(nodes.find((n) => n.id === id)?.data?.flowId) || null;
  const sentBefore = (id: string) =>
    [...upstreamOf(id, edges)].filter((u) => typeById.get(u) === SEND_FLOW).map(flowIdOf).filter((f): f is number => !!f);

  const up = upstreamOf(nodeId, edges);
  const waits = [...up].filter((u) => typeById.get(u) === WAIT_FLOW);
  const flowIds = [...new Set(waits.flatMap(sentBefore))];
  const waitsFor = typeById.get(nodeId) === WAIT_FLOW ? [...new Set(sentBefore(nodeId))] : [];
  return { available: waits.length > 0, flowIds, waitsFor };
}

/** FlowScope for a step; `fields` is null when a Flow's questions aren't in `flowFields`. */
export function flowScopeFor(
  nodeId: string,
  nodes: GraphNode[],
  edges: GraphEdge[],
  flowFields?: Map<number, FlowField[]>
): FlowScope {
  const { available, flowIds } = flowsInScope(nodeId, nodes, edges);
  if (!available || !flowFields || flowIds.some((id) => !flowFields.has(id))) return { available, fields: null };
  const seen = new Set<string>();
  const fields = flowIds.flatMap((id) => flowFields.get(id)!).filter((f) => !seen.has(f.name) && seen.add(f.name));
  return { available, fields };
}

// ─── Whole automation ───────────────────────────────────────────────────────

/**
 * Every problem that would stop the automation from running as drawn, in reading order
 * (automation-level first, then steps top to bottom). Pass `name` to also check the name, and
 * `flowFields` (questions per Flow id) to check `{{flow.…}}` variables and Flow conditions by name.
 */
export function validateAutomation(
  input: { name?: string; nodes: GraphNode[]; edges: GraphEdge[] },
  opts: { flowFields?: Map<number, FlowField[]> } = {}
): AutomationIssue[] {
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
  for (const e of edges) outgoing.set(e.source, [...(outgoing.get(e.source) ?? []), e]);

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

    if (type === "condition_contact_attribute") {
      add(n, "The Filter step has been removed. Replace it with If / Else.");
    }

    if (type === "trigger_conversation_event") {
      add(n, "Conversation Event triggers don't run yet. Use an Incoming Message or Keyword trigger instead.");
    }

    const scope = isTrigger ? undefined : flowScopeFor(n.id, nodes, edges, opts.flowFields);
    for (const message of nodeConfigIssues(type, n.data ?? {}, scope)) add(n, message);

    if (isTrigger) {
      if (!out.length) add(n, "Connect this trigger to the first step.");
    } else if (!reachable.has(n.id)) {
      add(n, "Not connected to a trigger, so it never runs. Connect it or delete it.");
      continue; // its position in the flow can't be judged
    }

    if (type === WAIT_FLOW && !flowsInScope(n.id, nodes, edges).waitsFor.length) {
      add(n, "Place it after a Send WhatsApp Flow step.");
    }

    // Every path must finish on an End step, so where an automation stops is always explicit on the canvas
    const branches = BRANCH_OUTPUTS[type];
    if (branches) {
      for (const { handle, label } of branches) {
        if (!out.some((e) => e.sourceHandle === handle)) {
          add(n, `Connect the ${label} path to a next step, or to an End step if nothing should happen.`);
        }
      }
    } else if (type !== "flow_end") {
      if (!out.length && !isTrigger) add(n, "This is the last step on its path. Connect it to an End step.");
      else if (out.length > 1) add(n, `Has ${out.length} outgoing connections, but only the first one runs. Keep one connection.`);
    }

    if (loopTargets.has(n.id)) add(n, "Is part of a loop, so the automation would never finish. Remove a connection to break it.");
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
