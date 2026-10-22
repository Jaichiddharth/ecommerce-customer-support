import { db } from "..";
import { channels, type Channel } from "../schema";
import { eq, and } from "drizzle-orm";

export class ChannelRepository {
  /**
   * Find a channel by organization and phone number ID
   */
  async findByPhoneId(organizationId: number, metaPhoneNumberId: string): Promise<Channel | null> {
    const [channel] = await db
      .select()
      .from(channels)
      .where(
        and(
          eq(channels.organizationId, organizationId),
          eq(channels.metaPhoneNumberId, metaPhoneNumberId)
        )
      )
      .limit(1);

    return channel || null;
  }

  /**
   * Find a channel by Meta Phone Number ID across all organizations.
   * Only for inbound webhooks, where the phone number ID is how the owning organization is resolved.
   */
  async findByMetaPhoneNumberId(metaPhoneNumberId: string): Promise<Channel | null> {
    const [channel] = await db
      .select()
      .from(channels)
      .where(eq(channels.metaPhoneNumberId, metaPhoneNumberId))
      .limit(1);

    return channel || null;
  }

  /**
   * Find a channel by ID within an organization
   */
  async findById(id: number, organizationId: number): Promise<Channel | null> {
    const [channel] = await db
      .select()
      .from(channels)
      .where(and(eq(channels.id, id), eq(channels.organizationId, organizationId)))
      .limit(1);

    return channel || null;
  }

  /**
   * Find a channel by WABA ID across organizations or within an organization
   */
  async findByWabaId(wabaId: string, organizationId?: number): Promise<Channel | null> {
    const cleanWaba = wabaId.trim();
    const condition = organizationId
      ? and(eq(channels.wabaId, cleanWaba), eq(channels.organizationId, organizationId))
      : eq(channels.wabaId, cleanWaba);

    const [channel] = await db
      .select()
      .from(channels)
      .where(condition)
      .limit(1);

    return channel || null;
  }

  /**
   * Find a WhatsApp channel by phone number
   */
  async findByPhoneNumber(phoneNumber: string, organizationId?: number): Promise<Channel | null> {
    const cleanPhone = phoneNumber.trim();
    const cleanDigits = cleanPhone.replace(/\D/g, "");

    const condition = organizationId
      ? and(eq(channels.organizationId, organizationId), eq(channels.type, "whatsapp"))
      : eq(channels.type, "whatsapp");

    const waChannels = await db
      .select()
      .from(channels)
      .where(condition);

    for (const ch of waChannels) {
      if (!ch.phoneNumber) continue;
      if (ch.phoneNumber.trim() === cleanPhone) return ch;
      if (cleanDigits.length >= 7 && ch.phoneNumber.replace(/\D/g, "") === cleanDigits) {
        return ch;
      }
    }

    return null;
  }

  /**
   * Find any existing WhatsApp channel that conflicts by Phone Number ID or Phone Number.
   * WABA ID is intentionally not compared: one WABA can hold several phone numbers,
   * each connected as its own channel.
   */
  async findConflictingWhatsAppChannel(params: {
    metaPhoneNumberId?: string | null;
    phoneNumber?: string | null;
    excludeChannelId?: number;
  }): Promise<{
    conflictType: "phone_number_id" | "phone_number";
    matchedValue: string;
    channel: Channel;
  } | null> {
    const cleanPhoneId = params.metaPhoneNumberId?.trim() || null;
    const cleanPhone = params.phoneNumber?.trim() || null;
    const cleanPhoneDigits = cleanPhone ? cleanPhone.replace(/\D/g, "") : null;

    if (!cleanPhoneId && !cleanPhone) {
      return null;
    }

    const allWaChannels = await db
      .select()
      .from(channels)
      .where(eq(channels.type, "whatsapp"));

    for (const ch of allWaChannels) {
      if (params.excludeChannelId && ch.id === params.excludeChannelId) {
        continue;
      }

      // 1. Check Phone Number ID match
      if (cleanPhoneId && ch.metaPhoneNumberId && ch.metaPhoneNumberId.trim() === cleanPhoneId) {
        return {
          conflictType: "phone_number_id",
          matchedValue: cleanPhoneId,
          channel: ch,
        };
      }

      // 2. Check Phone Number match (exact or normalized digits)
      if (cleanPhone && ch.phoneNumber) {
        const existingTrimmed = ch.phoneNumber.trim();
        if (existingTrimmed === cleanPhone) {
          return {
            conflictType: "phone_number",
            matchedValue: cleanPhone,
            channel: ch,
          };
        }
        const existingDigits = existingTrimmed.replace(/\D/g, "");
        if (cleanPhoneDigits && cleanPhoneDigits.length >= 7 && existingDigits === cleanPhoneDigits) {
          return {
            conflictType: "phone_number",
            matchedValue: cleanPhone,
            channel: ch,
          };
        }
      }
    }

    return null;
  }

