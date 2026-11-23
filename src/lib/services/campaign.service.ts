import { campaignRepository, channelRepository, emptyStats, type CampaignStats } from "@/lib/db/repositories";
import {
  CampaignPauseReason,
  CampaignStatus,
  ChannelStatus,
  RecipientStatus,
  type Campaign,
  type CampaignRecipientRow,
  type CampaignVariableSource,
  type Channel,
  type NewCampaign,
} from "@/lib/db/schema";
import { AppError } from "@/lib/errors";
import { createLogger } from "@/lib/logger";
import { putObject } from "@/lib/storage/s3";
import { getTemplateSendBlocker } from "@/lib/whatsapp-templates";
import type { WhatsAppTemplate } from "@/types/templates";
import {
  buildAudience,
  MAX_FILE_BYTES,
  MAX_ROWS,
  parseContactFile,
  SheetError,
  type AudienceSummary,
  type CampaignRecipient,
} from "@/lib/campaigns/contact-file";
import { unmappedFields } from "@/lib/campaigns/message";
import { deleteStartSchedule, upsertStartSchedule } from "@/lib/campaigns/aws";
import { resumeCampaign } from "@/lib/campaigns/engine";
import { whatsAppService } from "./channels/whatsapp.service";

const log = createLogger("CampaignService");

/** Skipped rows kept on the campaign for display (the count is always exact) */
const STORED_REJECTED_ROWS = 500;
const PREVIEW_RECIPIENTS = 200;
const MIN_LEAD_MS = 60_000;
const MAX_LEAD_MS = 365 * 24 * 60 * 60_000;
const MIN_INTERVAL_S = 1;
/** Campaign names (the column allows 120; the UI and API keep them to 80) */
const MAX_NAME_LENGTH = 80;
const EXPORT_PAGE = 2000;

