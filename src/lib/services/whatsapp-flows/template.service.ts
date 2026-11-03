import { whatsappFlowRepository } from "../../db/repositories";
import {
  SENDABLE_VERSION_STATUSES,
  type WaFlowVersionStatusValue,
  type WhatsAppTemplateRow,
} from "../../db/schema";
import { flowsApi } from "../../meta";
import { AppError, toAppError } from "@/lib/errors";
import { createLogger } from "@/lib/logger";
import { resolveWabaCredentials, credentialsForWaba } from "./waba-credentials";

const log = createLogger("WhatsAppTemplates");

/** Local-only states; everything else is Meta's template status verbatim. */
export const TemplateLocalStatus = {
  SUBMITTING: "SUBMITTING",
  SUBMISSION_FAILED: "SUBMISSION_FAILED",
} as const;

/** Only APPROVED templates can be sent (Meta rule). */
export const SENDABLE_TEMPLATE_STATUS = "APPROVED";

export const TEMPLATE_LIMITS = {
  name: 512,
  body: 1024,
  header: 60,
  footer: 60,
  buttonText: 25, // FLOW button label (sendingaflow guide)
} as const;

export interface TemplateInput {
  channelId?: number | null;
  name?: string;
  language?: string;
  category?: string;
  bodyText?: string;
  headerText?: string | null;
  footerText?: string | null;
  flowId?: number;
  flowVersionId?: number | null;
  buttonText?: string;
}

/**
 * message_template_status_update events → the stored status. Events that don't change whether the
 * template can be sent (FLAGGED, LOCKED, LIMIT_EXCEEDED, UNARCHIVED) only add a note.
 */
const EVENT_TO_STATUS: Record<string, string | null> = {
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  PENDING: "PENDING",
  PAUSED: "PAUSED",
  DISABLED: "DISABLED",
  IN_APPEAL: "IN_APPEAL",
  ARCHIVED: "ARCHIVED",
  DELETED: "DELETED",
  PENDING_DELETION: "PENDING_DELETION",
  REINSTATED: "APPROVED",
  FLAGGED: null,
  LOCKED: null,
  LIMIT_EXCEEDED: null,
  UNARCHIVED: null,
};

function text(value: unknown, field: string, label: string, max: number, required: boolean): string | null {
  const v = typeof value === "string" ? value.trim() : "";
  if (!v) {
    if (required) throw AppError.validation(`${label} is required.`, field);
    return null;
  }
  if (v.length > max) throw AppError.validation(`${label} can be at most ${max} characters.`, field);
  // Variables need sample values at submission; this builder sends fixed text only
  if (/\{\{.*?\}\}/.test(v)) throw AppError.validation(`${label} can't contain {{variables}} here.`, field);
  return v;
}

export class WhatsAppTemplateService {
  async list(organizationId: number, filter: { flowId?: number; status?: string } = {}) {
    const rows = await whatsappFlowRepository.listTemplates(organizationId, filter);
    const flowIds = [...new Set(rows.map((r) => r.flowId).filter((id): id is number => !!id))];
    const [flows, versions] = await Promise.all([
      whatsappFlowRepository.findFlowsByIds(organizationId, flowIds),
      whatsappFlowRepository.listVersionsForFlows(organizationId, flowIds),
    ]);
    return rows.map((t) => {
      const version = versions.find((v) => v.id === t.flowVersionId);
      return {
        ...this.view(t),
        flowName: flows.find((f) => f.id === t.flowId)?.name ?? null,
        versionNumber: version?.versionNumber ?? null,
        versionStatus: version?.status ?? null,
      };
    });
  }

  view(t: WhatsAppTemplateRow) {
    return {
      id: t.id,
      name: t.name,
      language: t.language,
      category: t.category,
      status: t.status,
      rejectionReason: t.rejectionReason,
      bodyText: t.bodyText,
      headerText: t.headerText,
      footerText: t.footerText,
      flowId: t.flowId,
      flowVersionId: t.flowVersionId,
      flowButton: t.flowButton,
      metaTemplateId: t.metaTemplateId,
      wabaId: t.wabaId,
      channelId: t.channelId,
      lastError: t.lastError,
      lastSyncedAt: t.lastSyncedAt,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    };
  }

  async require(organizationId: number, id: number): Promise<WhatsAppTemplateRow> {
    const t = await whatsappFlowRepository.findTemplate(id, organizationId);
    if (!t) throw AppError.notFound("Template not found.");
    return t;
  }

