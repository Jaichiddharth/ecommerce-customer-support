import crypto from 'crypto';
import { messageRepository, customerRepository, channelRepository, messageReactionRepository } from '../../db/repositories';
import { MessageStatus, MESSAGE_STATUS_VALUES } from '../../db/schema';
import { publish } from '@/lib/realtime';
import { AppError, describeMessageFailure, getMetaErrorInfo } from '@/lib/errors';
import { createLogger } from '@/lib/logger';
import { automationEngine } from '@/lib/automation/engine';
import { whatsappFlowService } from '../whatsapp-flows/flow.service';
import { whatsappTemplateService } from '../whatsapp-flows/template.service';
import { whatsappFlowSubmissionService, parseFlowReply, summarizeFlowReply } from '../whatsapp-flows/flow-submission.service';
import { consentService, consentKeywordCandidates, matchConsentKeyword } from '../consent.service';

const log = createLogger('WhatsAppWebhook');

/** Meta error code: the recipient has stopped marketing messages from this business */
const META_MARKETING_OPTED_OUT = 131050;

export interface WebhookVerificationParams {
  mode: string | null;
  verifyToken: string | null;
  challenge: string | null;
}

export interface WebhookVerificationResult {
  isValid: boolean;
  challenge: string | null;
  reason?: string;
}

export interface WebhookProcessingResult {
  success: boolean;
  processedMessages: number;
  processedStatuses: number;
  duplicatesIgnored: number;
  failed: number;
}

/** Everything known about the channel a webhook change belongs to. */
interface ChangeContext {
  orgId: number;
  channelId: number;
  wabaId?: string;
  phoneNumberId: string;
  contactMap: Map<string, string>;
  defer: (task: () => Promise<void>) => void;
}

export interface WebhookProcessingOptions {
  /**
   * Runs slow follow-up work (automations, Flow resumption) after the HTTP response is sent
   * (the route passes Next's `after`). Without it, the work is awaited before returning.
   */
  defer?: (task: () => Promise<void>) => void;
}

export class WhatsAppWebhookService {
  /**
   * 1. Webhook Verification (GET request handler)
   * Responds to Meta verification challenge
   */
  verifyWebhook(params: WebhookVerificationParams): WebhookVerificationResult {
    const { mode, verifyToken, challenge } = params;
    const expectedToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;

    if (!expectedToken) {
      log.error('WHATSAPP_WEBHOOK_VERIFY_TOKEN is not configured — webhook verification will always fail');
    }

    if (mode === 'subscribe' && expectedToken && verifyToken === expectedToken) {
      log.info('Webhook verification succeeded');
      return { isValid: true, challenge: challenge || '' };
    }

    log.warn('Webhook verification failed', {
      mode,
      tokenProvided: Boolean(verifyToken),
      tokenMatches: false,
    });
    return { isValid: false, challenge: null, reason: 'Invalid verification token or mode.' };
  }

  /**
   * 2. Signature Verification (POST request security)
   * Validates Meta HMAC-SHA256 signature in X-Hub-Signature-256 header
   */
  verifySignature(rawBody: string, signatureHeader: string | null): boolean {
    const appSecret = process.env.META_APP_SECRET || process.env.NEXT_PUBLIC_META_APP_SECRET;

    if (!appSecret) {
      // Without the secret anyone could post fake messages — only tolerated in development
      if (process.env.NODE_ENV === 'production') {
        throw new AppError('WEBHOOK_MISCONFIGURED', {
          cause: new Error('META_APP_SECRET is not configured; cannot verify X-Hub-Signature-256'),
        });
      }
      log.warn('META_APP_SECRET not configured — skipping webhook signature validation (development only)');
      return true;
    }

    if (!signatureHeader) {
      log.warn('Webhook rejected: missing X-Hub-Signature-256 header');
      return false;
    }

    const [algorithm, signature] = signatureHeader.split('=');
    if (algorithm !== 'sha256' || !signature) {
      log.warn('Webhook rejected: invalid signature format (expected sha256=…)', { algorithm });
      return false;
    }

    try {
      const expectedSignature = crypto
        .createHmac('sha256', appSecret)
        .update(rawBody, 'utf8')
        .digest('hex');

      const expectedBuffer = Buffer.from(expectedSignature, 'hex');
      const signatureBuffer = Buffer.from(signature, 'hex');

      if (expectedBuffer.length !== signatureBuffer.length) {
        log.warn('Webhook rejected: signature length mismatch');
        return false;
      }

      const valid = crypto.timingSafeEqual(expectedBuffer, signatureBuffer);
      if (!valid) log.warn('Webhook rejected: signature does not match (check META_APP_SECRET)');
      return valid;
    } catch (err) {
      log.error('Error while verifying webhook HMAC signature', { err });
      return false;
    }
  }

