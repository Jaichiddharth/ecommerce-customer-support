import { channelRepository } from "../../db/repositories/channel.repository";
import { customerRepository } from "../../db/repositories/customer.repository";
import { messageRepository } from "../../db/repositories/message.repository";
import { messageReactionRepository } from "../../db/repositories/message-reaction.repository";
import { metaApi } from "../../meta";
import { encryptToken, decryptToken } from "../../security/crypto";
import { Channel, Message, MessageStatus } from "../../db/schema";
import { publish } from "@/lib/realtime";
import { AppError, toAppError } from "@/lib/errors";
import { createLogger } from "@/lib/logger";
import { validateWhatsAppMedia } from "@/lib/media-limits";

const log = createLogger("WhatsAppService");

export interface ConnectWhatsAppDTO {
  code: string;
  wabaId?: string;
  phoneNumberId?: string;
  organizationId: number;
  name?: string;
}

export class WhatsAppService {
  /**
   * Complete Meta Embedded Signup Onboarding & Store in PostgreSQL `channels` table
   */
  async connect(dto: ConnectWhatsAppDTO): Promise<{
    channel: Channel;
    wabaId: string | null;
    phoneNumberId: string | null;
    phoneData: any;
  }> {
    const orgId = dto.organizationId;

    // 1. Exchange OAuth code for Meta Access Token & register WABA / phone
    let metaAuth;
    try {
      metaAuth = await metaApi.generateMetaAuthToken(dto.code, dto.wabaId, dto.phoneNumberId);
    } catch (err) {
      const cause = toAppError(err);
      // An invalid/expired OAuth code comes back from Meta as a generic parameter error
      if (cause.code === "META_INVALID_REQUEST" || cause.code === "WHATSAPP_REAUTH_REQUIRED") {
        throw new AppError("WHATSAPP_CONNECT_FAILED", {
          message: "The Meta authorization code is invalid or has expired. Please try connecting again.",
          provider: cause.provider,
          details: { organizationId: orgId },
          cause,
        });
      }
      throw AppError.wrap(cause, "WHATSAPP_CONNECT_FAILED", { details: { organizationId: orgId } });
    }

    let activePhoneId = metaAuth.phoneNumberId || dto.phoneNumberId || null;
    let phoneData = metaAuth.phoneData || null;

    // If phone number ID is missing but WABA ID is available, try to resolve phone number from WABA
    if (!activePhoneId && metaAuth.wabaId && metaAuth.accessToken) {
      try {
        const phoneNumbers = await metaApi.getWabaPhoneNumbers(metaAuth.wabaId, metaAuth.accessToken);
        if (phoneNumbers && phoneNumbers.length > 0) {
          activePhoneId = phoneNumbers[0].id || null;
          phoneData = phoneNumbers[0];
        }
      } catch (err) {
        log.warn("Could not fetch WABA phone numbers during connect", { err, wabaId: metaAuth.wabaId });
      }
    }

    // 2. Fetch live phone number details (verified_name, display_phone_number, quality_rating, etc.)
    if (activePhoneId && metaAuth.accessToken) {
      try {
        const fetchedPhoneDetails = await metaApi.getPhoneNumberDetails(
          activePhoneId,
          metaAuth.accessToken
        );
        if (fetchedPhoneDetails) {
          phoneData = { ...phoneData, ...fetchedPhoneDetails };
        }
      } catch (err) {
        log.warn("Could not fetch phone number details during connect", { err, phoneNumberId: activePhoneId });
      }
    }

    const displayPhone = phoneData?.display_phone_number || null;
    const verifiedName =
      phoneData?.verified_name ||
      dto.name ||
      (displayPhone ? `WhatsApp - ${displayPhone}` : "WhatsApp - Official");

    // 3. Encrypt Meta Access Token for secure storage
    const encryptedToken = encryptToken(metaAuth.accessToken);

    if (!activePhoneId) {
      throw new AppError("WHATSAPP_CONNECT_FAILED", {
        message: "No WhatsApp phone number was found on this Meta account. Finish adding a phone number in Meta, then connect again.",
        details: { wabaId: metaAuth.wabaId ?? null },
      });
    }

    // 4. Upsert channel in PostgreSQL channels table under organizationId
    const channel = await channelRepository.upsertWhatsAppChannel({
      organizationId: orgId,
      name: verifiedName,
      phoneNumber: displayPhone,
      metaPhoneNumberId: activePhoneId,
      metaAccessToken: encryptedToken,
      isActive: true,
    });

    log.info("WhatsApp channel connected", {
      channelId: channel.id,
      wabaId: metaAuth.wabaId ?? null,
      phoneNumberId: activePhoneId,
      displayPhone,
    });

    return {
      channel,
      wabaId: metaAuth.wabaId ?? null,
      phoneNumberId: activePhoneId ?? null,
      phoneData,
    };
  }