/** CSV cell; a leading = + - @ is neutralised so spreadsheets don't run uploaded text as a formula */
const csvCell = (value: string) => {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
/** Phone as text, so Excel keeps the "+" and doesn't turn it into 9.19E+11 */
const csvPhone = (phone: string) => `"=""${phone}"""`;

/** S3 folder of a campaign's uploaded contact files (next to organizations/{orgId}/automations/…) */
export const campaignFilePrefix = (organizationId: number, campaignId: number) => `organizations/${organizationId}/campaigns/${campaignId}/`;
const MAX_INTERVAL_S = 15 * 60;

// ─── DTO ──────────────────────────────────────────────────────────────────────

export interface CampaignDto {
  id: string;
  name: string;
  status: CampaignStatus;
  pauseReason: CampaignPauseReason | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  /** Workspace user who created the campaign */
  createdBy: { id: number; name: string } | null;
  recipientCount: number;
  /** `recipients` is a preview (first rows) on a single campaign, empty in lists */
  audience: (AudienceSummary & { recipients: CampaignRecipient[] }) | null;
  message: {
    phoneNumberId: string;
    senderLabel: string;
    template: WhatsAppTemplate | null;
    variables: Record<string, CampaignVariableSource>;
  };
  schedule: { sendAt: string | null; timezone: string; intervalSeconds: number | null };
  /** `sent` counts every message Meta accepted (delivered and read included); `delivered` includes read */
  stats: { pending: number; sent: number; delivered: number; read: number; failed: number; skipped: number; cancelled: number; unknown: number };
}

/** One contact of a campaign and what happened to it (details page) */
export interface CampaignRecipientDto {
  id: number;
  phone: string;
  /** Values from the uploaded file, by column */
  fields: Record<string, string>;
  status: RecipientStatus;
  attempts: number;
  errorCode: number | null;
  errorMessage: string | null;
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  /** From Meta's status webhook; null until it arrives */
  pricing: { billable: boolean | null; category: string | null; model: string | null } | null;
}

/** Contact filter of the details page → stored statuses */
export const RECIPIENT_FILTERS: Record<string, RecipientStatus[]> = {
  waiting: [RecipientStatus.PENDING, RecipientStatus.SENDING],
  sent: [RecipientStatus.SENT],
  delivered: [RecipientStatus.DELIVERED],
  read: [RecipientStatus.READ],
  failed: [RecipientStatus.FAILED, RecipientStatus.UNKNOWN],
  skipped: [RecipientStatus.SKIPPED],
  cancelled: [RecipientStatus.CANCELLED],
};

const recipientDto = (r: CampaignRecipientRow): CampaignRecipientDto => ({
  id: r.id,
  phone: r.phone,
  fields: r.fields ?? {},
  status: r.status,
  attempts: r.attempts,
  errorCode: r.errorCode ?? null,
  errorMessage: r.errorMessage ?? null,
  sentAt: r.sentAt?.toISOString() ?? null,
  deliveredAt: r.deliveredAt?.toISOString() ?? null,
  readAt: r.readAt?.toISOString() ?? null,
  pricing:
    r.billable === null && !r.pricingCategory && !r.pricingModel
      ? null
      : { billable: r.billable ?? null, category: r.pricingCategory ?? null, model: r.pricingModel ?? null },
});

const senderLabel = (channel: Channel | undefined) =>
  channel ? `${channel.name ?? "WhatsApp"}${channel.phoneNumber ? ` (${channel.phoneNumber})` : ""}` : "";

function toDto(
  c: Campaign,
  stats: CampaignStats,
  channel: Channel | undefined,
  creatorName: string | undefined,
  preview: CampaignRecipientRow[] = []
): CampaignDto {
  return {
    id: String(c.id),
    name: c.name,
    status: c.status,
    pauseReason: c.pauseReason ?? null,
    lastError: c.lastError ?? null,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    startedAt: c.startedAt?.toISOString() ?? null,
    completedAt: c.completedAt?.toISOString() ?? null,
    createdBy: c.createdById ? { id: c.createdById, name: creatorName ?? "Former member" } : null,
    recipientCount: c.recipientCount,
    audience: c.audience ? { ...c.audience, recipients: preview.map((r) => ({ phone: r.phone, fields: r.fields })) } : null,
    message: {
      phoneNumberId: c.phoneNumberId ?? "",
      senderLabel: senderLabel(channel),
      template: c.template ?? null,
      variables: c.variables ?? {},
    },
    schedule: { sendAt: c.scheduledAt?.toISOString() ?? null, timezone: c.timezone, intervalSeconds: c.intervalSeconds ?? null },
    stats: {
      pending: stats.pending + stats.sending,
      sent: stats.sent + stats.delivered + stats.read,
      delivered: stats.delivered + stats.read,
      read: stats.read,
      failed: stats.failed,
      skipped: stats.skipped,
      cancelled: stats.cancelled,
      unknown: stats.unknown,
    },
  };
}

// ─── Input parsing ────────────────────────────────────────────────────────────

type Body = Record<string, any>;

function parseName(value: unknown): string {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name) throw AppError.validation("Give the campaign a name.", "name");
  if (name.length > MAX_NAME_LENGTH) throw AppError.validation(`The name can be up to ${MAX_NAME_LENGTH} characters.`, "name");
  return name;
}

function parseVariables(value: unknown): Record<string, CampaignVariableSource> {
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value)) throw AppError.validation("Variables are invalid.", "variables");
  const out: Record<string, CampaignVariableSource> = {};
  for (const [id, source] of Object.entries(value as Record<string, any>)) {
    if (!/^(header|header_media|body:[\w]+|button:\d+)$/.test(id)) continue;
    if (source?.type === "column" && typeof source.column === "string") {
      const fallback = typeof source.fallback === "string" ? source.fallback.slice(0, 1000) : "";
      out[id] = { type: "column", column: source.column.slice(0, 200), ...(fallback ? { fallback } : {}) };
    }
    else if (source?.type === "text" && typeof source.value === "string") out[id] = { type: "text", value: source.value.slice(0, 1000) };
  }
  return out;
}