  /**
   * 3. Process Incoming Webhook Payload (Messages, Statuses, System Events)
   * Each message / status is processed independently: one failure is logged with full context
   * and does not stop the rest of the batch.
   */
  async processWebhookPayload(payload: any, options: WebhookProcessingOptions = {}): Promise<WebhookProcessingResult> {
    const inlineTasks: Promise<void>[] = [];
    const defer =
      options.defer ??
      ((task: () => Promise<void>) => {
        inlineTasks.push(task());
      });
    const result: WebhookProcessingResult = {
      success: true,
      processedMessages: 0,
      processedStatuses: 0,
      duplicatesIgnored: 0,
      failed: 0,
    };

    if (payload?.object !== 'whatsapp_business_account' && payload?.object !== 'page') {
      log.info('Ignoring non-WhatsApp webhook object', { object: payload?.object ?? null });
      return result;
    }

    for (const entry of payload.entry || []) {
      const wabaId: string | undefined = entry.id;

      for (const change of entry.changes || []) {
        const field = change.field;
        const value = change.value;

        // WABA-level lifecycle events for Flows and message templates (tenant resolved from the stored row)
        if ((field === 'flows' || field === 'message_template_status_update') && value) {
          try {
            if (field === 'flows') {
              await whatsappFlowService.applyStatusWebhook(wabaId, value);
            } else {
              await whatsappTemplateService.applyStatusWebhook(wabaId, value);
              // Notify open Templates pages on every workspace with a live number on this WABA
              if (wabaId) await this.processTemplateStatusUpdate(wabaId, value);
            }
            result.processedStatuses++;
          } catch (err) {
            result.failed++;
            log.error('Failed to process WABA lifecycle webhook', {
              err,
              field,
              wabaId,
              templateId: value?.message_template_id,
              event: value?.event,
            });
          }
          continue;
        }

        // `messages`: inbound messages and delivery statuses. `user_preferences`: the customer stopped or resumed
        // marketing messages inside WhatsApp (the app must be subscribed to this field in the Meta App dashboard).
        if ((field !== 'messages' && field !== 'user_preferences') || !value) {
          log.info('Ignoring webhook change', { field, wabaId });
          continue;
        }

        const phoneNumberId: string | undefined = value.metadata?.phone_number_id;

        // Resolve the owning Channel (and therefore Organization) by Meta Phone Number ID.
        // Never guess: an unknown number is skipped so data can't land in another tenant's inbox.
        let matchedChannel;
        try {
          matchedChannel = phoneNumberId ? await channelRepository.findByMetaPhoneNumberId(phoneNumberId) : null;
        } catch (err) {
          const itemCount = (value.messages?.length || 0) + (value.statuses?.length || 0);
          result.failed += itemCount;
          log.error('Could not look up channel for webhook change — events in this change were not processed', {
            err,
            phoneNumberId,
            wabaId,
            messages: value.messages?.length || 0,
            statuses: value.statuses?.length || 0,
          });
          continue;
        }

        if (!matchedChannel) {
          log.warn('No channel registered for this phone_number_id — skipping change', {
            phoneNumberId: phoneNumberId ?? null,
            wabaId,
            displayPhone: value.metadata?.display_phone_number,
          });
          continue;
        }

        // Build contact name lookup map: wa_id -> profile name
        const contactMap = new Map<string, string>();
        for (const c of value.contacts || []) {
          if (c.wa_id) {
            const name = c.profile?.name || 'WhatsApp Customer';
            contactMap.set(String(c.wa_id).replace(/\D/g, ''), name);
            contactMap.set(c.wa_id, name);
          }
        }

        const ctx: ChangeContext = {
          orgId: matchedChannel.organizationId,
          channelId: matchedChannel.id,
          wabaId,
          phoneNumberId: phoneNumberId!,
          contactMap,
          defer,
        };

        /* A. Incoming messages */
        for (const msg of value.messages || []) {
          try {
            const outcome = await this.processIncomingMessage(msg, ctx);
            if (outcome === 'duplicate') result.duplicatesIgnored++;
            else result.processedMessages++;
          } catch (err) {
            result.failed++;
            log.error('Failed to process incoming WhatsApp message', {
              err,
              wamid: msg?.id,
              from: msg?.from,
              type: msg?.type,
              orgId: ctx.orgId,
              channelId: ctx.channelId,
            });
          }
        }

        /* B. Message status updates (sent, delivered, read, failed) */
        for (const st of value.statuses || []) {
          try {
            await this.processStatusUpdate(st, ctx);
            result.processedStatuses++;
          } catch (err) {
            result.failed++;
            log.error('Failed to process WhatsApp status update', {
              err,
              wamid: st?.id,
              status: st?.status,
              orgId: ctx.orgId,
              channelId: ctx.channelId,
            });
          }
        }

        /* C. Marketing preference changes (user_preferences field) */
        for (const pref of value.user_preferences || []) {
          try {
            await this.processUserPreference(pref, ctx);
            result.processedStatuses++;
          } catch (err) {
            result.failed++;
            log.error('Failed to process WhatsApp user preference update', {
              err,
              waId: pref?.wa_id,
              category: pref?.category,
              value: pref?.value,
              orgId: ctx.orgId,
              channelId: ctx.channelId,
            });
          }
        }
      }
    }

    if (inlineTasks.length) await Promise.allSettled(inlineTasks);

    result.success = result.failed === 0;
    const summary = {
      messages: result.processedMessages,
      statuses: result.processedStatuses,
      duplicates: result.duplicatesIgnored,
      failed: result.failed,
    };
    if (result.failed > 0) log.warn('Webhook processed with failures', summary);
    else log.info('Webhook processed', summary);

    return result;
  }