  /**
   * Create a new WhatsApp Channel with WABA ID
   */
  async createWhatsAppChannel(data: {
    organizationId: number;
    name: string;
    phoneNumber?: string | null;
    metaPhoneNumberId?: string | null;
    wabaId?: string | null;
    metaAccessToken?: string | null;
    isActive?: boolean;
  }): Promise<Channel> {
    const [created] = await db
      .insert(channels)
      .values({
        organizationId: data.organizationId,
        type: "whatsapp",
        name: data.name,
        phoneNumber: data.phoneNumber || null,
        metaPhoneNumberId: data.metaPhoneNumberId || null,
        wabaId: data.wabaId || null,
        metaAccessToken: data.metaAccessToken || null,
        isActive: data.isActive ?? true,
      })
      .returning();

    return created;
  }

  /**
   * Upsert a WhatsApp Channel for an organization
   */
  async upsertWhatsAppChannel(data: {
    organizationId: number;
    name: string;
    phoneNumber?: string | null;
    metaPhoneNumberId?: string | null;
    wabaId?: string | null;
    metaAccessToken?: string | null;
    isActive?: boolean;
  }): Promise<Channel> {
    const orgId = data.organizationId;

    // Check if channel exists for this phone number ID or org
    let existing: Channel | null = null;
    if (data.metaPhoneNumberId) {
      existing = await this.findByPhoneId(orgId, data.metaPhoneNumberId);
    }
    if (!existing && data.wabaId) {
      existing = await this.findByWabaId(data.wabaId, orgId);
    }

    // If not found by phone ID or WABA, check if there is an active WhatsApp channel for this org
    if (!existing) {
      const orgChannels = await this.listByOrgAndType(orgId, "whatsapp");
      if (orgChannels.length > 0 && !data.metaPhoneNumberId && !data.wabaId) {
        existing = orgChannels[0];
      }
    }

    if (existing) {
      const [updated] = await db
        .update(channels)
        .set({
          name: data.name || existing.name,
          phoneNumber: data.phoneNumber !== undefined ? data.phoneNumber : existing.phoneNumber,
          metaPhoneNumberId: data.metaPhoneNumberId !== undefined ? data.metaPhoneNumberId : existing.metaPhoneNumberId,
          wabaId: data.wabaId !== undefined ? data.wabaId : existing.wabaId,
          metaAccessToken: data.metaAccessToken || existing.metaAccessToken,
          isActive: data.isActive !== undefined ? data.isActive : existing.isActive,
          updatedAt: new Date(),
        })
        .where(eq(channels.id, existing.id))
        .returning();

      return updated;
    }

    const [created] = await db
      .insert(channels)
      .values({
        organizationId: orgId,
        type: "whatsapp",
        name: data.name,
        phoneNumber: data.phoneNumber || null,
        metaPhoneNumberId: data.metaPhoneNumberId || null,
        wabaId: data.wabaId || null,
        metaAccessToken: data.metaAccessToken || null,
        isActive: data.isActive ?? true,
      })
      .returning();

    return created;
  }

  /**
   * List channels by organization and optional channel type
   */
  async listByOrgAndType(organizationId: number, type?: string): Promise<Channel[]> {
    const condition = type
      ? and(eq(channels.organizationId, organizationId), eq(channels.type, type))
      : eq(channels.organizationId, organizationId);

    return await db
      .select()
      .from(channels)
      .where(condition);
  }

  /**
   * Update active status of a channel within an organization
   */
  async updateActiveStatus(id: number, organizationId: number, isActive: boolean): Promise<Channel | null> {
    const [updated] = await db
      .update(channels)
      .set({ isActive, updatedAt: new Date() })
      .where(and(eq(channels.id, id), eq(channels.organizationId, organizationId)))
      .returning();
    return updated || null;
  }
}

export const channelRepository = new ChannelRepository();
