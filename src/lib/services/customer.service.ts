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