  /**
   * Creates a template with a FLOW button pointing at a *published* Flow version, and submits it
   * for review. Approval is tracked separately from the Flow's publication.
   */
  async create(organizationId: number, userId: number, input: TemplateInput) {
    const name = text(input.name, "name", "Template name", TEMPLATE_LIMITS.name, true)!;
    if (!/^[a-z0-9_]+$/.test(name)) {
      throw AppError.validation("Template names use lowercase letters, numbers and underscores only.", "name");
    }
    const language = typeof input.language === "string" && /^[a-z]{2,3}(_[A-Z]{2})?$/.test(input.language) ? input.language : null;
    if (!language) throw AppError.validation("Choose a template language (e.g. en_US).", "language");
    const category = input.category === "MARKETING" || input.category === "UTILITY" ? input.category : null;
    if (!category) throw AppError.validation("Template category must be Marketing or Utility.", "category");
    const bodyText = text(input.bodyText, "bodyText", "Body text", TEMPLATE_LIMITS.body, true)!;
    const headerText = text(input.headerText, "headerText", "Header", TEMPLATE_LIMITS.header, false);
    const footerText = text(input.footerText, "footerText", "Footer", TEMPLATE_LIMITS.footer, false);
    const buttonText = text(input.buttonText, "buttonText", "Button text", TEMPLATE_LIMITS.buttonText, true)!;

    // ── The Flow: must be published (a template only ever references a published version) ──
    if (!input.flowId) throw AppError.validation("Choose the WhatsApp Flow this template opens.", "flowId");
    const flow = await whatsappFlowRepository.findFlow(Number(input.flowId), organizationId);
    if (!flow || flow.archivedAt) throw AppError.validation("The selected Flow doesn't exist or is archived.", "flowId");
    const versionId = input.flowVersionId ?? flow.publishedVersionId;
    const version = versionId ? await whatsappFlowRepository.findVersion(versionId, organizationId) : null;
    if (!version || version.flowId !== flow.id || !version.metaFlowId) {
      throw AppError.validation("Publish this Flow before attaching it to a template.", "flowId");
    }
    if (!SENDABLE_VERSION_STATUSES.includes(version.status as WaFlowVersionStatusValue)) {
      throw AppError.validation(`Flow version ${version.versionNumber} is ${version.status} and can't be attached.`, "flowVersionId");
    }

    // Flows and templates belong to a WABA; both must be on the same one
    const creds = input.channelId ? await resolveWabaCredentials(organizationId, input.channelId) : await credentialsForWaba(organizationId, version.wabaId);
    if (creds.wabaId !== version.wabaId) {
      throw AppError.validation("This Flow was published on a different WhatsApp Business Account than the selected number.", "channelId");
    }

    const existing = await whatsappFlowRepository.findTemplateByName(creds.wabaId, name, language);
    if (existing) throw new AppError("CONFLICT", { message: `A template named "${name}" (${language}) already exists.`, expected: true });

    const navigateScreen = version.definition.screens[0]?.id; // the entry screen
    const components: Record<string, unknown>[] = [
      ...(headerText ? [{ type: "HEADER", format: "TEXT", text: headerText }] : []),
      { type: "BODY", text: bodyText },
      ...(footerText ? [{ type: "FOOTER", text: footerText }] : []),
      {
        type: "BUTTONS",
        buttons: [
          { type: "FLOW", text: buttonText, flow_id: version.metaFlowId, flow_action: "navigate", navigate_screen: navigateScreen },
        ],
      },
    ];

    // Stored first so a Meta failure leaves a visible, retryable record instead of nothing
    const row = await whatsappFlowRepository.createTemplate({
      organizationId,
      channelId: creds.channel.id,
      wabaId: creds.wabaId,
      name,
      language,
      category,
      status: TemplateLocalStatus.SUBMITTING,
      bodyText,
      headerText,
      footerText,
      components,
      flowId: flow.id,
      flowVersionId: version.id,
      flowButton: { text: buttonText, flowAction: "navigate", navigateScreen: navigateScreen! },
      flowButtonIndex: 0,
      createdById: userId,
    });

    return this.submit(organizationId, row);
  }

