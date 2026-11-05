import { whatsappFlowRepository, automationRepository, type FlowSortKey } from "../../db/repositories";
import { toListResult, type ListQuery } from "@/lib/api/list-query";
import {
  META_FLOW_CATEGORIES,
  SENDABLE_VERSION_STATUSES,
  WaFlowStatus,
  WaFlowVersionStatus,
  type MetaValidationError,
  type WaFlowVersionStatusValue,
  type WhatsAppFlowRow,
  type WhatsAppFlowVersionRow,
  type Automation,
} from "../../db/schema";
import { flowsApi, type MetaFlowDetails } from "../../meta";
import {
  FLOW_JSON_VERSIONS,
  buildFlowJson,
  sanitizeFlowDefinition,
  validateFlow,
  validateMetaJson,
  type WaFlow,
} from "@/lib/whatsapp-flows";
import { AppError, toAppError } from "@/lib/errors";
import { createLogger } from "@/lib/logger";
import { resolveWabaCredentials, credentialsForWaba } from "./waba-credentials";

const log = createLogger("WhatsAppFlows");

const META_TO_VERSION_STATUS: Record<string, WaFlowVersionStatusValue> = {
  DRAFT: WaFlowVersionStatus.DRAFT,
  PUBLISHED: WaFlowVersionStatus.PUBLISHED,
  DEPRECATED: WaFlowVersionStatus.DEPRECATED,
  BLOCKED: WaFlowVersionStatus.BLOCKED,
  THROTTLED: WaFlowVersionStatus.THROTTLED,
};

export interface FlowInput {
  name?: string;
  categories?: string[];
  channelId?: number | null;
  draft?: unknown;
}

/** Automations whose graph references a Flow (Send WhatsApp Flow nodes). */
export function automationsUsingFlow(list: Automation[], flowId: number) {
  return list
    .map((a) => ({
      id: a.id,
      name: a.name,
      isActive: a.isActive,
      nodeIds: (a.graph?.nodes ?? []).filter((n) => Number(n.data?.flowId) === flowId).map((n) => n.id),
    }))
    .filter((a) => a.nodeIds.length > 0);
}

const screenCount = (draft: WaFlow | null | undefined) => draft?.screens?.length ?? 0;

/** The editor model is kept as the flow's draft; its name/version follow the flow record. */
function normalizeDraft(raw: unknown, name: string): WaFlow {
  const draft = sanitizeFlowDefinition(raw);
  if (!draft) throw AppError.validation("The flow definition is missing or malformed.", "draft");
  if (!(FLOW_JSON_VERSIONS as readonly string[]).includes(draft.version)) {
    throw AppError.validation(`Flow JSON version ${draft.version} is not supported.`, "draft.version");
  }
  return { ...draft, name };
}

function validateName(name: unknown): string {
  const value = typeof name === "string" ? name.trim() : "";
  if (!value) throw AppError.validation("Flow name is required.", "name");
  if (value.length > 200) throw AppError.validation("Flow name can be at most 200 characters.", "name");
  return value;
}

function validateCategories(categories: unknown): string[] {
  if (!Array.isArray(categories) || categories.length === 0) {
    throw AppError.validation("Choose at least one Flow category.", "categories");
  }
  const invalid = categories.filter((c) => !(META_FLOW_CATEGORIES as readonly string[]).includes(String(c)));
  if (invalid.length) throw AppError.validation(`Unsupported Flow category: ${invalid.join(", ")}.`, "categories");
  return [...new Set(categories.map(String))];
}

/** Editor-level + structural validation of what would be published. Throws a 400 listing the problems. */
function assertPublishable(draft: WaFlow) {
  const issues = validateFlow(draft).filter((i) => i.severity === "error");
  const json = buildFlowJson(draft);
  const structural = validateMetaJson(json);
  if (issues.length || structural.length) {
    throw new AppError("VALIDATION_ERROR", {
      message: `The flow has ${issues.length + structural.length} validation error(s). Fix them before publishing.`,
      details: { issues: [...issues.map((i) => i.message), ...structural] },
      expected: true,
    });
  }
  return json;
}