function parseTemplate(value: unknown): WhatsAppTemplate | null {
  if (value == null) return null;
  const t = value as WhatsAppTemplate;
  if (typeof t !== "object" || typeof t.name !== "string" || typeof t.language !== "string" || !Array.isArray(t.components)) {
    throw AppError.validation("The template is invalid.", "template");
  }
  return t;
}

function parseSchedule(value: any): Pick<NewCampaign, "scheduledAt" | "timezone" | "intervalSeconds"> {
  const out: Pick<NewCampaign, "scheduledAt" | "timezone" | "intervalSeconds"> = {};
  if (!value || typeof value !== "object") return out;
  if ("sendAt" in value) {
    if (value.sendAt === null || value.sendAt === "") out.scheduledAt = null;
    else {
      const date = new Date(value.sendAt);
      if (Number.isNaN(date.getTime())) throw AppError.validation("The start time is invalid.", "sendAt");
      out.scheduledAt = date;
    }
  }
  if (typeof value.timezone === "string" && value.timezone) out.timezone = value.timezone.slice(0, 64);
  if ("intervalSeconds" in value) {
    const s = value.intervalSeconds;
    if (s === null || s === "" || s === 0) out.intervalSeconds = null;
    else if (!Number.isInteger(s) || s < MIN_INTERVAL_S || s > MAX_INTERVAL_S) {
      throw AppError.validation("The delay must be from 1 second to 15 minutes.", "intervalSeconds");
    } else out.intervalSeconds = s;
  }
  return out;
}

async function resolveChannel(organizationId: number, phoneNumberId: string): Promise<Channel> {
  const channel = await channelRepository.findByPhoneId(organizationId, phoneNumberId);
  if (!channel || channel.status === ChannelStatus.DISCONNECTED) {
    throw new AppError("WHATSAPP_CHANNEL_NOT_FOUND", { message: "This WhatsApp number isn't connected anymore. Pick another one.", expected: true });
  }
  return channel;
}

/** Fields of a create/update body that apply to a draft */
async function draftPatch(organizationId: number, body: Body): Promise<Partial<NewCampaign>> {
  const patch: Partial<NewCampaign> = {};
  if ("name" in body) patch.name = parseName(body.name);
  const message = body.message;
  if (message && typeof message === "object") {
    if ("phoneNumberId" in message) {
      if (message.phoneNumberId) {
        const channel = await resolveChannel(organizationId, String(message.phoneNumberId));
        patch.channelId = channel.id;
        patch.phoneNumberId = channel.metaPhoneNumberId;
      } else {
        patch.channelId = null;
        patch.phoneNumberId = null;
      }
    }
    if ("template" in message) patch.template = parseTemplate(message.template);
    if ("variables" in message) patch.variables = parseVariables(message.variables);
  }
  Object.assign(patch, parseSchedule(body.schedule));
  return patch;
}

// ─── Service ──────────────────────────────────────────────────────────────────

const DELETABLE = [CampaignStatus.DRAFT, CampaignStatus.COMPLETED, CampaignStatus.CANCELLED, CampaignStatus.FAILED] as const;

export class CampaignService {
  async list(organizationId: number): Promise<CampaignDto[]> {
    const [rows, channels] = await Promise.all([campaignRepository.list(organizationId), whatsAppService.getConnections(organizationId)]);
    const [stats, names] = await Promise.all([
      campaignRepository.stats(rows.map((r) => r.id)),
      campaignRepository.userNames(rows.flatMap((r) => (r.createdById ? [r.createdById] : []))),
    ]);
    const byId = new Map(channels.map((c) => [c.id, c]));
    return rows.map((c) =>
      toDto(c, stats.get(c.id) ?? emptyStats(), c.channelId ? byId.get(c.channelId) : undefined, c.createdById ? names.get(c.createdById) : undefined)
    );
  }

