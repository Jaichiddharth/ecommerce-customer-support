import { channelRepository } from "../db/repositories/channel.repository";
import { Channel } from "../db/schema";
import { whatsAppService, WhatsAppService } from "./channels/whatsapp.service";

export class ChannelService {
  /**
   * Channel Sub-services
   */
  readonly whatsapp: WhatsAppService = whatsAppService;

  /**
   * Common: List channels by organization and optional channel type
   * e.g. channels.list(orgId, 'whatsapp') or channels.list(orgId)
   */
  async list(organizationId: number, type?: string, options?: { includeDisconnected?: boolean }): Promise<Channel[]> {
    return await channelRepository.listByOrgAndType(organizationId, type, options);
  }

  /**
   * Common: Find channel by ID within an organization
   */
  async getById(id: number, organizationId: number): Promise<Channel | null> {
    return await channelRepository.findById(id, organizationId);
  }

  /**
   * Common: Find channel by Meta Phone Number ID
   */
  async findByPhoneId(organizationId: number, metaPhoneNumberId: string): Promise<Channel | null> {
    return await channelRepository.findByPhoneId(organizationId, metaPhoneNumberId);
  }

  /**
   * Common: Update active state of a channel
   */
  async updateStatus(id: number, organizationId: number, isActive: boolean): Promise<Channel | null> {
    return await channelRepository.updateActiveStatus(id, organizationId, isActive);
  }
}

export const channels = new ChannelService();
export const channelService = channels;