/** Key-order-independent JSON (jsonb doesn't preserve key order, so raw strings can't be compared). */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

const describeValidationErrors = (errors: MetaValidationError[]) =>
  errors.map((e) => e.message || e.error || "Invalid Flow JSON").slice(0, 5).join(" · ");

export class WhatsAppFlowService {
  // ── Queries ───────────────────────────────────────────────────────────

  /** Flow listing: filtered, sorted, counted and paginated in the database (see `listFlowsPage`). */
  async list(organizationId: number, params: ListQuery<FlowSortKey> & { q?: string; status?: string }) {
    const { rows, total } = await whatsappFlowRepository.listFlowsPage(organizationId, {
      q: params.q?.trim() || undefined,
      status: params.status || undefined,
      fromDate: params.fromDate,
      toDate: params.toDate,
      sortBy: params.sortBy,
      sortOrder: params.sortOrder,
      limit: params.limit,
      offset: params.offset,
    });
    // Only the automations that reference a Flow on this page (graph filtered in SQL)
    const automations = await automationRepository.listReferencingFlows(organizationId, rows.map((r) => r.id));
    const items = rows.map((f) => ({
      ...f,
      automations: automationsUsingFlow(automations, f.id).map(({ id, name, isActive }) => ({ id, name, isActive })),
    }));
    return toListResult(items, total, params);
  }

  /** Every Flow (incl. archived) as id / name / status — for filter pickers such as Submissions → Flow. */
  async options(organizationId: number) {
    return whatsappFlowRepository.listFlowOptions(organizationId);
  }

  /** Sendable Flows for pickers (templates, automation action). */
  async listPublished(organizationId: number) {
    const { rows } = await whatsappFlowRepository.listFlows(organizationId, { status: WaFlowStatus.PUBLISHED, limit: 200, offset: 0 });
    const versions = await whatsappFlowRepository.listVersionsForFlows(organizationId, rows.map((r) => r.id));
    return rows.map((f) => {
      const v = versions.find((x) => x.id === f.publishedVersionId);
      return {
        id: f.id,
        name: f.name,
        channelId: f.channelId,
        publishedVersion: v
          ? {
              id: v.id,
              versionNumber: v.versionNumber,
              metaFlowId: v.metaFlowId,
              wabaId: v.wabaId,
              entryScreen: v.definition.screens[0]?.id ?? null,
              screens: v.definition.screens.map((s) => ({ id: s.id, title: s.title })),
            }
          : null,
      };
    });
  }

  async get(organizationId: number, id: number) {
    const flow = await this.require(organizationId, id);
    const [versions, templates, automations, submissions] = await Promise.all([
      whatsappFlowRepository.listVersions(id, organizationId),
      whatsappFlowRepository.listTemplates(organizationId, { flowId: id }),
      automationRepository.list(organizationId),
      whatsappFlowRepository.countSubmissionsByFlow(organizationId, [id]),
    ]);
    return {
      ...this.summary(flow),
      draft: flow.draft,
      versions: versions.map((v) => this.versionSummary(v)),
      templates: templates.map((t) => ({
        id: t.id,
        name: t.name,
        language: t.language,
        category: t.category,
        status: t.status,
        flowVersionId: t.flowVersionId,
        versionNumber: versions.find((v) => v.id === t.flowVersionId)?.versionNumber ?? null,
      })),
      automations: automationsUsingFlow(automations, id),
      submissionsCount: submissions.get(id) ?? 0,
    };
  }

  private summary(f: WhatsAppFlowRow) {
    return {
      id: f.id,
      name: f.name,
      categories: f.categories,
      jsonVersion: f.jsonVersion,
      status: f.status,
      channelId: f.channelId,
      screensCount: screenCount(f.draft),
      hasUnpublishedChanges: f.hasUnpublishedChanges,
      publishedVersionId: f.publishedVersionId,
      archivedAt: f.archivedAt,
      createdAt: f.createdAt,
      updatedAt: f.updatedAt,
    };
  }

