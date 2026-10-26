import { Customer } from "../db";
import { customerRepository, type CustomerWithChannel } from "../db/repositories";
import { AppError } from "../errors";
import { createLogger } from "../logger";
import type { ContactIdentity } from "@/types";

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