  async get(organizationId: number, id: number): Promise<CampaignDto> {
    const campaign = await this.require(organizationId, id);
    return this.dto(campaign, true);
  }

  async create(organizationId: number, userId: number, body: Body): Promise<CampaignDto> {
    const patch = await draftPatch(organizationId, body);
    const campaign = await campaignRepository.create({
      ...patch,
      name: parseName(body.name),
      organizationId,
      createdById: userId,
      status: CampaignStatus.DRAFT,
    });
    log.info("Campaign created", { organizationId, campaignId: campaign.id });
    return this.dto(campaign, false);
  }

  /** Edits a draft. Scheduled and later campaigns are locked. */
  async update(organizationId: number, id: number, body: Body): Promise<CampaignDto> {
    await this.makeEditable(organizationId, id);
    const patch = await draftPatch(organizationId, body);
    const updated = await campaignRepository.update(id, organizationId, patch, [CampaignStatus.DRAFT]);
    if (!updated) throw this.notEditable();
    return this.dto(updated, true);
  }

  /** Parses the uploaded file, keeps it in S3 and replaces the draft's recipients */
  async importAudience(
    organizationId: number,
    id: number,
    file: File,
    options: { phoneColumn: string; defaultCountry: string }
  ): Promise<CampaignDto> {
    await this.makeEditable(organizationId, id);
    if (file.size > MAX_FILE_BYTES) throw AppError.validation("The file is larger than 10 MB.", "file");

    let audience;
    try {
      const sheet = await parseContactFile(file);
      if (sheet.rows.length === 0) throw new SheetError("This file has no contacts.");
      if (sheet.rows.length > MAX_ROWS) throw new SheetError(`The file has more than ${MAX_ROWS.toLocaleString()} rows.`);
      if (!sheet.columns.includes(options.phoneColumn)) throw new SheetError(`The file has no column named "${options.phoneColumn}".`);
      audience = buildAudience(sheet, { fileName: file.name, fileSize: file.size, ...options });
    } catch (err) {
      if (err instanceof SheetError) throw AppError.validation(err.message, "file");
      throw err;
    }
    if (audience.recipientCount === 0) throw AppError.validation("No valid phone numbers were found in this file.", "file");

    let sourceFileKey: string | null = null;
    if (process.env.AWS_S3_BUCKET) {
      const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
      // Same layout as the rest of the bucket: organizations/{orgId}/campaigns/{campaignId}/{uuid}.{ext}
      sourceFileKey = `${campaignFilePrefix(organizationId, id)}${crypto.randomUUID()}${/^\.(csv|xlsx|xls)$/.test(ext) ? ext : ""}`;
      await putObject(sourceFileKey, Buffer.from(await file.arrayBuffer()), file.type || "application/octet-stream");
    }

    const inserted = await campaignRepository.replaceRecipients(id, organizationId, audience.recipients);
    const { recipients: _all, ...summary } = audience;
    void _all;
    const updated = await campaignRepository.update(
      id,
      organizationId,
      {
        audience: { ...summary, rejected: summary.rejected.slice(0, STORED_REJECTED_ROWS) },
        recipientCount: inserted,
        sourceFileKey,
      },
      [CampaignStatus.DRAFT]
    );
    if (!updated) throw this.notEditable();
    log.info("Campaign audience imported", { organizationId, campaignId: id, recipients: inserted, skipped: summary.rejectedCount });
    return this.dto(updated, true);
  }