  private versionSummary(v: WhatsAppFlowVersionRow) {
    return {
      id: v.id,
      versionNumber: v.versionNumber,
      status: v.status,
      metaFlowId: v.metaFlowId,
      metaFlowName: v.metaFlowName,
      wabaId: v.wabaId,
      jsonVersion: v.jsonVersion,
      screensCount: v.definition.screens.length,
      validationErrors: v.validationErrors,
      lastError: v.lastError,
      publishedAt: v.publishedAt,
      deprecatedAt: v.deprecatedAt,
      lastSyncedAt: v.lastSyncedAt,
      createdAt: v.createdAt,
      healthStatus: (v.metaResponse as { health_status?: unknown } | null)?.health_status ?? null,
    };
  }

  async require(organizationId: number, id: number): Promise<WhatsAppFlowRow> {
    const flow = await whatsappFlowRepository.findFlow(id, organizationId);
    if (!flow) throw AppError.notFound("Flow not found.");
    return flow;
  }

  // ── Mutations ─────────────────────────────────────────────────────────

  async create(organizationId: number, userId: number, input: FlowInput) {
    const name = validateName(input.name);
    const categories = input.categories ? validateCategories(input.categories) : ["OTHER"];
    const draft = normalizeDraft(input.draft, name);
    const row = await whatsappFlowRepository.createFlow({
      organizationId,
      name,
      categories,
      channelId: input.channelId ?? null,
      jsonVersion: draft.version,
      draft,
      createdById: userId,
    });
    log.info("WhatsApp Flow created", { flowId: row.id, organizationId });
    return this.get(organizationId, row.id);
  }

  /** Saves the editable draft. Published versions are separate rows and are never touched here. */
  async update(organizationId: number, id: number, input: FlowInput) {
    const flow = await this.require(organizationId, id);
    if (flow.archivedAt) throw new AppError("CONFLICT", { message: "Restore this Flow before editing it.", expected: true });

    const name = input.name !== undefined ? validateName(input.name) : flow.name;
    const patch: Parameters<typeof whatsappFlowRepository.updateFlow>[2] = { name };
    if (input.categories !== undefined) patch.categories = validateCategories(input.categories);
    if (input.channelId !== undefined) patch.channelId = input.channelId;
    if (input.draft !== undefined) {
      const draft = normalizeDraft(input.draft, name);
      patch.draft = draft;
      patch.jsonVersion = draft.version;
      patch.hasUnpublishedChanges = true;
    } else if (name !== flow.name) {
      patch.draft = { ...flow.draft, name };
    }
    await whatsappFlowRepository.updateFlow(id, organizationId, patch);
    return this.get(organizationId, id);
  }

  async duplicate(organizationId: number, userId: number, id: number) {
    const flow = await this.require(organizationId, id);
    const name = `${flow.name} (copy)`.slice(0, 200);
    return this.create(organizationId, userId, {
      name,
      categories: flow.categories,
      channelId: flow.channelId,
      draft: { ...flow.draft, id: undefined },
    });
  }

  /**
   * Never-sent drafts are deleted (with their Meta DRAFT Flows); anything that was published or
   * sent is archived instead, so templates, executions and submissions keep their references.
   */
  async remove(organizationId: number, id: number): Promise<{ deleted: boolean; archived: boolean }> {
    const flow = await this.require(organizationId, id);
    const versions = await whatsappFlowRepository.listVersions(id, organizationId);
    const everPublished = versions.some((v) => v.publishedAt);
    const sent = await whatsappFlowRepository.countExecutionsByFlow(id);
    const templates = await whatsappFlowRepository.listTemplates(organizationId, { flowId: id });

    if (everPublished || sent > 0 || templates.length > 0) {
      await whatsappFlowRepository.updateFlow(id, organizationId, { status: WaFlowStatus.ARCHIVED, archivedAt: new Date() });
      log.info("WhatsApp Flow archived", { flowId: id, organizationId });
      return { deleted: false, archived: true };
    }

    for (const v of versions) {
      if (!v.metaFlowId) continue;
      try {
        const creds = await credentialsForWaba(organizationId, v.wabaId);
        await flowsApi.deleteFlow(v.metaFlowId, creds.token);
      } catch (err) {
        // A Meta DRAFT left behind is harmless; don't block the merchant's delete on it
        log.warn("Could not delete draft Flow at Meta", { err, metaFlowId: v.metaFlowId, flowId: id });
      }
    }
    await whatsappFlowRepository.deleteFlow(flow.id, organizationId);
    log.info("WhatsApp Flow deleted", { flowId: id, organizationId });
    return { deleted: true, archived: false };
  }