  /**
   * Retrieve all WhatsApp connections for an organization
   */
  async getConnections(organizationId: number): Promise<Channel[]> {
    return await channelRepository.listByOrgAndType(organizationId, "whatsapp");
  }

  /**
   * Get Live Meta Graph API Details (Templates, WABA Status, Phone Numbers) using stored DB credentials
   */
  async getMetaDetails(phoneNumberId: string | undefined, organizationId: number) {
    const connections = await this.getConnections(organizationId);

    if (!connections || connections.length === 0) {
      return {
        connected: false,
        message: "No WhatsApp channels found for this organization.",
        allConnections: [],
      };
    }

    // Select the target channel (or first active one)
    const activeChannel = phoneNumberId
      ? connections.find((c) => c.metaPhoneNumberId === phoneNumberId) || connections[0]
      : connections.find((c) => c.isActive) || connections[0];

    const rawToken = activeChannel.metaAccessToken ? decryptToken(activeChannel.metaAccessToken) : "";

    let phoneDetails = null;
    let templates: any[] = [];
    let wabaDetails = null;

    if (rawToken && activeChannel.metaPhoneNumberId) {
      try {
        phoneDetails = await metaApi.getPhoneNumberDetails(activeChannel.metaPhoneNumberId, rawToken);
      } catch (err) {
        log.warn("Could not fetch live phone details", { err, channelId: activeChannel.id });
      }

      // Try to resolve WABA from token to fetch templates
      try {
        const resolved = await metaApi.resolveWabaAndPhoneFromToken(rawToken);
        if (resolved.wabaId) {
          wabaDetails = await metaApi.getWabaAccountDetails(resolved.wabaId, rawToken);
          const tplRes = await metaApi.getWabaTemplates(resolved.wabaId, rawToken);
          templates = tplRes?.data || [];
        }
      } catch (err) {
        log.warn("Could not fetch live templates", { err, channelId: activeChannel.id });
      }
    }

    // Format all connections for UI selector
    const formattedConnections = connections.map((conn) => ({
      id: conn.id,
      name: conn.name,
      phoneNumber_id: conn.metaPhoneNumberId,
      display_phone_number: conn.phoneNumber,
      verified_name: conn.name,
      is_active: conn.isActive,
      created_at: conn.createdAt,
    }));

    return {
      connected: true,
      selectedPhoneId: activeChannel.metaPhoneNumberId,
      connection: {
        id: activeChannel.id,
        name: activeChannel.name,
        phoneNumber_id: activeChannel.metaPhoneNumberId,
        display_phone_number: activeChannel.phoneNumber,
        created_at: activeChannel.createdAt,
      },
      phoneDetails: phoneDetails || {
        id: activeChannel.metaPhoneNumberId,
        display_phone_number: activeChannel.phoneNumber,
        verified_name: activeChannel.name,
        quality_rating: "HIGH",
      },
      waba: wabaDetails || {
        id: "WABA_OFFICIAL",
        name: activeChannel.name,
        review_status: "VERIFIED",
        template_namespace: "pingcart_templates",
      },
      templates,
      templatesCount: templates.length,
      allConnections: formattedConnections,
    };
  }