  /** Submits (or re-submits after a failed attempt) a stored template to Meta. */
  async submit(organizationId: number, row: WhatsAppTemplateRow) {
    if (row.metaTemplateId) throw new AppError("CONFLICT", { message: "This template was already submitted to Meta.", expected: true });
    try {
      const creds = await credentialsForWaba(organizationId, row.wabaId);
      const res = await flowsApi.createMessageTemplate(creds.wabaId, creds.token, {
        name: row.name,
        language: row.language,
        category: row.category as "MARKETING" | "UTILITY",
        components: row.components,
      });
      const updated = await whatsappFlowRepository.updateTemplate(row.id, {
        metaTemplateId: String(res.id),
        status: res.status || "PENDING",
        category: res.category || row.category,
        lastError: null,
        lastSyncedAt: new Date(),
      });
      log.info("Template submitted to Meta", { templateId: row.id, metaTemplateId: res.id, status: res.status });
      return this.view(updated!);
    } catch (err) {
      const appErr = toAppError(err);
      await whatsappFlowRepository.updateTemplate(row.id, { status: TemplateLocalStatus.SUBMISSION_FAILED, lastError: appErr.message });
      log.warn("Template submission failed", { err: appErr, templateId: row.id });
      throw appErr;
    }
  }

  async retry(organizationId: number, id: number) {
    const row = await this.require(organizationId, id);
    if (row.status !== TemplateLocalStatus.SUBMISSION_FAILED) {
      throw new AppError("CONFLICT", { message: "Only templates whose submission failed can be retried.", expected: true });
    }
    return this.submit(organizationId, row);
  }

  /** Pulls the current review status from Meta. */
  async sync(organizationId: number, id: number) {
    const row = await this.require(organizationId, id);
    if (!row.metaTemplateId) return this.view(row);
    const creds = await credentialsForWaba(organizationId, row.wabaId);
    const meta = await flowsApi.getMessageTemplate(row.metaTemplateId, creds.token);
    const updated = await whatsappFlowRepository.updateTemplate(row.id, {
      status: meta.status || row.status,
      category: meta.category || row.category,
      rejectionReason: meta.status === "REJECTED" ? meta.rejected_reason ?? row.rejectionReason : null,
      lastSyncedAt: new Date(),
    });
    return this.view(updated!);
  }

  /** Deletes the template at Meta (when submitted) and locally. Executions keep their history. */
  async remove(organizationId: number, id: number) {
    const row = await this.require(organizationId, id);
    if (row.metaTemplateId) {
      const creds = await credentialsForWaba(organizationId, row.wabaId);
      try {
        await flowsApi.deleteMessageTemplate(creds.wabaId, creds.token, row.name, row.metaTemplateId);
      } catch (err) {
        const appErr = toAppError(err);
        // Already gone at Meta → fine to remove locally; anything else is reported
        if (appErr.code !== "NOT_FOUND" && appErr.code !== "META_INVALID_REQUEST") throw appErr;
        log.warn("Template delete at Meta failed; removing local record", { err: appErr, templateId: id });
      }
    }
    await whatsappFlowRepository.deleteTemplate(id, organizationId);
  }

  /** Webhook: message_template_status_update. Tenant resolved from the stored template, checked against the WABA. */
  async applyStatusWebhook(
    wabaId: string | undefined,
    value: {
      event?: string;
      message_template_id?: number | string;
      reason?: string | null;
      rejection_info?: { reason?: string; recommendation?: string };
      other_info?: { title?: string; description?: string };
    }
  ) {
    if (!value.message_template_id || !value.event) return;
    const row = await whatsappFlowRepository.findTemplateByMetaId(String(value.message_template_id));
    if (!row) {
      log.debug("Template status webhook for a template not managed here", { metaTemplateId: value.message_template_id });
      return;
    }
    if (wabaId && row.wabaId !== wabaId) {
      log.warn("Template status webhook WABA mismatch — ignored", { metaTemplateId: value.message_template_id, wabaId });
      return;
    }
    const status = EVENT_TO_STATUS[value.event];
    const rejection =
      value.event === "REJECTED"
        ? [value.rejection_info?.reason, value.rejection_info?.recommendation].filter(Boolean).join(" ") ||
          (value.reason && value.reason !== "NONE" ? value.reason : null)
        : null;
    const note = status === null ? `${value.event}${value.other_info?.description ? `: ${value.other_info.description}` : ""}` : null;

    await whatsappFlowRepository.updateTemplate(row.id, {
      ...(status ? { status } : {}),
      ...(status ? { rejectionReason: rejection } : {}),
      ...(note ? { lastError: note } : {}),
      lastSyncedAt: new Date(),
    });
    log.info("Template status updated from webhook", { templateId: row.id, event: value.event });
  }
}

export const whatsappTemplateService = new WhatsAppTemplateService();