  async restore(organizationId: number, id: number) {
    await this.require(organizationId, id);
    await whatsappFlowRepository.updateFlow(id, organizationId, { archivedAt: null });
    await this.recomputeStatus(organizationId, id);
    return this.get(organizationId, id);
  }

  // ── Publishing ────────────────────────────────────────────────────────

  /**
   * Publishes the current draft as a new immutable version (a new Meta Flow).
   * Retry-safe: an interrupted attempt leaves a `publishing`/`draft` version that already holds its
   * Meta Flow id, and the next call resumes it (re-uploads the JSON, then publishes) instead of
   * creating a duplicate Meta Flow. Earlier published versions are never modified.
   */
  async publish(organizationId: number, userId: number, id: number) {
    const flow = await this.require(organizationId, id);
    if (flow.archivedAt) throw new AppError("CONFLICT", { message: "Restore this Flow before publishing it.", expected: true });

    const flowJson = assertPublishable(flow.draft);
    const creds = await resolveWabaCredentials(organizationId, flow.channelId);
    if (!flow.channelId) await whatsappFlowRepository.updateFlow(id, organizationId, { channelId: creds.channel.id });

    // Resume an unfinished attempt for the same content, or refuse a concurrent different one
    const versions = await whatsappFlowRepository.listVersions(id, organizationId);
    const unfinished = versions.find((v) => v.status === WaFlowVersionStatus.PUBLISHING || v.status === WaFlowVersionStatus.DRAFT);
    const sameContent = unfinished && canonicalJson(unfinished.flowJson) === canonicalJson(flowJson) && unfinished.wabaId === creds.wabaId;

    let version: WhatsAppFlowVersionRow;
    if (unfinished && sameContent) {
      version = unfinished;
    } else {
      if (unfinished) {
        // Superseded attempt: mark it failed (its Meta DRAFT, if any, is left unpublished)
        await whatsappFlowRepository.updateVersion(unfinished.id, {
          status: WaFlowVersionStatus.FAILED,
          lastError: "Superseded by a newer publish attempt.",
        });
      }
      const versionNumber = await whatsappFlowRepository.nextVersionNumber(id);
      version = await whatsappFlowRepository.createVersion({
        organizationId,
        flowId: id,
        versionNumber,
        wabaId: creds.wabaId,
        // Meta Flow names should be unique per WABA; the id + version make them so
        metaFlowName: `${flow.name} · #${id} v${versionNumber}`.slice(0, 200),
        jsonVersion: flow.draft.version,
        definition: flow.draft,
        flowJson,
        status: WaFlowVersionStatus.PUBLISHING,
        createdById: userId,
      });
    }
    await whatsappFlowRepository.updateFlow(id, organizationId, { status: WaFlowStatus.PUBLISHING });

    const jsonString = JSON.stringify(flowJson);
    try {
      let validationErrors: MetaValidationError[] = [];
      let metaFlowId = version.metaFlowId;

      if (!metaFlowId) {
        const created = await flowsApi.createFlow(creds.wabaId, creds.token, {
          name: version.metaFlowName,
          categories: flow.categories,
          flowJson: jsonString,
        });
        metaFlowId = created.id;
        validationErrors = created.validation_errors ?? [];
        // Persist the Meta id immediately so a retry resumes instead of creating another Flow
        version = (await whatsappFlowRepository.updateVersion(version.id, { metaFlowId, status: WaFlowVersionStatus.DRAFT }))!;
      } else {
        const uploaded = await flowsApi.uploadFlowJson(metaFlowId, creds.token, jsonString);
        validationErrors = uploaded.validation_errors ?? [];
      }

      if (validationErrors.length) {
        await whatsappFlowRepository.updateVersion(version.id, {
          status: WaFlowVersionStatus.FAILED,
          validationErrors,
          lastError: `Meta rejected the Flow JSON: ${describeValidationErrors(validationErrors)}`,
        });
        await this.recomputeStatus(organizationId, id);
        throw new AppError("META_INVALID_REQUEST", {
          message: "Meta rejected the Flow JSON. See the version's validation errors.",
          details: { validationErrors },
          expected: true,
        });
      }

      await flowsApi.publishFlow(metaFlowId, creds.token);
      const details = await flowsApi.getFlow(metaFlowId, creds.token).catch(() => null);
      const now = new Date();
      await whatsappFlowRepository.updateVersion(version.id, {
        status: details ? META_TO_VERSION_STATUS[details.status] ?? WaFlowVersionStatus.PUBLISHED : WaFlowVersionStatus.PUBLISHED,
        validationErrors: [],
        lastError: null,
        publishedAt: now,
        lastSyncedAt: now,
        metaResponse: details as unknown as Record<string, unknown>,
      });
      await whatsappFlowRepository.updateFlow(id, organizationId, { hasUnpublishedChanges: false });
      await this.recomputeStatus(organizationId, id);
      log.info("WhatsApp Flow published", { flowId: id, versionId: version.id, metaFlowId });
    } catch (err) {
      const appErr = toAppError(err);
      const current = await whatsappFlowRepository.findVersion(version.id, organizationId);
      if (current && current.status !== WaFlowVersionStatus.FAILED) {
        // Keep it resumable: with a Meta id it stays `draft` (retry re-uploads + publishes)
        await whatsappFlowRepository.updateVersion(version.id, {
          status: current.metaFlowId ? WaFlowVersionStatus.DRAFT : WaFlowVersionStatus.FAILED,
          lastError: appErr.message,
        });
      }
      await this.recomputeStatus(organizationId, id);
      log.warn("WhatsApp Flow publish failed", { err: appErr, flowId: id, versionId: version.id });
      throw appErr;
    }

    return this.get(organizationId, id);
  }