  /**
   * Send WhatsApp message (Text, Template, or Media with Caption) to a recipient using Meta Cloud API
   */
  async sendMessage(params: {
    organizationId: number;
    channelId?: number;
    phoneNumberId?: string;
    senderId?: number | null;
    senderName?: string | null;
    customerId?: number;
    repliedToId?: number | null;
    to: string;
    text?: string;
    type?: 'text' | 'template' | 'image' | 'document' | 'video' | 'audio';
    mediaType?: 'image' | 'document' | 'video' | 'audio';
    mediaId?: string;
    mediaFile?: Buffer | Uint8Array | Blob;
    mimeType?: string;
    filename?: string;
    templateName?: string;
    languageCode?: string;
    components?: Array<Record<string, unknown>>;
  }) {
    const orgId = params.organizationId;
    const connections = await this.getConnections(orgId);

    if (!connections || connections.length === 0) {
      throw new AppError("WHATSAPP_NOT_CONNECTED", { expected: true });
    }

    // Select channel (by channelId, phoneNumberId, or first active)
    let targetChannel = null;
    if (params.channelId) {
      targetChannel = connections.find((c) => c.id === params.channelId);
    } else if (params.phoneNumberId) {
      targetChannel = connections.find((c) => c.metaPhoneNumberId === params.phoneNumberId);
    } else {
      targetChannel = connections.find((c) => c.isActive) || connections[0];
    }

    if (!targetChannel) {
      throw new AppError("WHATSAPP_CHANNEL_NOT_FOUND", {
        details: { channelId: params.channelId, phoneNumberId: params.phoneNumberId },
        expected: true,
      });
    }

    if (!targetChannel.metaPhoneNumberId) {
      throw new AppError("WHATSAPP_CHANNEL_MISCONFIGURED", {
        message: "This WhatsApp channel has no Meta phone number configured. Please reconnect it.",
        details: { channelId: targetChannel.id },
      });
    }

    const rawToken = targetChannel.metaAccessToken ? decryptToken(targetChannel.metaAccessToken) : "";
    if (!rawToken) {
      throw new AppError("WHATSAPP_CHANNEL_MISCONFIGURED", {
        message: "This WhatsApp channel has no valid access token. Please reconnect it.",
        details: { channelId: targetChannel.id },
      });
    }

    // Clean recipient phone number (digits only, e.g. 919876543210)
    const cleanTo = params.to.replace(/[^\d]/g, "");
    if (!cleanTo) {
      throw AppError.validation("The recipient phone number is invalid.", "to");
    }

    // Resolve media type from mimeType or explicit type
    const getMediaTypeFromMime = (mime?: string): 'image' | 'video' | 'audio' | 'document' => {
      if (!mime) return 'document';
      if (mime.startsWith('image/')) return 'image';
      if (mime.startsWith('video/')) return 'video';
      if (mime.startsWith('audio/')) return 'audio';
      return 'document';
    };

    const hasMediaFile = Boolean(params.mediaFile);
    const hasMediaId = Boolean(params.mediaId);
    const isMediaMessage = hasMediaFile || hasMediaId;
    const resolvedMediaType: 'image' | 'video' | 'audio' | 'document' =
      params.mediaType ||
      (params.type && ['image', 'video', 'audio', 'document'].includes(params.type) ? (params.type as any) : null) ||
      getMediaTypeFromMime(params.mimeType);

    if (hasMediaFile && params.mediaFile) {
      const size = params.mediaFile instanceof Blob ? params.mediaFile.size : params.mediaFile.byteLength;
      const check = validateWhatsAppMedia({ size, type: params.mimeType, name: params.filename });
      if (!check.ok) {
        throw new AppError(check.code, {
          message: check.message,
          details: { filename: params.filename, mimeType: params.mimeType, size },
          expected: true,
        });
      }
    }

    const sendContext = {
      channelId: targetChannel.id,
      phoneNumberId: targetChannel.metaPhoneNumberId,
      to: cleanTo,
      type: isMediaMessage ? resolvedMediaType : params.type || "text",
      customerId: params.customerId,
    };
    log.info("Dispatching WhatsApp message", {
      ...sendContext,
      ...(params.templateName ? { templateName: params.templateName } : {}),
      ...(isMediaMessage ? { filename: params.filename, mimeType: params.mimeType } : {}),
    });

    let metaRes: any = null;
    let storedMediaUrl: string | null = null;
    let storedMediaType: string = params.type || 'text';

    try {
      if (hasMediaFile && params.mediaFile) {
        // Step 1: Upload media file directly to Meta Cloud API
        let uploadRes: { id: string };
        try {
          uploadRes = await metaApi.uploadWhatsAppMedia(
            targetChannel.metaPhoneNumberId,
            rawToken,
            params.mediaFile,
            params.mimeType || 'application/octet-stream',
            params.filename || 'attachment'
          );
        } catch (err) {
          const cause = toAppError(err);
          const uploadDetails = { stage: "upload", filename: params.filename, mimeType: params.mimeType };
          // Meta reports a rejected file as a generic parameter error
          if (cause.code === "META_INVALID_REQUEST") {
            throw new AppError("FILE_UPLOAD_FAILED", {
              message: "WhatsApp rejected this file. Check the file type and size, then try again.",
              retryable: false,
              provider: cause.provider,
              details: { ...cause.details, ...uploadDetails },
              cause,
            });
          }
          throw AppError.wrap(cause, "FILE_UPLOAD_FAILED", { details: uploadDetails });
        }

        const uploadedMediaId = uploadRes.id;
        storedMediaUrl = `whatsapp-media:${uploadedMediaId}`;
        storedMediaType = resolvedMediaType;

        // Step 2: Send WhatsApp Media Message with Caption to Recipient
        metaRes = await metaApi.sendWhatsAppMediaMessage(
          targetChannel.metaPhoneNumberId,
          rawToken,
          cleanTo,
          resolvedMediaType,
          uploadedMediaId,
          params.text?.trim() || undefined,
          params.filename
        );
      } else if (hasMediaId && params.mediaId) {
        storedMediaUrl = `whatsapp-media:${params.mediaId}`;
        storedMediaType = resolvedMediaType;

        metaRes = await metaApi.sendWhatsAppMediaMessage(
          targetChannel.metaPhoneNumberId,
          rawToken,
          cleanTo,
          resolvedMediaType,
          params.mediaId,
          params.text?.trim() || undefined,
          params.filename
        );
      } else if (params.type === 'template' && params.templateName) {
        metaRes = await metaApi.sendWhatsAppTemplateMessage(
          targetChannel.metaPhoneNumberId,
          rawToken,
          cleanTo,
          params.templateName,
          params.languageCode || 'en_US',
          params.components || []
        );
        storedMediaType = 'template';
      } else {
        if (!params.text || !params.text.trim()) {
          throw AppError.validation("Message text or media attachment cannot be empty.", "text");
        }
        metaRes = await metaApi.sendWhatsAppTextMessage(
          targetChannel.metaPhoneNumberId,
          rawToken,
          cleanTo,
          params.text.trim()
        );
        storedMediaType = 'text';
      }
    } catch (err) {
      // Keep Meta's specific reason (24h window, invalid number, template…) and add what we were sending
      throw AppError.wrap(err, "MESSAGE_SEND_FAILED", { details: sendContext });
    }

    // Extract Meta WAMID (e.g. wamid.HBg...)
    const metaMessageId = metaRes?.messages?.[0]?.id || null;
    log.info("WhatsApp message accepted by Meta", { ...sendContext, wamid: metaMessageId });

    let storedMessage: (Message & { senderName?: string | null }) | null = null;
    try {
      // 1. Resolve or Create Customer in DB
      let targetCustomer = null;
      if (params.customerId) {
        targetCustomer = await customerRepository.findById(params.customerId, orgId);
      }
      if (!targetCustomer) {
        targetCustomer = await customerRepository.findByPhone(orgId, cleanTo, targetChannel.id);
      }
      if (!targetCustomer) {
        targetCustomer = await customerRepository.createCustomer(orgId, {
          name: cleanTo,
          phone: cleanTo, // Stored strictly without '+'
          channelId: targetChannel.id,
        });
      } else if (targetCustomer.phone && targetCustomer.phone.startsWith('+')) {
        await customerRepository.updateCustomer(targetCustomer.id, orgId, { phone: cleanTo });
        targetCustomer.phone = cleanTo;
      }

      // Only keep a reply reference that points to a message of this organization
      const repliedTo = params.repliedToId
        ? await messageRepository.findById(params.repliedToId, orgId)
        : null;

      // 3. Store Outbound Message in DB
      if (targetCustomer) {
        const finalContent = params.text?.trim() || (params.templateName ? `[Template: ${params.templateName}]` : null);

        const createdMessage = await messageRepository.createMessage({
          organizationId: orgId,
          customerId: targetCustomer.id,
          channelId: targetChannel.id,
          senderType: 'agent',
          senderId: params.senderId ?? null,
          receiverId: targetCustomer.id,
          textContent: finalContent,
          mediaUrl: storedMediaUrl,
          mediaType: storedMediaType,
          isInternalNote: false,
          status: MessageStatus.SENT, // Outbound message starts as SENT (0)
          metaMessageId: metaMessageId,
          repliedToId: repliedTo?.id ?? null,
          createdAt: new Date(),
        });
        storedMessage = createdMessage ? { ...createdMessage, senderName: params.senderName ?? null } : null;

        if (storedMessage) {
          publish(orgId, {
            type: "message.new",
            customerId: targetCustomer.id,
            customer: {
              id: targetCustomer.id,
              name: targetCustomer.name,
              phone: targetCustomer.phone,
              channelId: targetChannel.id,
            },
            message: storedMessage,
          });
        }
      }
    } catch (err) {
      // The customer already received the message — report success so the agent doesn't resend it
      log.error("Message was delivered by WhatsApp but could not be saved to the database", {
        err,
        ...sendContext,
        wamid: metaMessageId,
      });
      return {
        success: true,
        persisted: false,
        warning: "The message was delivered, but it could not be saved to the conversation history.",
        message: null,
        channel: { id: targetChannel.id, name: targetChannel.name, phoneNumber: targetChannel.phoneNumber },
        metaResponse: metaRes,
      };
    }

    return {
      success: true,
      persisted: true,
      message: storedMessage,
      channel: {
        id: targetChannel.id,
        name: targetChannel.name,
        phoneNumber: targetChannel.phoneNumber,
      },
      metaResponse: metaRes,
    };
  }

