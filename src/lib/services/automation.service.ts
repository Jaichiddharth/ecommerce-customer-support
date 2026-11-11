import {
  automationRepository,
  whatsappFlowRepository,
  type AutomationListingRow,
  type AutomationSortKey,
  type RunSortKey,
} from "../db/repositories";
import { toListResult, type ListQuery } from "@/lib/api/list-query";
import type { ListResult } from "@/lib/listing";
import { SENDABLE_VERSION_STATUSES, type AutomationGraph, type WaFlowVersionStatusValue } from "../db/schema";
import { AppError } from "@/lib/errors";
import { SEND_FLOW_NODE, invalidateActiveAutomations } from "@/lib/automation/engine";
import { summarizeIssues, validateAutomation, type AutomationIssue } from "@/lib/automation/validate";
import { SENDABLE_TEMPLATE_STATUS } from "./whatsapp-flows/template.service";
import { flowFieldsOf, type FlowField } from "@/lib/automation/variables";

/** Listing status (derived in SQL). Failed = switched on, but its most recent run failed. */
export const AUTOMATION_LIST_STATUSES = ["draft", "active", "paused", "failed", "archived"] as const;
export const AUTOMATION_TRIGGER_TYPES = ["incoming_message", "keyword", "conversation_event", "none"] as const;
/** Execution Status filter: status of the most recent run, or "never" (no runs yet). */
export const AUTOMATION_EXECUTION_FILTERS = ["completed", "failed", "waiting", "running", "timed_out", "cancelled", "never"] as const;

export interface AutomationListParams extends ListQuery<AutomationSortKey> {
  q?: string;
  status?: string;
  trigger?: string;
  execution?: string;
}

const cleanDescription = (d: unknown) => (typeof d === "string" && d.trim() ? d.trim().slice(0, 500) : null);

/** Accepts the builder's nodes/edges, keeping only what the runtime reads (drops UI-only fields). */
function sanitizeGraph(raw: unknown): AutomationGraph {
  const g = raw as { nodes?: unknown[]; edges?: unknown[] } | null;
  if (!g || !Array.isArray(g.nodes) || !Array.isArray(g.edges)) throw AppError.validation("Automation graph is missing.", "graph");
  if (g.nodes.length > 200) throw AppError.validation("An automation can have at most 200 steps.", "graph");
  const nodes = g.nodes
    .filter((n): n is Record<string, any> => !!n && typeof (n as any).id === "string" && typeof (n as any).data?.type === "string")
    .map((n) => {
      const { _onConfigure, _issues, ...data } = n.data ?? {};
      return { id: String(n.id), type: String(n.type ?? data.type), position: n.position, data };
    });
  const ids = new Set(nodes.map((n) => n.id));
  const edges = g.edges
    .filter((e): e is Record<string, any> => !!e && ids.has((e as any).source) && ids.has((e as any).target))
    .map((e) => ({
      id: String(e.id),
      source: String(e.source),
      target: String(e.target),
      sourceHandle: e.sourceHandle ?? null,
      targetHandle: e.targetHandle ?? null,
      label: typeof e.label === "string" ? e.label : undefined,
    }));
  return { nodes, edges };
}

export class AutomationService {
  async list(organizationId: number) {
    return automationRepository.list(organizationId);
  }

  /**
   * Listing with derived status, trigger, node count and run statistics. Filtering (incl. the
   * last-modified date range), sorting, counting and pagination all run in the database.
   */
  async listing(organizationId: number, params: AutomationListParams): Promise<ListResult<AutomationListingRow>> {
    const { rows, total } = await automationRepository.listingPage(organizationId, {
      q: params.q?.trim() || undefined,
      status: params.status,
      trigger: params.trigger,
      execution: params.execution,
      fromDate: params.fromDate,
      toDate: params.toDate,
      sortBy: params.sortBy,
      sortOrder: params.sortOrder,
      limit: params.limit,
      offset: params.offset,
    });
    return toListResult(rows, total, params);
  }

  /** Execution history: filtered (status, started date), sorted, counted and paginated in the database. */
  async runs(organizationId: number, id: number, params: ListQuery<RunSortKey> & { status?: string }) {
    await this.require(organizationId, id);
    const { rows, total } = await automationRepository.listRuns(organizationId, id, {
      status: params.status,
      fromDate: params.fromDate,
      toDate: params.toDate,
      sortBy: params.sortBy,
      sortOrder: params.sortOrder,
      limit: params.limit,
      offset: params.offset,
    });
    return toListResult(rows, total, params);
  }

  async run(organizationId: number, automationId: number, runId: number) {
    const run = await automationRepository.findRunForOrg(runId, organizationId);
    if (!run || run.automationId !== automationId) throw AppError.notFound("Execution not found.");
    return run;
  }

  async require(organizationId: number, id: number) {
    const a = await automationRepository.find(id, organizationId);
    if (!a) throw AppError.notFound("Automation not found.");
    return a;
  }

  async create(organizationId: number, userId: number, body: { name?: string; description?: string | null; graph?: unknown; isActive?: boolean }) {
    const name = String(body.name ?? "").trim() || "Untitled automation";
    const graph = sanitizeGraph(body.graph);
    if (body.isActive) await this.assertActivatable(organizationId, graph);
    const created = await automationRepository.create({
      organizationId,
      name: name.slice(0, 200),
      description: cleanDescription(body.description),
      graph,
      isActive: !!body.isActive,
      activatedAt: body.isActive ? new Date() : null,
      createdById: userId,
    });
    invalidateActiveAutomations(organizationId);
    return created;
  }

