import crypto from "crypto";
import { channelRepository, customerRepository, normalizePhone, whatsappFlowRepository } from "../../db/repositories";
import {
  SENDABLE_VERSION_STATUSES,
  WaFlowExecutionStatus,
  type WaFlowVersionStatusValue,
  type WhatsAppFlowExecutionRow,
} from "../../db/schema";
import { whatsAppService } from "../channels/whatsapp.service";
import { customerService } from "../customer.service";
import { AppError, toAppError } from "@/lib/errors";
import { createLogger } from "@/lib/logger";
import { SENDABLE_TEMPLATE_STATUS } from "./template.service";
import { credentialsForWaba } from "./waba-credentials";

const log = createLogger("WhatsAppFlowSend");

const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;
const DEFAULT_EXPIRY_HOURS = 24;
const MAX_EXPIRY_HOURS = 24 * 30;

export type FlowSendMethod = "template" | "interactive";

export interface SendFlowInput {
  organizationId: number;
  customerId: number;
  flowId: number;
  method: FlowSendMethod;
  /** Required for `template`: an APPROVED template whose FLOW button opens this Flow. */
  templateId?: number | null;
  /** `interactive` only. */
  cta?: string;
  bodyText?: string;
  headerText?: string;
  footerText?: string;
  /** How long to wait for a response before the execution counts as expired. */
  expiresInHours?: number;
  userId?: number | null;
  automationRunId?: number | null;
  automationNodeId?: string | null;
}

export interface SendFlowTestInput {
  organizationId: number;
  flowId: number;
  templateId: number;
  /** International format with country code; any formatting is stripped. */
  phone: string;
  userId?: number | null;
}

/** Unguessable, unique per send. Never derived from customer data. */
export const newFlowToken = () => `unx_${crypto.randomBytes(24).toString("base64url")}`;

export class WhatsAppFlowSendService {
  /**
   * Sends a published Flow to one customer and records the execution (flow_token ↔ customer ↔ version).
   * - template: allowed any time; the template must be APPROVED and point at this Flow.
   * - interactive: only within 24h of the customer's last message (WhatsApp customer service window).
   */
  async send(input: SendFlowInput): Promise<WhatsAppFlowExecutionRow> {
    const { organizationId } = input;
    const flow = await whatsappFlowRepository.findFlow(input.flowId, organizationId);
    if (!flow || flow.archivedAt) throw AppError.notFound("WhatsApp Flow not found.");

    const customer = await customerService.requireVisible(input.customerId, organizationId);
    if (!customer.phone) throw AppError.validation("This contact has no WhatsApp phone number.", "customerId");

    // ── Resolve the exact version to send ──
    let template = null;
    let versionId = flow.publishedVersionId;
    if (input.method === "template") {
      if (!input.templateId) throw AppError.validation("Choose an approved template for this Flow.", "templateId");
      template = await whatsappFlowRepository.findTemplate(input.templateId, organizationId);
      if (!template || template.flowId !== flow.id) {
        throw AppError.validation("The selected template doesn't open this Flow.", "templateId");
      }
      if (template.status !== SENDABLE_TEMPLATE_STATUS) {
        throw new AppError("MESSAGE_TEMPLATE_INVALID", {
          message: `Template "${template.name}" is ${template.status.toLowerCase()}; only approved templates can be sent.`,
          expected: true,
        });
      }
      versionId = template.flowVersionId; // the template pins its own version
    } else if (input.method !== "interactive") {
      throw AppError.validation("Sending method must be template or interactive.", "method");
    }

    const version = versionId ? await whatsappFlowRepository.findVersion(versionId, organizationId) : null;
    if (!version?.metaFlowId || !SENDABLE_VERSION_STATUSES.includes(version.status as WaFlowVersionStatusValue)) {
      throw new AppError("CONFLICT", {
        message: "This Flow has no published version that can be sent. Publish it (or re-sync its status) first.",
        expected: true,
      });
    }

    if (input.method === "interactive") {
      const last = await whatsappFlowRepository.lastCustomerMessageAt(organizationId, customer.id);
      if (!last || Date.now() - last.getTime() > SERVICE_WINDOW_MS) {
        throw new AppError("MESSAGE_WINDOW_EXPIRED", { expected: true });
      }
      const cta = input.cta?.trim();
      const body = input.bodyText?.trim();
      if (!cta) throw AppError.validation("Button text (CTA) is required.", "cta");
      if (!body) throw AppError.validation("Message text is required.", "bodyText");
    }

    // A Flow (and its templates) live on one WABA: send from a number on that WABA,
    // preferring the number the customer already talks to
    const customerChannel = customer.channelId ? await channelRepository.findById(customer.channelId, organizationId) : null;
    const sendChannelId =
      customerChannel?.wabaId === version.wabaId ? customerChannel.id : template?.channelId ?? null;
    if (!sendChannelId) {
      throw new AppError("CONFLICT", {
        message: "This contact's WhatsApp number is on a different WhatsApp Business Account than the Flow.",
        expected: true,
      });
    }

    const hours = Math.min(Math.max(Number(input.expiresInHours) || DEFAULT_EXPIRY_HOURS, 1), MAX_EXPIRY_HOURS);
    const execution = await whatsappFlowRepository.createExecution({
      organizationId,
      flowId: flow.id,
      flowVersionId: version.id,
      customerId: customer.id,
      channelId: sendChannelId,
      templateId: template?.id ?? null,
      automationRunId: input.automationRunId ?? null,
      automationNodeId: input.automationNodeId ?? null,
      sendMethod: input.method,
      flowToken: newFlowToken(),
      status: WaFlowExecutionStatus.PENDING,
      createdById: input.userId ?? null,
    });

    const label = `📋 ${flow.name}`;
    try {
      const result =
        input.method === "template"
          ? await whatsAppService.sendMessage({
              organizationId,
              customerId: customer.id,
              channelId: sendChannelId,
              senderId: input.userId ?? null,
              to: customer.phone,
              type: "template",
              templateName: template!.name,
              languageCode: template!.language,
              text: `${label} · template ${template!.name}`,
              components: [
                {
                  type: "button",
                  sub_type: "flow",
                  index: String(template!.flowButtonIndex ?? 0),
                  parameters: [{ type: "action", action: { flow_token: execution.flowToken } }],
                },
              ],
              metadata: { whatsappFlow: { flowId: flow.id, executionId: execution.id, versionId: version.id } },
            })
          : await whatsAppService.sendMessage({
              organizationId,
              customerId: customer.id,
              channelId: sendChannelId,
              senderId: input.userId ?? null,
              to: customer.phone,
              type: "interactive",
              text: `${label} · ${input.bodyText!.trim()}`,
              interactiveFlow: {
                flowId: version.metaFlowId,
                flowToken: execution.flowToken,
                cta: input.cta!.trim(),
                bodyText: input.bodyText!.trim(),
                headerText: input.headerText?.trim() || undefined,
                footerText: input.footerText?.trim() || undefined,
                screen: version.definition.screens[0].id,
              },
              metadata: { whatsappFlow: { flowId: flow.id, executionId: execution.id, versionId: version.id } },
            });

      const wamid = (result.metaResponse as { messages?: { id?: string }[] } | null)?.messages?.[0]?.id ?? null;
      const now = new Date();
      const sent = await whatsappFlowRepository.updateExecution(execution.id, {
        status: WaFlowExecutionStatus.SENT,
        metaMessageId: wamid,
        channelId: result.channel?.id ?? execution.channelId,
        sentAt: now,
        expiresAt: new Date(now.getTime() + hours * 60 * 60 * 1000),
      });
      log.info("WhatsApp Flow sent", { executionId: execution.id, flowId: flow.id, method: input.method, wamid });
      return sent!;
    } catch (err) {
      const appErr = toAppError(err);
      await whatsappFlowRepository.updateExecution(execution.id, { status: WaFlowExecutionStatus.FAILED, lastError: appErr.message });
      throw appErr;
    }
  }