  /**
   * Send WhatsApp message reaction to Meta Cloud API and record in DB
   */
  async sendReaction(params: {
    organizationId: number;
    channelId?: number;
    phoneNumberId?: string;
    messageId: number;
    targetMetaMessageId?: string;
    userId?: number | null;
    customerId?: number | null;
    to?: string;
    emoji: string;
  }) {
    const orgId = params.organizationId;
    // 1. Fetch message from DB (must belong to this organization)
    const targetMessage = await messageRepository.findById(params.messageId, orgId);
    if (!targetMessage) {
      throw AppError.notFound("Message not found.");
    }
    const connections = await this.getConnections(orgId);
    const targetMetaId = params.targetMetaMessageId || targetMessage.metaMessageId;
    const resolvedCustomerId = targetMessage.customerId;

    // 2. Upsert or delete reaction in DB
    const reactionRecord = await messageReactionRepository.upsertReaction({
      messageId: params.messageId,
      userId: params.userId ?? null,
      customerId: resolvedCustomerId,
      emoji: params.emoji,
    });

    publish(orgId, {
      type: "message.reaction",
      customerId: resolvedCustomerId ?? undefined,
      messageId: params.messageId,
      emoji: params.emoji ? params.emoji : null,
      userId: params.userId ?? null,
    });

    // 3. If targetMetaId and recipient phone are available, send to Meta Cloud API
    let metaRes = null;
    let metaError: { code: string; message: string } | null = null;
    if (targetMetaId && connections.length > 0) {
      let targetChannel = null;
      if (params.channelId) {
        targetChannel = connections.find((c) => c.id === params.channelId);
      } else if (targetMessage.channelId) {
        targetChannel = connections.find((c) => c.id === targetMessage.channelId);
      } else {
        targetChannel = connections.find((c) => c.isActive) || connections[0];
      }

      if (targetChannel && targetChannel.metaPhoneNumberId && targetChannel.metaAccessToken) {
        const rawToken = decryptToken(targetChannel.metaAccessToken);
        let recipientPhone = params.to;
        if (!recipientPhone) {
          const cust = await customerRepository.findById(targetMessage.customerId, orgId);
          recipientPhone = cust?.phone || undefined;
        }

        if (recipientPhone && rawToken) {
          const cleanTo = recipientPhone.replace(/[^\d]/g, "");
          try {
            metaRes = await metaApi.sendWhatsAppReactionMessage(
              targetChannel.metaPhoneNumberId,
              rawToken,
              cleanTo,
              targetMetaId,
              params.emoji
            );
          } catch (apiErr) {
            // Reaction is saved locally; tell the UI it didn't reach the customer
            const appErr = toAppError(apiErr);
            metaError = { code: appErr.code, message: appErr.message };
            log.warn("Reaction saved but not delivered to WhatsApp", {
              err: appErr,
              messageId: params.messageId,
              channelId: targetChannel.id,
            });
          }
        }
      }
    }

    return {
      success: true,
      reaction: reactionRecord,
      metaResponse: metaRes,
      metaDelivered: metaError === null,
      metaError,
    };
  }
}

export const whatsAppService = new WhatsAppService();
