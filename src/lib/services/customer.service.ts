import { Customer } from "../db";
import { customerRepository } from "../db/repositories";
import { AppError } from "../errors";

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
   * A customer the user may see and act on: it must exist and its channel must still be connected.
   * Contacts of a disconnected channel are hidden until the same number is reconnected.
   */
  async requireVisible(id: number, organizationId: number): Promise<Customer> {
    const visible = await customerRepository.findVisibleById(id, organizationId);
    if (visible) return visible;

    if (await customerRepository.findById(id, organizationId)) {
      throw new AppError("WHATSAPP_CHANNEL_DISCONNECTED", { details: { customerId: id }, expected: true });
    }
    throw AppError.notFound("Customer not found.");
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