  /** Checks everything, refreshes the template from Meta, then draft → scheduled with an EventBridge schedule */
  async schedule(organizationId: number, id: number): Promise<CampaignDto> {
    const campaign = await this.require(organizationId, id);
    if (campaign.status !== CampaignStatus.DRAFT) throw new AppError("CONFLICT", { message: "Only a draft can be scheduled.", expected: true });

    const problems: string[] = [];
    if (campaign.recipientCount === 0) problems.push("Upload a contact file.");
    if (!campaign.phoneNumberId) problems.push("Choose the WhatsApp number to send from.");
    if (!campaign.template) problems.push("Choose a template.");
    const startAt = campaign.scheduledAt;
    if (!startAt) problems.push("Pick a start date and time.");
    else if (startAt.getTime() < Date.now() + MIN_LEAD_MS) problems.push("Pick a start time at least a minute from now.");
    else if (startAt.getTime() > Date.now() + MAX_LEAD_MS) problems.push("Pick a start time within a year.");
    if (!campaign.intervalSeconds) problems.push("Set a delay of 1 second to 15 minutes between contacts.");
    if (problems.length) throw AppError.validation(problems.join(" "), "campaign");

    await resolveChannel(organizationId, campaign.phoneNumberId!);
    const template = await this.currentTemplate(organizationId, campaign.phoneNumberId!, campaign.template!);
    const missing = unmappedFields(template, campaign.variables ?? {}, campaign.audience?.emptyCells);
    if (missing.length) {
      throw AppError.validation(
        `Fill these template variables: ${missing.map((f) => f.label).join(", ")}. A column that is empty for some contacts needs a value to use when empty.`,
        "variables"
      );
    }
    const columns = new Set(campaign.audience?.columns ?? []);
    const badColumn = Object.values(campaign.variables ?? {}).find((v) => v.type === "column" && !columns.has(v.column));
    if (badColumn?.type === "column") throw AppError.validation(`The column "${badColumn.column}" isn't in the contact file anymore.`, "variables");

    const scheduled = await campaignRepository.markScheduled(id, organizationId, { template, lastError: null });
    if (scheduled === "busy") throw await this.workspaceBusy(organizationId);
    if (!scheduled) throw this.notEditable();
    try {
      const scheduleName = await upsertStartSchedule(id, startAt!);
      const withSchedule = scheduleName ? await campaignRepository.update(id, organizationId, { scheduleName }) : scheduled;
      log.info("Campaign scheduled", { organizationId, campaignId: id, startAt: startAt!.toISOString(), eventBridge: Boolean(scheduleName) });
      return this.dto(withSchedule ?? scheduled, true);
    } catch (err) {
      await campaignRepository.update(id, organizationId, { status: CampaignStatus.DRAFT }, [CampaignStatus.SCHEDULED]);
      throw AppError.wrap(err, "INTERNAL_ERROR", { message: "Couldn't create the schedule. The campaign is still a draft; try again." });
    }
  }

  async pause(organizationId: number, id: number): Promise<CampaignDto> {
    const updated = await campaignRepository.update(
      id,
      organizationId,
      { status: CampaignStatus.PAUSED, pauseReason: CampaignPauseReason.MANUAL },
      [CampaignStatus.RUNNING]
    );
    if (!updated) throw new AppError("CONFLICT", { message: "Only a campaign that is sending can be paused.", expected: true });
    log.info("Campaign paused", { organizationId, campaignId: id });
    return this.dto(updated, false);
  }

  async resume(organizationId: number, id: number): Promise<CampaignDto> {
    const campaign = await this.require(organizationId, id);
    if (campaign.phoneNumberId) await resolveChannel(organizationId, campaign.phoneNumberId);
    const resumed = await resumeCampaign(id, organizationId);
    if (resumed === "busy") throw await this.workspaceBusy(organizationId);
    if (!resumed) throw new AppError("CONFLICT", { message: "Only a paused campaign can be resumed.", expected: true });
    log.info("Campaign resumed", { organizationId, campaignId: id });
    return this.dto(resumed, false);
  }

  /** One campaign at a time per workspace: names the one that holds the slot */
  private async workspaceBusy(organizationId: number): Promise<AppError> {
    const active = await campaignRepository.findActive(organizationId);
    const name = active ? `"${active.name}"` : "Another campaign";
    const state =
      active?.status === CampaignStatus.SCHEDULED
        ? "is scheduled: wait until it finishes, or cancel it."
        : "is sending: wait until it finishes, or pause or cancel it.";
    return new AppError("CONFLICT", {
      message: `Only one campaign can run at a time in this workspace. ${name} ${state}`,
      expected: true,
    });
  }