  /**
   * Test send: delivers an approved template of this Flow to any WhatsApp number, from a live number on
   * the template's WABA. The number is resolved to a contact on that number (created when new, as any
   * outbound send does), so the real send path runs and the tester's response is recorded like any other.
   */
  async sendTest(input: SendFlowTestInput) {
    const { organizationId } = input;
    const phone = normalizePhone(input.phone);
    if (!phone || phone.length < 8 || phone.length > 15) {
      throw AppError.validation("Enter a valid WhatsApp number with its country code, e.g. +91 98765 43210.", "phone");
    }
    if (!input.templateId) throw AppError.validation("Choose an approved template for this Flow.", "templateId");
    const template = await whatsappFlowRepository.findTemplate(input.templateId, organizationId);
    if (!template || template.flowId !== input.flowId) {
      throw AppError.validation("The selected template doesn't open this Flow.", "templateId");
    }

    // Templates belong to a WABA: send from the template's own number when still live, else another live one on it
    const live = await credentialsForWaba(organizationId, template.wabaId, template.channelId);
    const channel = live.channel;

    const customer = await customerRepository.createCustomer(organizationId, { name: phone, phone, channelId: channel.id });
    if (!customer) throw new AppError("INTERNAL_ERROR", { message: "Couldn't prepare the test recipient." });

    const execution = await this.send({
      organizationId,
      customerId: customer.id,
      flowId: input.flowId,
      method: "template",
      templateId: template.id,
      userId: input.userId ?? null,
    });
    log.info("WhatsApp Flow test sent", { executionId: execution.id, flowId: input.flowId, templateId: template.id });
    return {
      execution,
      to: phone,
      from: { channelId: channel.id, name: channel.name, phoneNumber: channel.phoneNumber },
    };
  }
}

export const whatsappFlowSendService = new WhatsAppFlowSendService();
