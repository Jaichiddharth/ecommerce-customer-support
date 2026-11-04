import { customerRepository, messageRepository } from "../db/repositories";
import type { Customer } from "../db/schema";
import { publish } from "@/lib/realtime";
import { AppError, toAppError } from "@/lib/errors";
import { createLogger } from "@/lib/logger";
import { whatsAppService } from "./channels/whatsapp.service";
import {
  CONSENT_CONFIRMATIONS,
  CONSENT_SOURCE_LABELS,
  OPT_IN_KEYWORDS,
  OPT_OUT_KEYWORDS,
  consentStatusOf,
  type ConsentChange,
  type ConsentSource,
  type ConsentStatus,
} from "@/types/consent";

const log = createLogger("ConsentService");

// Keywords are compared after the same normalization as the customer's message (NFKC, uppercase)
const OPT_OUT = OPT_OUT_KEYWORDS.map((k) => normalizeKeyword(k));
const OPT_IN = OPT_IN_KEYWORDS.map((k) => normalizeKeyword(k));

/** Sources where the customer acted themselves, so they get a confirmation message */
const CONFIRMED_SOURCES: ConsentSource[] = ["keyword", "meta_preferences"];

/** "  stop! " → "STOP"; "Stop   Promotions" → "STOP PROMOTIONS" */
export function normalizeKeyword(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/^[\s\p{P}\p{S}]+|[\s\p{P}\p{S}]+$/gu, "")
    .replace(/\s+/g, " ")
    .toUpperCase();
}

/** Texts in an inbound WhatsApp message that may hold a consent keyword: typed text or a tapped quick reply */
export function consentKeywordCandidates(msg: any): string[] {
  const candidates: unknown[] = [];
  if (msg?.type === "text") candidates.push(msg.text?.body);
  if (msg?.type === "button") candidates.push(msg.button?.text, msg.button?.payload);
  if (msg?.type === "interactive" && msg.interactive?.type === "button_reply") {
    candidates.push(msg.interactive.button_reply?.title, msg.interactive.button_reply?.id);
  }
  return candidates.filter((c): c is string => typeof c === "string" && c.trim().length > 0 && c.length <= 100);
}

/** The consent change a message asks for, or null when it isn't a consent keyword */
export function matchConsentKeyword(candidates: string[]): { status: ConsentStatus; keyword: string; text: string } | null {
  for (const text of candidates) {
    const normalized = normalizeKeyword(text);
    if (OPT_OUT.includes(normalized)) return { status: "opted_out", keyword: normalized, text: text.trim() };
    if (OPT_IN.includes(normalized)) return { status: "opted_in", keyword: normalized, text: text.trim() };
  }
  return null;
}

export interface ConsentChangeInput {
  organizationId: number;
  customerId: number;
  status: ConsentStatus;
  source: ConsentSource;
  reason: string;
  keyword?: string | null;
  metaMessageId?: string | null;
  changedBy?: { id: number; name: string | null } | null;
  /** When the customer acted; defaults to now */
  occurredAt?: Date;
}

export interface ConsentChangeResult {
  customer: Customer;
  /** False when the contact already had this status: nothing was recorded */
  changed: boolean;
}