  /**
   * Meta reviewed (or paused / disabled) a template: tell every workspace with a live number on that WABA.
   * Templates aren't stored locally, so nothing is saved; open Templates pages update from the event.
   */
  private async processTemplateStatusUpdate(wabaId: string, value: any): Promise<void> {
    const templateId = value.message_template_id != null ? String(value.message_template_id) : '';
    const status = typeof value.event === 'string' ? value.event.toUpperCase() : '';
    if (!templateId || !status) {
      log.warn('Template status update without template id or event — ignored', { wabaId, value });
      return;
    }

    const channels = await channelRepository.findByWabaIdLive(wabaId);
    const orgIds = new Set(channels.map((c) => c.organizationId));
    if (orgIds.size === 0) {
      log.warn('No live channel on this WABA — template status update not delivered', { wabaId, templateId, status });
      return;
    }

    const reason = typeof value.reason === 'string' && value.reason !== 'NONE' ? value.reason : null;
    for (const orgId of orgIds) {
      publish(orgId, {
        type: 'template.status',
        wabaId,
        templateId,
        name: value.message_template_name ?? '',
        language: value.message_template_language ?? '',
        status,
        reason,
      });
    }

    log.info('Template status update delivered', {
      wabaId,
      templateId,
      name: value.message_template_name,
      status,
      reason,
      orgs: orgIds.size,
    });
  }

