import { Customer } from "../db";
import { customerRepository, channelRepository, type CustomerWithChannel, type ContactListFilter } from "../db/repositories";
import { AppError } from "../errors";
import { createLogger } from "../logger";
import type { ContactIdentity } from "@/types";
import type { ContactChannelSummary, ContactListItem } from "@/types/contacts";

const log = createLogger("CustomerService");

const toContactIdentity = (c: CustomerWithChannel): ContactIdentity => ({
  id: c.id,
  name: c.name,
  phone: c.phone,
  email: c.email,
  handle: c.handle,
  isPrimary: !c.primaryCustomerId,
  channel: c.channel,
  createdAt: c.createdAt.toISOString(),
});

export class CustomerService {
  async createCustomer(customerDto: {
    organizationId: number;
    channelId?: number | null;
    name: string;
    phone?: string | null;
    email?: string | null;
    avatarUrl?: string | null;
    shopifyCustomerId?: string | null;
    tags?: string[];
    isOptedOut?: boolean;
  }): Promise<Customer | null> {
    return await customerRepository.createCustomer(customerDto.organizationId, customerDto);
  }

  async listCustomers(organizationId: number, channelId?: number): Promise<Customer[]> {
    return await customerRepository.listByOrg(organizationId, channelId);
  }

  /**
   * One page of one channel's contacts, plus every live channel with its contact and opted-out counts.
   * Without a channelId it lists the first live channel. channelId is null when the workspace has no live channel.
   */
  async listContacts(
    organizationId: number,
    filter: Omit<ContactListFilter, "channelId"> & { channelId?: number }
  ): Promise<{ channelId: number | null; contacts: ContactListItem[]; total: number; channels: ContactChannelSummary[] }> {
    const [counts, liveChannels] = await Promise.all([
      customerRepository.countByChannel(organizationId),
      channelRepository.listByOrgAndType(organizationId, undefined, { includeDisconnected: false }),
    ]);

    const channels = [...liveChannels].sort((a, b) => a.id - b.id).map((ch): ContactChannelSummary => {
      const count = counts.find((c) => c.channelId === ch.id);
      return {
        id: ch.id,
        type: ch.type,
        name: ch.name,
        phoneNumber: ch.phoneNumber,
        handle: ch.handle,
        total: count?.total ?? 0,
        optedOut: count?.optedOut ?? 0,
      };
    });

    const channelId = filter.channelId ?? channels[0]?.id ?? null;
    if (channelId === null) return { channelId, contacts: [], total: 0, channels };

    const { rows, total } = await customerRepository.listContacts(organizationId, { ...filter, channelId });

    const contacts = rows.map(
      (c): ContactListItem => ({
        id: c.id,
        name: c.name,
        phone: c.phone,
        email: c.email,
        handle: c.handle,
        avatarUrl: c.avatarUrl,
        isOptedOut: Boolean(c.isOptedOut),
        channel: c.channel!,
        lastActiveAt: c.lastActiveAt ? c.lastActiveAt.toISOString() : null,
        hasConversation: c.hasConversation,
        createdAt: c.createdAt.toISOString(),
      })
    );

    return { channelId, contacts, total, channels };
  }

  /** Visible contacts and opt-outs per live channel id */
  async contactCountsByChannel(organizationId: number): Promise<Map<number, { total: number; optedOut: number }>> {
    const counts = await customerRepository.countByChannel(organizationId);
    return new Map(counts.map((c) => [c.channelId, { total: c.total, optedOut: c.optedOut }]));
  }

  async listCustomersByChannel(organizationId: number, channelId: number): Promise<Customer[]> {
    return await customerRepository.listByChannel(organizationId, channelId);
  }

  async getCustomerById(id: number, organizationId: number): Promise<Customer | null> {
    return await customerRepository.findVisibleById(id, organizationId);
  }

  /**
   * Require a customer to exist within the organization.
   * Customers and their logs remain visible even after their channel is disconnected.
   */
  async requireVisible(id: number, organizationId: number): Promise<Customer> {
    const customer = await customerRepository.findById(id, organizationId);
    if (!customer) {
      throw AppError.notFound("Customer not found.");
    }
    return customer;
  }

  /** The primary contact of the profile this contact belongs to (itself when it has no other channel identities) */
  profileIdOf(customer: Pick<Customer, "id" | "primaryCustomerId">): number {
    return customer.primaryCustomerId ?? customer.id;
  }

  async listIdentities(id: number, organizationId: number): Promise<ContactIdentity[]> {
    const customer = await this.requireVisible(id, organizationId);
    const members = await customerRepository.listProfileMembers(organizationId, this.profileIdOf(customer));
    return members.map(toContactIdentity);
  }

  /** Contacts to offer as another channel identity, leaving out the ones already in this contact's profile */
  async searchIdentityCandidates(id: number, organizationId: number, term: string): Promise<ContactIdentity[]> {
    const customer = await this.requireVisible(id, organizationId);
    const q = term.trim().slice(0, 100);
    if (q.length < 2) return [];

    const profileId = this.profileIdOf(customer);
    const found = await customerRepository.searchVisible(organizationId, q);
    return found.filter((c) => this.profileIdOf(c) !== profileId).map(toContactIdentity);
  }

  /** Adds the other contact, with every identity in its profile, to this contact's profile */
  async linkIdentity(id: number, organizationId: number, otherId: number): Promise<ContactIdentity[]> {
    if (id === otherId) throw AppError.validation("Choose a different contact.", "contactId");
    const customer = await this.requireVisible(id, organizationId);
    const other = await this.requireVisible(otherId, organizationId);

    const profileId = this.profileIdOf(customer);
    const otherProfileId = this.profileIdOf(other);
    if (profileId === otherProfileId) {
      throw new AppError("CONFLICT", { message: `${other.name} is already linked to this contact.`, expected: true });
    }

    await customerRepository.mergeProfiles(organizationId, profileId, otherProfileId);
    log.info("Contact identities linked", { organizationId, profileId, mergedProfileId: otherProfileId });
    return (await customerRepository.listProfileMembers(organizationId, profileId)).map(toContactIdentity);
  }

  /** Takes one identity out of this contact's profile; returns the identities this contact still has */
  async unlinkIdentity(id: number, organizationId: number, memberId: number): Promise<ContactIdentity[]> {
    const customer = await this.requireVisible(id, organizationId);
    const member = memberId === id ? customer : await this.requireVisible(memberId, organizationId);
    if (this.profileIdOf(member) !== this.profileIdOf(customer)) {
      throw AppError.notFound("This contact isn't linked to the conversation's contact.");
    }

    const before = await customerRepository.listProfileMembers(organizationId, this.profileIdOf(customer));
    if (before.length < 2) throw AppError.validation("This contact has no other channels linked.", "contactId");

    await customerRepository.detachFromProfile(organizationId, member);
    log.info("Contact identity unlinked", { organizationId, customerId: member.id });
    return this.listIdentities(id, organizationId);
  }

  async getCustomerByPhone(organizationId: number, phone: string, channelId?: number): Promise<Customer | null> {
    return await customerRepository.findByPhone(organizationId, phone, channelId);
  }

  async getCustomerByEmail(organizationId: number, email: string, channelId?: number): Promise<Customer | null> {
    return await customerRepository.findByEmail(organizationId, email, channelId);
  }

  async cleanupAndMergeDuplicates(organizationId: number) {
    return await customerRepository.cleanupAndMergeDuplicates(organizationId);
  }
}

export const customerClass = new CustomerService();
export const customerService = customerClass;