  async update(organizationId: number, id: number, body: { name?: string; description?: string | null; graph?: unknown; isActive?: boolean }) {
    const current = await this.require(organizationId, id);
    if (current.archivedAt) throw new AppError("CONFLICT", { message: "Restore this automation before changing it.", expected: true });
    const graph = body.graph !== undefined ? sanitizeGraph(body.graph) : current.graph;
    const isActive = body.isActive ?? current.isActive;
    if (isActive) await this.assertActivatable(organizationId, graph);
    const updated = await automationRepository.update(id, organizationId, {
      ...(body.name !== undefined ? { name: String(body.name).trim().slice(0, 200) || current.name } : {}),
      ...(body.description !== undefined ? { description: cleanDescription(body.description) } : {}),
      graph,
      isActive,
      ...(isActive && !current.activatedAt ? { activatedAt: new Date() } : {}),
    });
    invalidateActiveAutomations(organizationId);
    return updated;
  }

  /** Copies the graph as a Draft (never active), so the copy can't start running unexpectedly. */
  async duplicate(organizationId: number, userId: number, id: number) {
    const src = await this.require(organizationId, id);
    return automationRepository.create({
      organizationId,
      name: `${src.name} (copy)`.slice(0, 200),
      description: src.description,
      graph: src.graph,
      isActive: false,
      createdById: userId,
    });
  }

  /**
   * Never-run automations are deleted; anything with execution history is archived instead
   * (switched off, open runs cancelled, history kept and still viewable).
   */
  async remove(organizationId: number, id: number): Promise<{ deleted: boolean; archived: boolean }> {
    await this.require(organizationId, id);
    if ((await automationRepository.countRuns(id)) === 0) {
      await automationRepository.remove(id, organizationId);
      invalidateActiveAutomations(organizationId);
      return { deleted: true, archived: false };
    }
    await automationRepository.update(id, organizationId, { isActive: false, archivedAt: new Date() });
    invalidateActiveAutomations(organizationId);
    await automationRepository.cancelOpenRuns(id, "Automation archived.");
    return { deleted: false, archived: true };
  }

  /** Back to the listing, switched off (it must be re-activated explicitly). */
  async restore(organizationId: number, id: number) {
    await this.require(organizationId, id);
    const restored = await automationRepository.update(id, organizationId, { archivedAt: null });
    invalidateActiveAutomations(organizationId);
    return restored;
  }

  /**
   * Validation before an automation may run: every check the builder runs (validateAutomation:
   * trigger, step configuration, connections, loops), plus what needs the database — every Send
   * WhatsApp Flow step pointing at a published Flow and, for template delivery, an approved template
   * of that Flow. All issues are returned in `details.issues` so the builder can list them.
   */
  async assertActivatable(organizationId: number, graph: AutomationGraph) {
    const issues: AutomationIssue[] = validateAutomation(graph, { flowFields: await this.flowFieldsOf(organizationId, graph) });
    const misconfigured = new Set(issues.map((i) => i.nodeId));

    for (const node of graph.nodes) {
      const d = node.data;
      // Steps already reported (e.g. no Flow chosen) aren't looked up
      if (d.type !== SEND_FLOW_NODE || misconfigured.has(node.id)) continue;
      const add = (message: string) => issues.push({ nodeId: node.id, nodeLabel: String(d.label || node.id), message });

      const flow = await whatsappFlowRepository.findFlow(Number(d.flowId), organizationId);
      if (!flow || flow.archivedAt) {
        add("The selected WhatsApp Flow no longer exists. Choose another one.");
        continue;
      }
      if (!flow.publishedVersionId) add(`"${flow.name}" has no published version. Publish the Flow first.`);
      if (d.sendMethod === "interactive") continue;

      const template = await whatsappFlowRepository.findTemplate(Number(d.templateId), organizationId);
      if (!template) add("The selected template no longer exists. Choose another one.");
      else if (template.flowId !== flow.id) add(`Template "${template.name}" opens a different Flow.`);
      else if (template.status !== SENDABLE_TEMPLATE_STATUS) add(`Template "${template.name}" is ${template.status.toLowerCase()}, not approved.`);
      else {
        const version = template.flowVersionId ? await whatsappFlowRepository.findVersion(template.flowVersionId, organizationId) : null;
        if (!version || !SENDABLE_VERSION_STATUSES.includes(version.status as WaFlowVersionStatusValue)) {
          add(`The Flow version used by template "${template.name}" is no longer published.`);
        }
      }
    }

    if (issues.length) {
      throw new AppError("VALIDATION_ERROR", {
        message: `This automation can't be activated: ${summarizeIssues(issues)}`,
        details: { issues },
        expected: true,
      });
    }
  }

  /**
   * Questions of every Flow the automation sends, from the version the customer will actually open
   * (the template's pinned version, else the published one), so {{flow.…}} variables are checked by name.
   */
  private async flowFieldsOf(organizationId: number, graph: AutomationGraph): Promise<Map<number, FlowField[]>> {
    const out = new Map<number, FlowField[]>();
    for (const node of graph.nodes) {
      const d = node.data;
      const flowId = Number(d.flowId);
      if (d.type !== SEND_FLOW_NODE || !flowId || out.has(flowId)) continue;
      const flow = await whatsappFlowRepository.findFlow(flowId, organizationId);
      const template = d.sendMethod !== "interactive" && d.templateId ? await whatsappFlowRepository.findTemplate(Number(d.templateId), organizationId) : null;
      const versionId = template?.flowVersionId ?? flow?.publishedVersionId;
      const version = versionId ? await whatsappFlowRepository.findVersion(versionId, organizationId) : null;
      if (version) out.set(flowId, flowFieldsOf(version.definition));
    }
    return out;
  }
}

export const automationService = new AutomationService();
