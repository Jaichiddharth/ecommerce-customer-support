import crypto from 'crypto';
import { messageRepository, customerRepository, channelRepository, messageReactionRepository } from '../../db/repositories';
import { MessageStatus, MESSAGE_STATUS_VALUES } from '../../db/schema';
import { publish } from '@/lib/realtime';
import { AppError, describeMessageFailure, getMetaErrorInfo } from '@/lib/errors';
import { createLogger } from '@/lib/logger';

const log = createLogger('WhatsAppWebhook');

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
  async processWebhookPayload(payload: any): Promise<WebhookProcessingResult> {
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

        if (field !== 'messages' || !value) {
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
      }
    }

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

    // Resolve or Create Customer in DB strictly for THIS Channel
    let customer = await customerRepository.findByPhone(orgId, cleanFromPhone, channelId);
    if (!customer) {
      customer = await customerRepository.createCustomer(orgId, {
        name: contactName,
        phone: cleanFromPhone, // Stored strictly without '+'
        channelId: channelId,
      });
      log.info('New customer created from inbound message', { customerId: customer?.id, phone: cleanFromPhone, channelId });
    } else {
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
              organizationId: orgId,
              messageId: targetMessage.id,
              customerId: customer ? customer.id : null,
              emoji: emoji,
            });
          } else {
            await messageReactionRepository.deleteReaction({
              organizationId: orgId,
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
      });

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
    }

    return 'saved';
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
