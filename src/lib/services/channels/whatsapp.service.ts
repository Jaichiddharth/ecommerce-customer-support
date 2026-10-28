import { channelRepository } from "../../db/repositories/channel.repository";
import { customerRepository } from "../../db/repositories/customer.repository";
import { customerService } from "../customer.service";
import { messageRepository } from "../../db/repositories/message.repository";
import { messageReactionRepository } from "../../db/repositories/message-reaction.repository";
import { metaApi } from "../../meta";
import { encryptToken, decryptToken } from "../../security/crypto";
import { Channel, ChannelStatus, Message, MessageStatus, type MessageMetadata } from "../../db/schema";
import { publish } from "@/lib/realtime";
import { AppError, toAppError } from "@/lib/errors";
import { createLogger } from "@/lib/logger";
import { validateWhatsAppMedia } from "@/lib/media-limits";
import {
  WHATSAPP_BUSINESS_VERTICALS,
  WHATSAPP_PROFILE_LIMITS,
  type WhatsAppBusinessProfile,
} from "@/types/whatsapp";

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

    // 0. Fail fast on a number connected in another workspace (before exchanging the OAuth code)
    if (dto.phoneNumberId) {
      await this.resolveOwnedChannel(orgId, { metaPhoneNumberId: dto.phoneNumberId });
    }

    // 1. Exchange OAuth code for Meta Access Token & register WABA / phone
    let metaAuth;
    try {
      metaAuth = await metaApi.generateMetaAuthToken(dto.code, dto.wabaId, dto.phoneNumberId, {
        beforeActivate: async ({ phoneNumberId }) => {
          if (phoneNumberId) await this.resolveOwnedChannel(orgId, { metaPhoneNumberId: phoneNumberId });
        },
      });
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

    const resolvedWabaId = metaAuth.wabaId || dto.wabaId || null;

    if (!activePhoneId) {
      throw new AppError("WHATSAPP_CONNECT_FAILED", {
        message: "No WhatsApp phone number was found on this Meta account. Finish adding a phone number in Meta, then connect again.",
        details: { wabaId: resolvedWabaId },
      });
    }

    // 3. Authoritative ownership check on the resolved Phone Number ID and phone number.
    //    Returns this workspace's existing row for the number, if any, so it is updated instead of duplicated.
    const existing = await this.resolveOwnedChannel(orgId, {
      metaPhoneNumberId: activePhoneId,
      phoneNumber: displayPhone,
    });

    // 4. Encrypt Meta Access Token for secure storage
    const encryptedToken = encryptToken(metaAuth.accessToken);

    // 5. Store the channel: reconnecting (or re-running the flow for) a number this workspace already has
    //    updates that row, so its contacts and conversations reattach and no duplicate is created
    const credentials = {
      name: verifiedName,
      phoneNumber: displayPhone,
      metaPhoneNumberId: activePhoneId,
      wabaId: resolvedWabaId,
      metaAccessToken: encryptedToken,
    };
    let channel: Channel;
    try {
      channel = existing
        ? await channelRepository.reconnectWhatsAppChannel(existing.id, credentials)
        : await channelRepository.createWhatsAppChannel({ organizationId: orgId, ...credentials, isActive: true });
    } catch (err) {
      // Lost a race: another workspace connected this number between the ownership check and the write
      if (toAppError(err).code === "DB_CONSTRAINT_VIOLATION") throw this.numberInUseError(activePhoneId);
      throw err;
    }

    publish(orgId, { type: "channel.updated", channelId: channel.id });

    log.info("WhatsApp channel connected and stored", {
      channelId: channel.id,
      wabaId: resolvedWabaId,
      phoneNumberId: activePhoneId,
      displayPhone,
      updatedExisting: Boolean(existing),
    });

    return {
      channel,
      wabaId: resolvedWabaId,
      phoneNumberId: activePhoneId,
      phoneData,
    };
  }

  /**
   * Ownership rule for a WhatsApp number: it belongs to the workspace that has it connected right now.
   * Several workspaces may hold a row for the same number over time, but at most one row is live
   * (also enforced by the uq_channels_live_meta_phone_id index); disconnected rows carry no token.
   * - another workspace has it live            → rejected
   * - this workspace already has a row for it  → that row is returned to be updated (no duplicate)
   * - otherwise (free, or only disconnected elsewhere) → null, a new channel may be created
   * The other workspace's identity is never put in the error, since details reach the client.
   */
  private async resolveOwnedChannel(
    orgId: number,
    number: { metaPhoneNumberId?: string | null; phoneNumber?: string | null }
  ): Promise<Channel | null> {
    const matches = await channelRepository.findWhatsAppChannelsForNumber(number);
    const isLive = (c: Channel) => c.status !== ChannelStatus.DISCONNECTED;

    const liveElsewhere = matches.find((c) => c.organizationId !== orgId && isLive(c));
    if (liveElsewhere) {
      log.warn("Prevented WhatsApp number connected in another workspace from being claimed", {
        conflictingChannelId: liveElsewhere.id,
        conflictingOrgId: liveElsewhere.organizationId,
        requestOrgId: orgId,
        ...number,
      });
      throw this.numberInUseError(number.metaPhoneNumberId);
    }

    // Prefer the live row, then the most recently updated one
    const own = matches
      .filter((c) => c.organizationId === orgId)
      .sort((a, b) => Number(isLive(b)) - Number(isLive(a)) || b.updatedAt.getTime() - a.updatedAt.getTime());
    return own[0] ?? null;
  }

  private numberInUseError(phoneNumberId?: string | null) {
    return AppError.whatsappAlreadyConnected(
      "This WhatsApp number is connected to another workspace. It can be connected here once that workspace disconnects it.",
      { phoneNumberId: phoneNumberId ?? null }
    );
  }

  /**
   * Disconnect a WhatsApp channel: unsubscribe our app from the WABA at Meta (so webhooks stop),
   * then soft-disconnect it locally. The WABA subscription is kept while another live number
   * still uses it, since one WABA can hold several connected numbers.
   * Meta failures don't block the local disconnect; they are reported back as metaUnsubscribed=false.
   */
  async disconnect(channel: Channel): Promise<{ metaUnsubscribed: boolean; metaSkippedReason?: string }> {
    let metaUnsubscribed = false;
    let metaSkippedReason: string | undefined;

    const wabaStillInUse = channel.wabaId
      ? (await channelRepository.findByWabaIdLive(channel.wabaId)).some((c) => c.id !== channel.id)
      : false;
    const rawToken = channel.metaAccessToken ? decryptToken(channel.metaAccessToken) : "";

    if (!channel.wabaId || !rawToken) {
      metaSkippedReason = "missing_credentials";
    } else if (wabaStillInUse) {
      metaSkippedReason = "waba_shared";
    } else {
      try {
        await metaApi.unsubscribeAppFromWaba(channel.wabaId, rawToken);
        metaUnsubscribed = true;
      } catch (err) {
        metaSkippedReason = "meta_error";
        log.warn("Could not unsubscribe app from WABA during disconnect — disconnecting locally", {
          err,
          channelId: channel.id,
          wabaId: channel.wabaId,
        });
      }
    }

    await channelRepository.markDisconnected(channel.id, channel.organizationId);

    log.info("WhatsApp channel disconnected", {
      channelId: channel.id,
      organizationId: channel.organizationId,
      wabaId: channel.wabaId,
      metaUnsubscribed,
      metaSkippedReason,
    });

    publish(channel.organizationId, { type: "channel.updated", channelId: channel.id });
    return { metaUnsubscribed, metaSkippedReason };
  }

  /**
   * Retrieve all live WhatsApp connections for an organization
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

      // Try to resolve WABA from stored wabaId or token to fetch templates
      try {
        let activeWabaId = activeChannel.wabaId;
        if (!activeWabaId) {
          const resolved = await metaApi.resolveWabaAndPhoneFromToken(rawToken);
          activeWabaId = resolved.wabaId || null;
        }
        if (activeWabaId) {
          wabaDetails = await metaApi.getWabaAccountDetails(activeWabaId, rawToken);
          const tplRes = await metaApi.getWabaTemplates(activeWabaId, rawToken);
          templates = tplRes?.data || [];
        }
      } catch (err) {
        log.warn("Could not fetch live templates", { err, channelId: activeChannel.id });
      }
    }

    // Format all connections for UI selector
    const formattedConnections = connections.map((conn) => ({
      id: conn.id,
      organizationId: conn.organizationId,
      type: conn.type,
      verified_name: conn.name,
      phoneNumber: conn.phoneNumber,
      metaPhoneNumberId: conn.metaPhoneNumberId,
      wabaId: conn.wabaId,
      isActive: conn.isActive,
      createdAt: conn.createdAt,
      updatedAt: conn.updatedAt,
    }));

    return {
      connected: true,
      selectedPhoneId: activeChannel.metaPhoneNumberId,
      connection: {
        id: activeChannel.id,
        organizationId: activeChannel.organizationId,
        type: activeChannel.type,
        verified_name: activeChannel.name,
        phoneNumber: activeChannel.phoneNumber,
        metaPhoneNumberId: activeChannel.metaPhoneNumberId,
        wabaId: activeChannel.wabaId,
        isActive: activeChannel.isActive,
        createdAt: activeChannel.createdAt,
        updatedAt: activeChannel.updatedAt,
      },
      phoneDetails: phoneDetails || {
        id: activeChannel.metaPhoneNumberId,
        display_phone_number: activeChannel.phoneNumber,
        verified_name: activeChannel.name,
        quality_rating: "HIGH",
      },
      waba: wabaDetails || {
        id: activeChannel.wabaId || "WABA_OFFICIAL",
        name: activeChannel.name,
        review_status: "VERIFIED",
        template_namespace: "pingcart_templates",
      },
      templates,
      templatesCount: templates.length,
      allConnections: formattedConnections,
    };
  }

  /** Decrypted credentials for calls made on a number's behalf; throws when the channel can't reach Meta */
  private requireCredentials(channel: Channel): { phoneNumberId: string; token: string } {
    const token = channel.metaAccessToken ? decryptToken(channel.metaAccessToken) : "";
    if (!channel.metaPhoneNumberId || !token) {
      throw new AppError("WHATSAPP_CHANNEL_MISCONFIGURED", {
        message: "This WhatsApp number has no valid Meta credentials. Please reconnect it.",
        details: { channelId: channel.id },
      });
    }
    return { phoneNumberId: channel.metaPhoneNumberId, token };
  }

  /**
   * Settings → WhatsApp number: live number health and the business profile customers see
   */
  async getNumberSettings(channel: Channel) {
    const { phoneNumberId, token } = this.requireCredentials(channel);
    const [phone, profile] = await Promise.all([
      metaApi.getPhoneNumberStatus(phoneNumberId, token),
      metaApi.getBusinessProfile(phoneNumberId, token),
    ]);
    return { phone, profile };
  }

  /**
   * Update the WhatsApp Business Profile. Only the fields present in `input` are sent to Meta.
   */
  async updateBusinessProfile(channel: Channel, input: Record<string, unknown>): Promise<WhatsAppBusinessProfile> {
    const { phoneNumberId, token } = this.requireCredentials(channel);
    const update: Omit<WhatsAppBusinessProfile, "profile_picture_url"> = {};

    const text = (field: "about" | "address" | "description" | "email", label: string) => {
      if (input[field] === undefined) return;
      if (typeof input[field] !== "string") throw AppError.validation(`${label} must be text.`, field);
      const value = (input[field] as string).trim();
      if (value.length > WHATSAPP_PROFILE_LIMITS[field]) {
        throw AppError.validation(`${label} can be at most ${WHATSAPP_PROFILE_LIMITS[field]} characters.`, field);
      }
      update[field] = value;
    };
    text("about", "About");
    text("address", "Address");
    text("description", "Description");
    text("email", "Business email");

    if (update.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(update.email)) {
      throw AppError.validation("Enter a valid business email.", "email");
    }

    if (input.vertical !== undefined) {
      if (!WHATSAPP_BUSINESS_VERTICALS.some((v) => v.value === input.vertical)) {
        throw AppError.validation("Choose a business category from the list.", "vertical");
      }
      update.vertical = input.vertical as string;
    }

    if (input.websites !== undefined) {
      if (!Array.isArray(input.websites)) throw AppError.validation("Websites must be a list.", "websites");
      const websites = input.websites.map((w) => String(w ?? "").trim()).filter(Boolean);
      if (websites.length > 2) throw AppError.validation("You can add at most 2 websites.", "websites");
      for (const w of websites) {
        if (!/^https?:\/\/[^\s.]+\.[^\s]+$/i.test(w) || w.length > WHATSAPP_PROFILE_LIMITS.website) {
          throw AppError.validation(`"${w}" isn't a valid website address.`, "websites");
        }
      }
      update.websites = websites;
    }

    if (Object.keys(update).length > 0) {
      await metaApi.updateBusinessProfile(phoneNumberId, token, update);
      log.info("WhatsApp business profile updated", { channelId: channel.id, fields: Object.keys(update) });
    }
    return metaApi.getBusinessProfile(phoneNumberId, token);
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
    /** Public https URL that Meta downloads itself, e.g. a Shopify product image */
    mediaLink?: string;
    mediaFile?: Buffer | Uint8Array | Blob;
    mimeType?: string;
    filename?: string;
    templateName?: string;
    languageCode?: string;
    components?: Array<Record<string, unknown>>;
    metadata?: MessageMetadata | null;
  }) {
    const orgId = params.organizationId;
    const connections = await this.getConnections(orgId);

    if (!connections || connections.length === 0) {
      throw new AppError("WHATSAPP_NOT_CONNECTED", { expected: true });
    }

    // A contact belongs to its channel: hidden once that channel is disconnected, and always
    // replied to from its own number rather than whichever channel happens to be first
    const contact = params.customerId ? await customerService.requireVisible(params.customerId, orgId) : null;

    // Select channel (by channelId, phoneNumberId, the contact's own channel, or first active)
    let targetChannel = null;
    if (params.channelId) {
      targetChannel = connections.find((c) => c.id === params.channelId);
    } else if (params.phoneNumberId) {
      targetChannel = connections.find((c) => c.metaPhoneNumberId === params.phoneNumberId);
    } else if (contact?.channelId) {
      targetChannel = connections.find((c) => c.id === contact.channelId);
    } else {
      targetChannel = connections.find((c) => c.isActive) || connections[0];
    }

    if (!targetChannel) {
      const chId = params.channelId || contact?.channelId;
      if (chId) {
        const found = await channelRepository.findById(chId, orgId);
        if (found && found.status === ChannelStatus.DISCONNECTED) {
          throw new AppError("WHATSAPP_CHANNEL_DISCONNECTED", {
            message: "This WhatsApp number is disconnected. Reconnect it in Settings to send messages.",
            details: { channelId: chId },
            expected: true,
          });
        }
      }
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

    // 24-Hour Customer Care Window enforcement (WhatsApp Business Platform Policy):
    // Free-form text and media messages can only be sent within 24 hours of the customer's last incoming message.
    // Outside this window (or if no message was ever received), ONLY pre-approved templates can be sent.
    const isTemplate = params.type === "template" || Boolean(params.templateName);
    if (!isTemplate) {
      let targetCustomerForWindow = contact;
      if (!targetCustomerForWindow) {
        targetCustomerForWindow = await customerRepository.findByPhone(orgId, cleanTo, targetChannel.id);
      }

      let lastInbound: Message | null = null;
      if (targetCustomerForWindow) {
        lastInbound = await messageRepository.findLastReceivedFromCustomer(targetCustomerForWindow.id, orgId);
      }

      const WINDOW_24H_MS = 24 * 60 * 60 * 1000;
      if (!lastInbound) {
        throw new AppError("MESSAGE_WINDOW_EXPIRED", {
          message: "More than 24 hours have passed since the customer last messaged (or no message received yet). Send an approved template message to start the conversation.",
          expected: true,
          details: {
            customerId: targetCustomerForWindow?.id,
            to: cleanTo,
            lastReceivedAt: null,
            reason: "no_incoming_message",
          },
        });
      }

      const elapsedMs = Date.now() - new Date(lastInbound.createdAt).getTime();
      if (elapsedMs > WINDOW_24H_MS) {
        const hoursAgo = Math.floor(elapsedMs / (1000 * 60 * 60));
        throw new AppError("MESSAGE_WINDOW_EXPIRED", {
          message: `The 24-hour messaging window has expired (last customer message was ${hoursAgo}h ago). You can only send pre-approved template messages.`,
          expected: true,
          details: {
            customerId: targetCustomerForWindow?.id,
            to: cleanTo,
            lastReceivedAt: lastInbound.createdAt,
            hoursSinceLastReceived: hoursAgo,
          },
        });
      }
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
    const hasMediaLink = Boolean(params.mediaLink);
    const isMediaMessage = hasMediaFile || hasMediaId || hasMediaLink;
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
      } else if (hasMediaLink && params.mediaLink) {
        if (!/^https:\/\//i.test(params.mediaLink)) {
          throw AppError.validation("Media links must be https URLs.", "mediaLink");
        }
        storedMediaUrl = params.mediaLink;
        storedMediaType = resolvedMediaType;

        metaRes = await metaApi.sendWhatsAppMediaMessage(
          targetChannel.metaPhoneNumberId,
          rawToken,
          cleanTo,
          resolvedMediaType,
          params.mediaLink,
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
      if (contact) {
        targetCustomer = contact;
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
          metadata: params.metadata ?? null,
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
    await customerService.requireVisible(targetMessage.customerId, orgId);
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
