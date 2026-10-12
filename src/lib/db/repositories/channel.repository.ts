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
   * Upsert a WhatsApp Channel for an organization
   */
  async upsertWhatsAppChannel(data: {
    organizationId: number;
    name: string;
    phoneNumber?: string | null;
    metaPhoneNumberId?: string | null;
    metaAccessToken?: string | null;
    isActive?: boolean;
  }): Promise<Channel> {
    const orgId = data.organizationId;

    // Check if channel exists for this phone number ID or org
    let existing: Channel | null = null;
    if (data.metaPhoneNumberId) {
      existing = await this.findByPhoneId(orgId, data.metaPhoneNumberId);
    }

    // If not found by phone ID, check if there is an active WhatsApp channel for this org
    if (!existing) {
      const orgChannels = await this.listByOrgAndType(orgId, "whatsapp");
      if (orgChannels.length > 0 && !data.metaPhoneNumberId) {
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