export class ConsentService {
  /**
   * Changes a contact's WhatsApp consent and records it in the consent log: a team-only system note in
   * the contact's thread holding the status, source, reason and time. Nothing is recorded when the status
   * doesn't change. The confirmation message to the customer is separate: see sendConfirmation.
   */
  async changeStatus(input: ConsentChangeInput): Promise<ConsentChangeResult> {
    const optedOut = input.status === "opted_out";
    const result = await customerRepository.setOptedOut(input.customerId, input.organizationId, optedOut);
    if (!result) throw AppError.notFound("Customer not found.");

    const { customer, changed } = result;
    if (!changed) {
      log.debug("Consent unchanged", { customerId: customer.id, status: input.status, source: input.source });
      return result;
    }

    const occurredAt = input.occurredAt ?? new Date();
    const change: ConsentChange = {
      status: input.status,
      previousStatus: optedOut ? "opted_in" : "opted_out",
      source: input.source,
      reason: input.reason,
      keyword: input.keyword ?? null,
      metaMessageId: input.metaMessageId ?? null,
      changedById: input.changedBy?.id ?? null,
      changedByName: input.changedBy?.name ?? null,
      occurredAt: occurredAt.toISOString(),
    };

    log.info(`Contact ${optedOut ? "opted out of" : "opted in to"} WhatsApp messages`, {
      organizationId: input.organizationId,
      customerId: customer.id,
      channelId: customer.channelId,
      ...change,
    });

    publish(input.organizationId, { type: "customer.consent", customerId: customer.id, isOptedOut: optedOut });

    // The consent log. The status change above already happened, so a failure here is logged, never thrown.
    try {
      const note = await messageRepository.createMessage({
        organizationId: input.organizationId,
        customerId: customer.id,
        channelId: customer.channelId ?? null,
        senderType: "system",
        senderId: input.changedBy?.id ?? null,
        textContent: `${optedOut ? "Opted out of" : "Opted in to"} WhatsApp messages · ${CONSENT_SOURCE_LABELS[input.source]} · ${input.reason}`,
        isInternalNote: true,
        metadata: { consent: change },
        createdAt: new Date(),
      });
      if (note) {
        publish(input.organizationId, {
          type: "message.new",
          customerId: customer.id,
          customer: { id: customer.id, name: customer.name, phone: customer.phone, channelId: customer.channelId },
          message: { ...note, senderName: input.changedBy?.name ?? null },
        });
      }
    } catch (err) {
      log.error("Consent changed but the consent log note could not be saved", { err, customerId: customer.id, change });
    }

    return result;
  }

  /**
   * Tells the customer their opt-out / opt-in went through. Only for changes the customer made themselves, and only
   * possible inside WhatsApp's 24-hour window (it's a free-form message); otherwise it's skipped. Never throws.
   */
  async sendConfirmation(organizationId: number, customer: Customer, status: ConsentStatus, source: ConsentSource): Promise<void> {
    if (!CONFIRMED_SOURCES.includes(source) || !customer.phone) return;
    try {
      await whatsAppService.sendMessage({
        organizationId,
        customerId: customer.id,
        channelId: customer.channelId ?? undefined,
        to: customer.phone,
        text: CONSENT_CONFIRMATIONS[status],
        senderType: "system",
        // The customer just opted out: this confirmation is the last message they receive until they reply START
        allowOptedOut: status === "opted_out",
        metadata: { consentConfirmation: status },
      });
      log.info("Consent confirmation sent", { customerId: customer.id, status });
    } catch (err) {
      const appErr = toAppError(err);
      if (appErr.code === "MESSAGE_WINDOW_EXPIRED") {
        log.info("Consent confirmation skipped: the 24-hour window is closed", { customerId: customer.id, status });
        return;
      }
      log.warn("Consent confirmation could not be sent", { err: appErr, customerId: customer.id, status });
    }
  }

  /** A teammate changes the consent from the inbox (e.g. the customer asked on a call). No message is sent. */
  async changeByAgent(
    organizationId: number,
    customerId: number,
    status: ConsentStatus,
    agent: { id: number; name: string | null },
    reason?: string | null
  ): Promise<ConsentChangeResult> {
    const contact = await customerRepository.findById(customerId, organizationId);
    if (!contact) throw AppError.notFound("Customer not found.");
    if (consentStatusOf(contact.isOptedOut) === status) return { customer: contact, changed: false };

    const note = reason?.trim().slice(0, 300);
    return this.changeStatus({
      organizationId,
      customerId,
      status,
      source: "agent",
      reason: note || `Changed by ${agent.name || "a teammate"} in the inbox`,
      changedBy: agent,
    });
  }
}

export const consentService = new ConsentService();
