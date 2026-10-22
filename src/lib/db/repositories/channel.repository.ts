import { db } from "..";
import { channels, ChannelStatus, type Channel } from "../schema";
import { eq, and, ne } from "drizzle-orm";

/** A disconnected channel is kept only for history: it is never listed, routed to or sent from. */
const isLive = ne(channels.status, ChannelStatus.DISCONNECTED);

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
      .where(and(eq(channels.metaPhoneNumberId, metaPhoneNumberId), isLive))
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
   * All live channels on a WABA, across organizations (used to tell whether a WABA is still in use).
   */
  async findByWabaIdLive(wabaId: string): Promise<Channel[]> {
    return await db
      .select()
      .from(channels)
      .where(and(eq(channels.wabaId, wabaId.trim()), isLive));
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
   * Every WhatsApp channel row for a number, across all organizations and statuses (disconnected included).
   * Matched by Meta Phone Number ID, or by phone number digits. WABA ID is intentionally not compared:
   * one WABA can hold several phone numbers, each connected as its own channel.
   * Used for ownership checks: a number belongs to whichever workspace has it connected right now.
   */
  async findWhatsAppChannelsForNumber(params: {
    metaPhoneNumberId?: string | null;
    phoneNumber?: string | null;
  }): Promise<Channel[]> {
    const cleanPhoneId = params.metaPhoneNumberId?.trim() || null;
    const cleanDigits = params.phoneNumber?.replace(/\D/g, "") || "";

    if (!cleanPhoneId && cleanDigits.length < 7) {
      return [];
    }

    const allWaChannels = await db
      .select()
      .from(channels)
      .where(eq(channels.type, "whatsapp"));

    return allWaChannels.filter(
      (ch) =>
        (cleanPhoneId && ch.metaPhoneNumberId?.trim() === cleanPhoneId) ||
        (cleanDigits.length >= 7 && ch.phoneNumber?.replace(/\D/g, "") === cleanDigits)
    );
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
   * Store fresh Meta credentials on a workspace's existing WhatsApp channel and mark it connected.
   * Used when the owner reconnects a disconnected number or runs the connect flow again.
   */
  async reconnectWhatsAppChannel(
    id: number,
    data: {
      name: string;
      phoneNumber?: string | null;
      metaPhoneNumberId?: string | null;
      wabaId?: string | null;
      metaAccessToken?: string | null;
    }
  ): Promise<Channel> {
    const [updated] = await db
      .update(channels)
      .set({
        name: data.name,
        phoneNumber: data.phoneNumber || null,
        metaPhoneNumberId: data.metaPhoneNumberId || null,
        wabaId: data.wabaId || null,
        metaAccessToken: data.metaAccessToken || null,
        status: ChannelStatus.CONNECTED,
        lastError: null,
        tokenExpiresAt: null,
        isActive: true,
        updatedAt: new Date(),
      })
      .where(eq(channels.id, id))
      .returning();

    return updated;
  }

  /**
   * Soft-disconnect a channel: kept for conversation history, but hidden and never used again.
   * The stored Meta token is wiped so it can't be used after the user disconnected.
   */
  async markDisconnected(id: number, organizationId: number): Promise<Channel | null> {
    const [updated] = await db
      .update(channels)
      .set({
        status: ChannelStatus.DISCONNECTED,
        isActive: false,
        metaAccessToken: null,
        tokenExpiresAt: null,
        lastError: null,
        updatedAt: new Date(),
      })
      .where(and(eq(channels.id, id), eq(channels.organizationId, organizationId)))
      .returning();

    return updated || null;
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
   * List an organization's channels (optionally of one type). Disconnected channels are left out
   * unless includeDisconnected is set, so nothing in the app lists, routes to or sends from them.
   */
  async listByOrgAndType(
    organizationId: number,
    type?: string,
    { includeDisconnected = false }: { includeDisconnected?: boolean } = {}
  ): Promise<Channel[]> {
    const condition = and(
      eq(channels.organizationId, organizationId),
      type ? eq(channels.type, type) : undefined,
      includeDisconnected ? undefined : isLive
    );

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