  /** One page of the campaign's contacts with their status, times, error and Meta pricing */
  async recipients(
    organizationId: number,
    id: number,
    query: { page: number; limit: number; offset: number; status?: string; search?: string }
  ): Promise<{ items: CampaignRecipientDto[]; total: number }> {
    await this.require(organizationId, id);
    let statuses: RecipientStatus[] | undefined;
    if (query.status) {
      statuses = RECIPIENT_FILTERS[query.status];
      if (!statuses) throw AppError.validation(`status must be one of: ${Object.keys(RECIPIENT_FILTERS).join(", ")}.`, "status");
    }
    const { rows, total } = await campaignRepository.recipientsList(id, { offset: query.offset, limit: query.limit, statuses, search: query.search });
    return { items: rows.map(recipientDto), total };
  }

  /**
   * The campaign's full log as CSV: every contact with the columns of the uploaded file, then what happened
   * (status, times, error, Meta pricing). Streamed in pages, so large campaigns don't load into memory.
   */
  async exportLogs(organizationId: number, id: number): Promise<{ filename: string; stream: ReadableStream<Uint8Array> }> {
    const campaign = await this.require(organizationId, id);
    const fileColumns = (campaign.audience?.columns ?? []).filter((c) => c !== campaign.audience?.phoneColumn);
    const header = [
      "phone",
      ...fileColumns,
      "status",
      "error_code",
      "error_message",
      "attempts",
      "sent_at",
      "delivered_at",
      "read_at",
      "billable",
      "pricing_category",
      "pricing_model",
    ];
    const iso = (d: Date | null) => (d ? d.toISOString() : "");
    const encoder = new TextEncoder();
    let afterId = 0;
    let started = false;

    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (!started) {
          started = true;
          // BOM so Excel opens UTF-8 (names in Tamil, Hindi…) correctly
          controller.enqueue(encoder.encode("﻿" + header.map(csvCell).join(",") + "\r\n"));
          return;
        }
        const rows = await campaignRepository.recipientsPage(id, afterId, EXPORT_PAGE);
        if (rows.length === 0) {
          controller.close();
          return;
        }
        afterId = rows[rows.length - 1].id;
        const lines = rows.map((r) =>
          [
            csvPhone(r.phone),
            ...fileColumns.map((c) => csvCell(r.fields?.[c] ?? "")),
            csvCell(r.status),
            csvCell(r.errorCode != null ? String(r.errorCode) : ""),
            csvCell(r.errorMessage ?? ""),
            String(r.attempts),
            iso(r.sentAt),
            iso(r.deliveredAt),
            iso(r.readAt),
            r.billable == null ? "" : r.billable ? "yes" : "no",
            csvCell(r.pricingCategory ?? ""),
            csvCell(r.pricingModel ?? ""),
          ].join(",")
        );
        controller.enqueue(encoder.encode(lines.join("\r\n") + "\r\n"));
      },
    });

    const slug = campaign.name.replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "campaign";
    log.info("Campaign logs exported", { organizationId, campaignId: id, recipients: campaign.recipientCount });
    return { filename: `campaign-${id}-${slug}-logs.csv`, stream };
  }

  /** Stops for good: contacts not reached yet won't get the message; sent messages stay sent */
  async cancel(organizationId: number, id: number): Promise<CampaignDto> {
    const campaign = await this.require(organizationId, id);
    const updated = await campaignRepository.update(
      id,
      organizationId,
      { status: CampaignStatus.CANCELLED, completedAt: new Date(), scheduleName: null },
      [CampaignStatus.SCHEDULED, CampaignStatus.RUNNING, CampaignStatus.PAUSED]
    );
    if (!updated) throw new AppError("CONFLICT", { message: "This campaign has already finished.", expected: true });
    await deleteStartSchedule(campaign.scheduleName);
    const cancelled = await campaignRepository.cancelPending(id);
    log.info("Campaign cancelled", { organizationId, campaignId: id, cancelledRecipients: cancelled });
    return this.dto(updated, false);
  }

  async duplicate(organizationId: number, userId: number, id: number): Promise<CampaignDto> {
    const source = await this.require(organizationId, id);
    const copy = await campaignRepository.create({
      organizationId,
      createdById: userId,
      name: `${source.name.slice(0, MAX_NAME_LENGTH - 7)} (copy)`,
      status: CampaignStatus.DRAFT,
      channelId: source.channelId,
      phoneNumberId: source.phoneNumberId,
      template: source.template,
      variables: source.variables,
      audience: source.audience,
      sourceFileKey: source.sourceFileKey,
      recipientCount: source.recipientCount,
      timezone: source.timezone,
      intervalSeconds: source.intervalSeconds,
    });
    await campaignRepository.copyRecipients(source.id, copy.id);
    return this.dto(copy, false);
  }

  async delete(organizationId: number, id: number): Promise<void> {
    await this.require(organizationId, id);
    if (!(await campaignRepository.delete(id, organizationId, DELETABLE))) {
      throw new AppError("CONFLICT", { message: "Cancel the campaign before deleting it.", expected: true });
    }
  }

  // ─── helpers ────────────────────────────────────────────────────────────────

  private async require(organizationId: number, id: number): Promise<Campaign> {
    const campaign = Number.isInteger(id) ? await campaignRepository.findById(id, organizationId) : null;
    if (!campaign) throw AppError.notFound("Campaign not found.");
    return campaign;
  }

  private notEditable() {
    return new AppError("CONFLICT", {
      message: "Only a draft can be edited. Once scheduled, a campaign (and its contact list) can't be changed: cancel it and duplicate it instead.",
      expected: true,
    });
  }

  /** Only drafts can be edited; from scheduled on, the campaign and its contact list are locked */
  private async makeEditable(organizationId: number, id: number) {
    const campaign = await this.require(organizationId, id);
    if (campaign.status !== CampaignStatus.DRAFT) throw this.notEditable();
  }

  /** The template as Meta has it now; it must still be approved and sendable */
  private async currentTemplate(organizationId: number, phoneNumberId: string, snapshot: WhatsAppTemplate): Promise<WhatsAppTemplate> {
    const res = await whatsAppService.getTemplates(organizationId, { phoneNumberId, name: snapshot.name, language: snapshot.language });
    const live = (res.templates as WhatsAppTemplate[]).find((t) => t.name === snapshot.name && t.language === snapshot.language);
    if (!live) throw AppError.validation(`The template "${snapshot.name}" (${snapshot.language}) no longer exists on this WhatsApp account.`, "template");
    const blocker = getTemplateSendBlocker(live);
    if (blocker) throw AppError.validation(`The template "${snapshot.name}" can't be sent: ${blocker}`, "template");
    return live;
  }

  private async dto(campaign: Campaign, withPreview: boolean): Promise<CampaignDto> {
    const [stats, preview, channel, names] = await Promise.all([
      campaignRepository.stats([campaign.id]),
      withPreview ? campaignRepository.previewRecipients(campaign.id, PREVIEW_RECIPIENTS) : Promise.resolve([]),
      campaign.channelId ? channelRepository.findById(campaign.channelId, campaign.organizationId) : Promise.resolve(null),
      campaignRepository.userNames(campaign.createdById ? [campaign.createdById] : []),
    ]);
    const creator = campaign.createdById ? names.get(campaign.createdById) : undefined;
    return toDto(campaign, stats.get(campaign.id) ?? emptyStats(), channel ?? undefined, creator, preview);
  }
}

export const campaignService = new CampaignService();
