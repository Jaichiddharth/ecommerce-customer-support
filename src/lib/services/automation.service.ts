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
import { SEND_FLOW_NODE, WAIT_FLOW_NODE } from "@/lib/automation/engine";
import { SENDABLE_TEMPLATE_STATUS } from "./whatsapp-flows/template.service";

const TRIGGER_TYPES = new Set(["trigger_incoming_message", "trigger_keyword"]);

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
      const { _onConfigure, ...data } = n.data ?? {};
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
    return automationRepository.create({
      organizationId,
      name: name.slice(0, 200),
      description: cleanDescription(body.description),
      graph,
      isActive: !!body.isActive,
      activatedAt: body.isActive ? new Date() : null,
      createdById: userId,
    });
  }

  async update(organizationId: number, id: number, body: { name?: string; description?: string | null; graph?: unknown; isActive?: boolean }) {
    const current = await this.require(organizationId, id);
    if (current.archivedAt) throw new AppError("CONFLICT", { message: "Restore this automation before changing it.", expected: true });
    const graph = body.graph !== undefined ? sanitizeGraph(body.graph) : current.graph;
    const isActive = body.isActive ?? current.isActive;
    if (isActive) await this.assertActivatable(organizationId, graph);
    return automationRepository.update(id, organizationId, {
      ...(body.name !== undefined ? { name: String(body.name).trim().slice(0, 200) || current.name } : {}),
      ...(body.description !== undefined ? { description: cleanDescription(body.description) } : {}),
      graph,
      isActive,
      ...(isActive && !current.activatedAt ? { activatedAt: new Date() } : {}),
    });
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
      return { deleted: true, archived: false };
    }
    await automationRepository.update(id, organizationId, { isActive: false, archivedAt: new Date() });
    await automationRepository.cancelOpenRuns(id, "Automation archived.");
    return { deleted: false, archived: true };
  }

  /** Back to the listing, switched off (it must be re-activated explicitly). */
  async restore(organizationId: number, id: number) {
    await this.require(organizationId, id);
    return automationRepository.update(id, organizationId, { archivedAt: null });
  }

  /**
   * Validation before an automation may run: a supported trigger, and every Send WhatsApp Flow
   * step pointing at a published Flow (and, for template delivery, an approved template of that Flow).
   */
  async assertActivatable(organizationId: number, graph: AutomationGraph) {
    const problems: string[] = [];
    if (!graph.nodes.some((n) => TRIGGER_TYPES.has(String(n.data.type)))) {
      problems.push("Add an Incoming Message or Keyword trigger.");
    }

    for (const node of graph.nodes) {
      const d = node.data;
      const label = d.label || node.id;
      if (d.type === SEND_FLOW_NODE) {
        const flowId = Number(d.flowId);
        const flow = flowId ? await whatsappFlowRepository.findFlow(flowId, organizationId) : null;
        if (!flow || flow.archivedAt) {
          problems.push(`"${label}": choose a WhatsApp Flow.`);
          continue;
        }
        if (!flow.publishedVersionId) problems.push(`"${label}": "${flow.name}" has no published version.`);
        if (d.sendMethod === "interactive") {
          if (!String(d.flowCta ?? "").trim() || !String(d.flowBody ?? "").trim()) {
            problems.push(`"${label}": interactive delivery needs button text and message text.`);
          }
        } else {
          const template = d.templateId ? await whatsappFlowRepository.findTemplate(Number(d.templateId), organizationId) : null;
          if (!template) problems.push(`"${label}": choose an approved template for this Flow.`);
          else if (template.flowId !== flow.id) problems.push(`"${label}": template "${template.name}" opens a different Flow.`);
          else if (template.status !== SENDABLE_TEMPLATE_STATUS) problems.push(`"${label}": template "${template.name}" is ${template.status}.`);
          else {
            const version = template.flowVersionId ? await whatsappFlowRepository.findVersion(template.flowVersionId, organizationId) : null;
            if (!version || !SENDABLE_VERSION_STATUSES.includes(version.status as WaFlowVersionStatusValue)) {
              problems.push(`"${label}": the Flow version used by template "${template.name}" is no longer published.`);
            }
          }
        }
      }
      if (d.type === WAIT_FLOW_NODE) {
        // Must be reachable from a Send WhatsApp Flow step
        const upstream = new Set<string>();
        const stack = [node.id];
        while (stack.length) {
          const cur = stack.pop()!;
          for (const e of graph.edges) if (e.target === cur && !upstream.has(e.source)) { upstream.add(e.source); stack.push(e.source); }
        }
        if (!graph.nodes.some((n) => upstream.has(n.id) && n.data.type === SEND_FLOW_NODE)) {
          problems.push(`"${label}": place it after a Send WhatsApp Flow step.`);
        }
      }
    }

    if (problems.length) {
      throw new AppError("VALIDATION_ERROR", {
        message: `This automation can't be activated: ${problems[0]}`,
        details: { issues: problems },
        expected: true,
      });
    }
  }
}

export const automationService = new AutomationService();