  /**
   * Save one inbound message (or apply an inbound reaction).
   * Returns what happened so the caller can count it.
   */
  private async processIncomingMessage(msg: any, ctx: ChangeContext): Promise<'saved' | 'duplicate' | 'reaction'> {
    const { orgId, channelId, contactMap } = ctx;
    const messageId = msg.id; // e.g. "wamid.HBgL..."
    const fromPhoneRaw = msg.from; // Customer phone number
    const cleanFromPhone = String(fromPhoneRaw).replace(/\D/g, ''); // Digits only, e.g. "916382726401"
    const contactName = contactMap.get(cleanFromPhone) || contactMap.get(fromPhoneRaw) || 'WhatsApp Customer';
    const msgDate = msg.timestamp ? new Date(Number(msg.timestamp) * 1000) : new Date();
    const messageType = msg.type || 'unknown';

    // Check if message already exists in database by meta_message_id
    if (messageId) {
      const existingMessage = await messageRepository.findByMetaMessageId(messageId, orgId);
      if (existingMessage) {
        log.debug('Duplicate inbound message ignored', { wamid: messageId, existingId: existingMessage.id });
        return 'duplicate';
      }
    }

    // Extract content and summary based on message type
    const parsedContent = this.extractMessageContent(msg);

    // Resolve or Create Customer in DB strictly for THIS Channel. Race-free: two webhooks for the same
    // new number (or a Meta retry racing the original) serialize on an advisory lock and share one contact.
    const resolved = await customerRepository.findOrCreateForChannel(orgId, channelId, cleanFromPhone, contactName);
    let customer = resolved?.customer ?? null;
    if (resolved?.created) {
      log.info('New customer created from inbound message', { customerId: customer?.id, phone: cleanFromPhone, channelId });
    } else if (customer) {
      // Customer for this channel exists - only update profile name or normalize phone
      const updates: any = {};
      if (customer.phone !== cleanFromPhone) {
        updates.phone = cleanFromPhone;
      }
      if (contactName && (!customer.name || customer.name === 'WhatsApp Customer')) {
        updates.name = contactName;
        customer.name = contactName;
      }
      if (Object.keys(updates).length > 0) {
        const updated = await customerRepository.updateCustomer(customer.id, orgId, updates);
        if (updated) customer = updated;
      }
    }

    // Resolve Replied-To Message ID if context is present
    let repliedToId: number | null = null;
    if (msg.context?.id) {
      const parentMessage = await messageRepository.findByMetaMessageId(msg.context.id, orgId);
      if (parentMessage) {
        repliedToId = parentMessage.id;
      }
    }

    // Reactions go to `message_reactions`, never to `messages`
    if (messageType === 'reaction' || msg.reaction) {
      const reactionData = msg.reaction || {};
      const targetMetaMessageId = reactionData.message_id;
      const emoji = reactionData.emoji || '';

      if (targetMetaMessageId) {
        const targetMessage = await messageRepository.findByMetaMessageId(targetMetaMessageId, orgId);
        if (targetMessage) {
          if (emoji) {
            await messageReactionRepository.upsertReaction({
              messageId: targetMessage.id,
              customerId: customer ? customer.id : null,
              emoji: emoji,
            });
          } else {
            await messageReactionRepository.deleteReaction({
              messageId: targetMessage.id,
              customerId: customer ? customer.id : null,
            });
          }
          publish(orgId, {
            type: "message.reaction",
            customerId: customer?.id ?? targetMessage.customerId,
            messageId: targetMessage.id,
            emoji: emoji || null,
            userId: null,
          });
          log.info(emoji ? 'Inbound reaction saved' : 'Inbound reaction removed', {
            wamid: targetMetaMessageId,
            messageId: targetMessage.id,
            customerId: customer?.id,
            emoji: emoji || null,
          });
        } else {
          log.warn('Reaction target message not found', { targetWamid: targetMetaMessageId, from: cleanFromPhone });
        }
      }
      return 'reaction';
    }

    // Save Inbound Message to PostgreSQL messages Table
    if (customer) {
      const rawBody =
        messageType === 'text'
          ? msg.text?.body
          : parsedContent.summary;
      const textBody = rawBody && rawBody.trim() ? rawBody.trim() : null;

      const mediaUrl =
        parsedContent.details?.id
          ? `whatsapp-media:${parsedContent.details.id}`
          : null;

      // Durable marker for the automation start that runs after the response: if the process stops first,
      // the sweep replays it. Only set when the org has message-triggered automations (cached lookup).
      const isFlowReply = Boolean(parseFlowReply(msg));
      const automationPending =
        !isFlowReply && Boolean(messageId) && (await automationEngine.hasMessageTriggers(orgId).catch(() => true));

      const savedMessage = await messageRepository.createMessage({
        organizationId: orgId,
        customerId: customer.id,
        channelId: channelId,
        senderType: 'customer',
        senderId: null, // Null for customer/webhook
        receiverId: customer.id, // Always denotes customer_id
        textContent: textBody,
        mediaUrl: mediaUrl,
        mediaType: messageType,
        isInternalNote: false,
        status: MessageStatus.DELIVERED, // Inbound message delivered
        metaMessageId: messageId,
        repliedToId: repliedToId,
        createdAt: msgDate,
        automationPendingSince: automationPending ? new Date() : null,
      });

      // The unique (organization, wamid) index refused it: a concurrent delivery of the same message won
      if (!savedMessage && messageId) {
        log.debug('Duplicate inbound message ignored (concurrent delivery)', { wamid: messageId });
        return 'duplicate';
      }

      if (savedMessage) {
        publish(orgId, {
          type: "message.new",
          customerId: customer.id,
          customer: {
            id: customer.id,
            name: customer.name,
            phone: customer.phone,
            channelId: channelId,
          },
          message: savedMessage,
        });
      }

      log.info('Inbound WhatsApp message saved', {
        wamid: messageId,
        messageId: savedMessage?.id,
        customerId: customer.id,
        from: cleanFromPhone,
        type: messageType,
        textContent: textBody,
        ...(repliedToId ? { repliedToId } : {}),
      });

      await this.afterInboundMessage(msg, ctx, customer.id, savedMessage?.id ?? null, textBody, msgDate, automationPending);
    }

    return 'saved';
  }