  /** Pulls the current Meta status of every non-final version. */
  async sync(organizationId: number, id: number) {
    await this.require(organizationId, id);
    const versions = await whatsappFlowRepository.listVersions(id, organizationId);
    for (const v of versions) {
      if (!v.metaFlowId || v.status === WaFlowVersionStatus.DEPRECATED) continue;
      try {
        const creds = await credentialsForWaba(organizationId, v.wabaId);
        const details = await flowsApi.getFlow(v.metaFlowId, creds.token);
        await this.applyMetaDetails(v, details);
      } catch (err) {
        log.warn("Could not sync Flow version status", { err, versionId: v.id, metaFlowId: v.metaFlowId });
        await whatsappFlowRepository.updateVersion(v.id, { lastError: toAppError(err).message });
      }
    }
    await this.recomputeStatus(organizationId, id);
    return this.get(organizationId, id);
  }

  private async applyMetaDetails(v: WhatsAppFlowVersionRow, details: MetaFlowDetails) {
    const status = META_TO_VERSION_STATUS[details.status] ?? v.status;
    // A version we marked failed after Meta-side validation stays failed while Meta still calls it DRAFT
    const keepFailed = v.status === WaFlowVersionStatus.FAILED && status === WaFlowVersionStatus.DRAFT;
    await whatsappFlowRepository.updateVersion(v.id, {
      status: keepFailed ? v.status : status,
      validationErrors: details.validation_errors ?? v.validationErrors,
      metaResponse: details as unknown as Record<string, unknown>,
      lastSyncedAt: new Date(),
      ...(status === WaFlowVersionStatus.DEPRECATED && !v.deprecatedAt ? { deprecatedAt: new Date() } : {}),
      ...(status === WaFlowVersionStatus.PUBLISHED && !v.publishedAt ? { publishedAt: new Date() } : {}),
    });
  }