  /**
   * Flow responses and automation triggers for a newly saved inbound message.
   * Runs only for the first delivery of a wamid (duplicates return earlier) and never throws:
   * message ingestion must not depend on these features.
   */
  private async afterInboundMessage(
    msg: any,
    ctx: ChangeContext,
    customerId: number,
    messageId: number | null,
    text: string | null,
    msgDate: Date,
    automationPending: boolean
  ): Promise<void> {
    try {
      // STOP / UNSUBSCRIBE / START: update consent and confirm. These messages never trigger automations,
      // so a customer who just opted out can't get an automated promotional reply.
      const consentMatch = matchConsentKeyword(consentKeywordCandidates(msg));
      if (consentMatch) {
        const { customer, changed } = await consentService.changeStatus({
          organizationId: ctx.orgId,
          customerId,
          status: consentMatch.status,
          source: 'keyword',
          reason: `Customer sent "${consentMatch.text}"`,
          keyword: consentMatch.keyword,
          metaMessageId: msg.id,
          occurredAt: msgDate,
        });
        if (changed) ctx.defer(() => consentService.sendConfirmation(ctx.orgId, customer, consentMatch.status, 'keyword'));
        return;
      }

      if (parseFlowReply(msg)) {
        // Stored inside the request so a crash can't lose it; resuming the automation is deferred
        const submission = await whatsappFlowSubmissionService.record({
          organizationId: ctx.orgId,
          channelId: ctx.channelId,
          customerId,
          wamid: msg.id,
          timestamp: msgDate,
          msg,
        });
        if (submission) ctx.defer(() => whatsappFlowSubmissionService.process(submission));
        return;
      }
      // No message-triggered automation in this org: nothing to start
      if (!automationPending) return;
      ctx.defer(async () => {
        await automationEngine.handleInboundMessage({
          organizationId: ctx.orgId,
          channelId: ctx.channelId,
          customerId,
          messageId,
          wamid: msg.id,
          text: msg.type === 'text' ? text : null,
          pending: true,
        });
      });
    } catch (err) {
      log.error('Post-processing of inbound message failed (message itself was saved)', { err, wamid: msg?.id, customerId });
    }
  }

  /** Apply one delivery status (sent / delivered / read / failed) to the stored outbound message. */
  private async processStatusUpdate(st: any, ctx: ChangeContext): Promise<void> {
    const { orgId } = ctx;
    const messageId = st.id;
    const status: string | undefined = st.status; // 'sent' | 'delivered' | 'read' | 'failed'

    // Extract error code if present in Meta status webhook
    const firstErr = Array.isArray(st.errors) && st.errors.length > 0 ? st.errors[0] : null;
    const parsedCode = firstErr ? Number(firstErr.code) : NaN;
    const errorCode: number | null = isNaN(parsedCode) ? null : parsedCode;

    if (!status || !messageId) {
      log.warn('Status update without id or status — ignored', { wamid: messageId, status });
      return;
    }

    const mappedStatus = MESSAGE_STATUS_VALUES[status.toLowerCase()];
    if (mappedStatus === undefined) {
      log.debug('Unknown message status ignored', { wamid: messageId, status });
      return;
    }

    const updatedMsg = await messageRepository.updateStatusByMetaId(messageId, orgId, mappedStatus, errorCode);
    publish(orgId, {
      type: "message.status",
      ...(updatedMsg ? { customerId: updatedMsg.customerId } : {}),
      metaMessageId: messageId,
      status: mappedStatus,
      errorCode: errorCode,
    });

    if (mappedStatus === MessageStatus.FAILED) {
      // Message failure details — what Meta said, what the agent sees, and how to fix it
      const info = getMetaErrorInfo(errorCode);
      log.warn(`WhatsApp reported a message delivery failure${info ? `: ${info.title}` : ''}`, {
        wamid: messageId,
        messageId: updatedMsg?.id ?? null,
        recipient: st.recipient_id,
        errorCode,
        errorTitle: firstErr?.title,
        errorMessage: firstErr?.message,
        errorDetails: firstErr?.error_data?.details,
        shownToAgent: describeMessageFailure(errorCode),
        ...(info ? { description: info.description, solution: info.solution } : { note: 'Error code not in META_ERROR_CATALOG' }),
      });
    } else {
      log.debug('Message status updated', {
        wamid: messageId,
        status,
        messageId: updatedMsg?.id ?? null,
        recipient: st.recipient_id,
        ...(st.pricing ? { pricingCategory: st.pricing.category } : {}),
      });
    }

    if (!updatedMsg) {
      log.debug('Status update for a message that is not in the database', { wamid: messageId, status });
    }

    // Meta refused a marketing message because the customer stopped marketing messages: record the opt-out
    if (mappedStatus === MessageStatus.FAILED && errorCode === META_MARKETING_OPTED_OUT && updatedMsg) {
      try {
        await consentService.changeStatus({
          organizationId: orgId,
          customerId: updatedMsg.customerId,
          status: 'opted_out',
          source: 'meta_delivery_error',
          reason: 'WhatsApp refused a marketing message: the customer has stopped marketing messages from this business (error 131050)',
          metaMessageId: messageId,
          occurredAt: st.timestamp ? new Date(Number(st.timestamp) * 1000) : new Date(),
        });
      } catch (err) {
        log.error('Could not record opt-out from a 131050 delivery failure', { err, wamid: messageId, customerId: updatedMsg.customerId });
      }
    }
  }

  /**
   * `user_preferences` webhook: the customer stopped ("stop") or resumed ("resume") marketing messages from this
   * number inside WhatsApp. Creates the contact when it doesn't exist yet, so the opt-out is never lost.
   */
  private async processUserPreference(pref: any, ctx: ChangeContext): Promise<void> {
    const waId = String(pref?.wa_id ?? '').replace(/\D/g, '');
    const value = typeof pref?.value === 'string' ? pref.value.toLowerCase() : '';
    if (!waId || pref?.category !== 'marketing_messages' || (value !== 'stop' && value !== 'resume')) {
      log.info('Ignoring user preference update', { waId, category: pref?.category, value: pref?.value });
      return;
    }

    const customer =
      (await customerRepository.findByPhone(ctx.orgId, waId, ctx.channelId)) ??
      (await customerRepository.createCustomer(ctx.orgId, {
        name: ctx.contactMap.get(waId) || 'WhatsApp Customer',
        phone: waId,
        channelId: ctx.channelId,
      }));
    if (!customer) throw new Error('Could not resolve the contact for a user preference update');

    const status = value === 'stop' ? 'opted_out' : 'opted_in';
    const detail = typeof pref.detail === 'string' && pref.detail.trim() ? pref.detail.trim() : null;
    const result = await consentService.changeStatus({
      organizationId: ctx.orgId,
      customerId: customer.id,
      status,
      source: 'meta_preferences',
      reason: detail ?? (status === 'opted_out' ? 'Customer stopped marketing messages in WhatsApp' : 'Customer resumed marketing messages in WhatsApp'),
      occurredAt: pref.timestamp ? new Date(Number(pref.timestamp) * 1000) : new Date(),
    });
    if (result.changed) ctx.defer(() => consentService.sendConfirmation(ctx.orgId, result.customer, status, 'meta_preferences'));
  }