  /** Deprecates one published version at Meta (irreversible). Templates pinned to it stop working. */
  async deprecateVersion(organizationId: number, flowId: number, versionId: number) {
    const version = await whatsappFlowRepository.findVersion(versionId, organizationId);
    if (!version || version.flowId !== flowId) throw AppError.notFound("Flow version not found.");
    if (!version.metaFlowId || !SENDABLE_VERSION_STATUSES.includes(version.status as WaFlowVersionStatusValue)) {
      throw new AppError("CONFLICT", { message: "Only published versions can be deprecated.", expected: true });
    }
    const creds = await credentialsForWaba(organizationId, version.wabaId);
    await flowsApi.deprecateFlow(version.metaFlowId, creds.token);
    await whatsappFlowRepository.updateVersion(version.id, { status: WaFlowVersionStatus.DEPRECATED, deprecatedAt: new Date() });
    await this.recomputeStatus(organizationId, flowId);
    return this.get(organizationId, flowId);
  }

  /** Meta's web preview link for a version (or the draft's current Meta Flow while publishing). */
  async previewUrl(organizationId: number, flowId: number, versionId: number) {
    const version = await whatsappFlowRepository.findVersion(versionId, organizationId);
    if (!version || version.flowId !== flowId || !version.metaFlowId) throw AppError.notFound("Flow version not found at Meta.");
    const creds = await credentialsForWaba(organizationId, version.wabaId);
    return flowsApi.getFlowPreview(version.metaFlowId, creds.token);
  }

  /** Webhook: `flows` field, FLOW_STATUS_CHANGE. Tenant is resolved from the version row, checked against the WABA. */
  async applyStatusWebhook(wabaId: string | undefined, value: { flow_id?: string; new_status?: string; event?: string; message?: string }) {
    if (!value.flow_id) return;
    const version = await whatsappFlowRepository.findVersionByMetaFlowId(String(value.flow_id));
    if (!version) {
      log.debug("Flow status webhook for a Flow not managed here", { metaFlowId: value.flow_id, event: value.event });
      return;
    }
    if (wabaId && version.wabaId !== wabaId) {
      log.warn("Flow status webhook WABA mismatch — ignored", { metaFlowId: value.flow_id, wabaId, expected: version.wabaId });
      return;
    }
    const status = value.new_status ? META_TO_VERSION_STATUS[value.new_status] : undefined;
    if (status) {
      await whatsappFlowRepository.updateVersion(version.id, {
        status,
        lastSyncedAt: new Date(),
        ...(status === WaFlowVersionStatus.DEPRECATED && !version.deprecatedAt ? { deprecatedAt: new Date() } : {}),
      });
    } else if (value.message) {
      await whatsappFlowRepository.updateVersion(version.id, { lastError: value.message });
    }
    await this.recomputeStatus(version.organizationId, version.flowId);
    log.info("Flow status updated from webhook", { versionId: version.id, event: value.event, newStatus: value.new_status });
  }

  /** Derives the listing status and the sendable version from the versions. */
  async recomputeStatus(organizationId: number, flowId: number) {
    const flow = await whatsappFlowRepository.findFlow(flowId, organizationId);
    if (!flow) return;
    const versions = await whatsappFlowRepository.listVersions(flowId, organizationId); // newest first
    const sendable = versions.find((v) => SENDABLE_VERSION_STATUSES.includes(v.status as WaFlowVersionStatusValue));
    const latest = versions[0];

    let status: string = WaFlowStatus.DRAFT;
    if (flow.archivedAt) status = WaFlowStatus.ARCHIVED;
    else if (latest?.status === WaFlowVersionStatus.PUBLISHING) status = WaFlowStatus.PUBLISHING;
    else if (sendable) status = WaFlowStatus.PUBLISHED;
    else if (versions.some((v) => v.status === WaFlowVersionStatus.DEPRECATED || v.status === WaFlowVersionStatus.BLOCKED)) {
      status = WaFlowStatus.DEPRECATED;
    } else if (latest?.status === WaFlowVersionStatus.FAILED || latest?.status === WaFlowVersionStatus.DRAFT) {
      status = WaFlowStatus.FAILED;
    }

    await whatsappFlowRepository.updateFlow(flowId, organizationId, { status, publishedVersionId: sendable?.id ?? null });
  }
}

export const whatsappFlowService = new WhatsAppFlowService();