  /**
   * Helper to parse and extract content across different WhatsApp message types
   */
  private extractMessageContent(msg: any): { summary: string; details?: any } {
    const type = msg.type;

    switch (type) {
      case 'text':
        return { summary: msg.text?.body || '' };

      case 'image':
        return {
          summary: msg.image?.caption || '',
          details: {
            id: msg.image?.id,
            mime_type: msg.image?.mime_type,
            sha256: msg.image?.sha256,
            caption: msg.image?.caption || null,
          },
        };

      case 'video':
        return {
          summary: msg.video?.caption || '',
          details: {
            id: msg.video?.id,
            mime_type: msg.video?.mime_type,
            caption: msg.video?.caption || null,
          },
        };

      case 'audio':
        return {
          summary: '',
          details: {
            id: msg.audio?.id,
            mime_type: msg.audio?.mime_type,
            voice: msg.audio?.voice,
          },
        };

      case 'document':
        return {
          summary: msg.document?.caption || '',
          details: {
            id: msg.document?.id,
            filename: msg.document?.filename,
            mime_type: msg.document?.mime_type,
            caption: msg.document?.caption || null,
          },
        };

      case 'location':
        return {
          summary: `[Location] Lat: ${msg.location?.latitude}, Long: ${msg.location?.longitude} - ${msg.location?.name || msg.location?.address || ''}`,
          details: msg.location,
        };

      case 'contacts':
        return {
          summary: `[Contact Shared] ${msg.contacts?.map((c: any) => c.name?.formatted_name).join(', ')}`,
          details: msg.contacts,
        };

      case 'interactive':
        if (msg.interactive?.type === 'button_reply') {
          return {
            summary: `[Interactive Button Clicked] "${msg.interactive.button_reply?.title}" (ID: ${msg.interactive.button_reply?.id})`,
            details: msg.interactive,
          };
        }
        if (msg.interactive?.type === 'nfm_reply') {
          const reply = parseFlowReply(msg);
          return { summary: summarizeFlowReply(reply?.response ?? {}), details: { type: 'nfm_reply' } };
        }
        if (msg.interactive?.type === 'list_reply') {
          return {
            summary: `[Interactive List Selection] "${msg.interactive.list_reply?.title}" (ID: ${msg.interactive.list_reply?.id})`,
            details: msg.interactive,
          };
        }
        return { summary: `[Interactive Message] ${msg.interactive?.type}`, details: msg.interactive };

      case 'button':
        return {
          summary: `[Quick Reply Button] "${msg.button?.text}" (Payload: ${msg.button?.payload})`,
          details: msg.button,
        };

      case 'reaction':
        return {
          summary: `[Reaction] ${msg.reaction?.emoji || 'Removed'} to message ${msg.reaction?.message_id}`,
          details: msg.reaction,
        };

      case 'sticker':
        return {
          summary: '[Sticker]',
          details: msg.sticker,
        };

      case 'order':
        return {
          summary: `[WhatsApp Order] Catalog ID: ${msg.order?.catalog_id}, Items: ${msg.order?.product_items?.length || 0}`,
          details: msg.order,
        };

      default:
        return {
          summary: `[${type?.toUpperCase() || 'UNKNOWN'} MESSAGE]`,
          details: msg,
        };
    }
  }
}

export const whatsappWebhookService = new WhatsAppWebhookService();
