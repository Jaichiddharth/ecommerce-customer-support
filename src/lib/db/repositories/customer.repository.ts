import { db } from "..";
import { eq, and, or, sql, desc, ne, asc, ilike, inArray } from "drizzle-orm";
import { customers, messages, channels, shopifyCustomerLinks, ChannelStatus, type Customer, type NewCustomer } from "../schema";
import { createLogger } from "../../logger";
import { AppError } from "../../errors";

const log = createLogger("CustomerRepository");


export function normalizePhone(phone: string | null | undefined): string | null {
    if (!phone) return null;
    const cleaned = String(phone).replace(/\D/g, "");
    return cleaned.length > 0 ? cleaned : null;
}

/**
 * Contacts belong to a channel: once their channel is disconnected (or if they have none)
 * they are hidden from the app until the same number is reconnected.
 */
const onLiveChannel = and(eq(customers.channelId, channels.id), ne(channels.status, ChannelStatus.DISCONNECTED));

export type CustomerWithChannel = Customer & { channel: { id: number; type: string; name: string } | null };

const withChannelColumns = {
    customer: customers,
    channelId: channels.id,
    channelType: channels.type,
    channelName: channels.name,
};

const toCustomerWithChannel = (row: { customer: Customer; channelId: number; channelType: string; channelName: string }): CustomerWithChannel => ({
    ...row.customer,
    channel: { id: row.channelId, type: row.channelType, name: row.channelName },
});

/** Escapes LIKE wildcards so a search term matches literally */
const likePattern = (term: string) => `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export class CustomerRepository {
    /**
     * Find a customer whose channel is still connected. Use this for anything a user can see or act on.
     */
    async findVisibleById(id: number, organizationId: number): Promise<Customer | null> {
        const [row] = await db
            .select({ customer: customers })
            .from(customers)
            .innerJoin(channels, onLiveChannel)
            .where(and(eq(customers.id, id), eq(customers.organizationId, organizationId)))
            .limit(1);

        return row?.customer ?? null;
    }

    async createCustomer(
        orgId: number,
        customerData: {
            name: string;
            organizationId?: number;
            channelId?: number | null;
            phone?: string | null;
            email?: string | null;
            avatarUrl?: string | null;
            shopifyCustomerId?: string | null;
            tags?: string[];
            isOptedOut?: boolean;
        }
    ): Promise<Customer | null> {
        const cleanPhone = normalizePhone(customerData.phone);

        // If phone is provided, check if a customer with this number already exists under this channel
        if (cleanPhone) {
            const existing = await this.findByPhone(orgId, cleanPhone, customerData.channelId || undefined);
            if (existing) {
                // Update name or phone formatting for this channel's customer if needed
                const updates: { phone?: string | null; name?: string } = {};
                if (existing.phone !== cleanPhone) {
                    updates.phone = cleanPhone;
                }
                if (customerData.name && (!existing.name || existing.name === 'WhatsApp Customer')) {
                    updates.name = customerData.name;
                }
                if (Object.keys(updates).length > 0) {
                    const updated = await this.updateCustomer(existing.id, orgId, updates);
                    return updated || existing;
                }
                return existing;
            }
        }

        const [customer] = await db
            .insert(customers)
            .values({
                organizationId: orgId,
                channelId: customerData.channelId || null,
                name: customerData.name,
                phone: cleanPhone, // Stored strictly without '+'
                email: customerData.email ? customerData.email.trim().toLowerCase() : null,
                avatarUrl: customerData.avatarUrl || null,
                shopifyCustomerId: customerData.shopifyCustomerId || null,
                tags: customerData.tags || [],
                isOptedOut: customerData.isOptedOut ?? false,
            })
            .returning();

        return customer || null;
    }

    /**
     * Find a customer by ID within an organization
     */
    async findById(id: number, organizationId: number): Promise<Customer | null> {
        const [customer] = await db
            .select()
            .from(customers)
            .where(and(eq(customers.id, id), eq(customers.organizationId, organizationId)))
            .limit(1);

        return customer || null;
    }

    /**
     * Find a customer by phone number within an organization and optional channel.
     * When channelId is specified, strictly matches ONLY within that channel so customers on other channels are never overwritten.
     */
    async findByPhone(organizationId: number, phone: string, channelId?: number): Promise<Customer | null> {
        const cleanPhone = normalizePhone(phone);
        if (!cleanPhone) return null;
        const plusPhone = `+${cleanPhone}`;

        const phoneCondition = or(
            eq(customers.phone, cleanPhone),
            eq(customers.phone, plusPhone)
        );

        // 1. If channelId provided, strictly match organization + channel + phone
        if (channelId !== undefined && channelId !== null) {
            const [channelCustomer] = await db
                .select()
                .from(customers)
                .where(
                    and(
                        eq(customers.organizationId, organizationId),
                        eq(customers.channelId, channelId),
                        phoneCondition
                    )
                )
                .limit(1);

            return channelCustomer || null;
        }

        // 2. Fallback to matching organization + phone (across any channel) only when channelId is not specified
        const [orgCustomer] = await db
            .select()
            .from(customers)
            .where(
                and(
                    eq(customers.organizationId, organizationId),
                    phoneCondition
                )
            )
            .limit(1);

        return orgCustomer || null;
    }

    /**
     * Find a customer by email within an organization and optional channel
     */
    async findByEmail(organizationId: number, email: string, channelId?: number): Promise<Customer | null> {
        const conditions = [
            eq(customers.organizationId, organizationId),
            eq(customers.email, email.toLowerCase())
        ];
        if (channelId !== undefined) {
            conditions.push(eq(customers.channelId, channelId));
        }

        const [customer] = await db
            .select()
            .from(customers)
            .where(and(...conditions))
            .limit(1);

        return customer || null;
    }

    /**
     * Update customer details (normalizing phone if updated)
     */
    async updateCustomer(
        id: number,
        organizationId: number,
        customerData: Partial<{
            name: string;
            channelId: number | null;
            phone: string | null;
            email: string | null;
            avatarUrl: string | null;
            shopifyCustomerId: string | null;
            tags: string[];
            isOptedOut: boolean;
        }>
    ): Promise<Customer | null> {
        const updatePayload: Record<string, any> = { ...customerData, updatedAt: new Date() };
        if (customerData.phone !== undefined) {
            updatePayload.phone = normalizePhone(customerData.phone);
        }
        if (customerData.email !== undefined && customerData.email !== null) {
            updatePayload.email = customerData.email.trim().toLowerCase();
        }

        const [updated] = await db
            .update(customers)
            .set(updatePayload)
            .where(and(eq(customers.id, id), eq(customers.organizationId, organizationId)))
            .returning();

        return updated || null;
    }

    /**
     * List all customers for an organization, optionally filtered by channel
     */
    async listByOrg(organizationId: number, channelId?: number): Promise<Customer[]> {
        const rows = await db
            .select({ customer: customers })
            .from(customers)
            .innerJoin(channels, onLiveChannel)
            .where(
                and(
                    eq(customers.organizationId, organizationId),
                    channelId !== undefined ? eq(customers.channelId, channelId) : undefined
                )
            );

        return rows.map((r) => r.customer);
    }

    /**
     * List all customers for a specific channel
     */
    async listByChannel(organizationId: number, channelId: number): Promise<Customer[]> {
        return await this.listByOrg(organizationId, channelId);
    }

    /** Visible contacts of a profile: the primary contact and its channel identities, primary first */
    async listProfileMembers(organizationId: number, profileId: number): Promise<CustomerWithChannel[]> {
        const rows = await db
            .select(withChannelColumns)
            .from(customers)
            .innerJoin(channels, onLiveChannel)
            .where(
                and(
                    eq(customers.organizationId, organizationId),
                    or(eq(customers.id, profileId), eq(customers.primaryCustomerId, profileId))
                )
            )
            .orderBy(sql`${customers.primaryCustomerId} IS NOT NULL`, asc(customers.createdAt), asc(customers.id));

        return rows.map(toCustomerWithChannel);
    }

    /** Visible contacts whose name, phone, email or handle contains the term */
    async searchVisible(organizationId: number, term: string, limit = 20): Promise<CustomerWithChannel[]> {
        const pattern = likePattern(term);
        const digits = term.replace(/\D/g, "");
        const rows = await db
            .select(withChannelColumns)
            .from(customers)
            .innerJoin(channels, onLiveChannel)
            .where(
                and(
                    eq(customers.organizationId, organizationId),
                    or(
                        ilike(customers.name, pattern),
                        ilike(customers.email, pattern),
                        ilike(customers.handle, pattern),
                        digits.length >= 3 ? ilike(customers.phone, `%${digits}%`) : undefined
                    )
                )
            )
            .orderBy(desc(customers.updatedAt))
            .limit(limit);

        return rows.map(toCustomerWithChannel);
    }

    /**
     * Moves every contact of the source profile into the target profile, together with the source's
     * Shopify customer links. Fails with CONTACT_IDENTITY_CONFLICT when both profiles are linked to
     * different customers of the same store.
     */
    async mergeProfiles(organizationId: number, targetProfileId: number, sourceProfileId: number): Promise<void> {
        await db.transaction(async (tx) => {
            const links = await tx
                .select()
                .from(shopifyCustomerLinks)
                .where(
                    and(
                        eq(shopifyCustomerLinks.organizationId, organizationId),
                        inArray(shopifyCustomerLinks.customerId, [targetProfileId, sourceProfileId])
                    )
                );

            for (const sourceLink of links.filter((l) => l.customerId === sourceProfileId)) {
                const targetLink = links.find((l) => l.customerId === targetProfileId && l.shopifyStoreId === sourceLink.shopifyStoreId);
                if (targetLink?.shopifyCustomerId && sourceLink.shopifyCustomerId) {
                    throw new AppError("CONTACT_IDENTITY_CONFLICT", { details: { storeId: sourceLink.shopifyStoreId }, expected: true });
                }
                if (targetLink) {
                    // Keep whichever side has a Shopify customer; with neither, keep the target's "unlinked" marker
                    const drop = sourceLink.shopifyCustomerId ? targetLink : sourceLink;
                    await tx.delete(shopifyCustomerLinks).where(eq(shopifyCustomerLinks.id, drop.id));
                    if (drop === sourceLink) continue;
                }
                await tx
                    .update(shopifyCustomerLinks)
                    .set({ customerId: targetProfileId, updatedAt: new Date() })
                    .where(eq(shopifyCustomerLinks.id, sourceLink.id));
            }

            await tx
                .update(customers)
                .set({ primaryCustomerId: targetProfileId, updatedAt: new Date() })
                .where(
                    and(
                        eq(customers.organizationId, organizationId),
                        or(eq(customers.id, sourceProfileId), eq(customers.primaryCustomerId, sourceProfileId))
                    )
                );
        });
    }

    /**
     * Takes a contact out of its profile. When it's the primary contact, its oldest identity becomes
     * the new primary and keeps the profile's Shopify customer links.
     */
    async detachFromProfile(organizationId: number, contact: Customer): Promise<void> {
        const now = new Date();
        if (contact.primaryCustomerId) {
            await db
                .update(customers)
                .set({ primaryCustomerId: null, updatedAt: now })
                .where(and(eq(customers.id, contact.id), eq(customers.organizationId, organizationId)));
            return;
        }

        await db.transaction(async (tx) => {
            const identities = await tx
                .select({ id: customers.id })
                .from(customers)
                .where(and(eq(customers.organizationId, organizationId), eq(customers.primaryCustomerId, contact.id)))
                .orderBy(asc(customers.createdAt), asc(customers.id));
            if (identities.length === 0) return;

            const [newPrimary, ...others] = identities;
            await tx.update(customers).set({ primaryCustomerId: null, updatedAt: now }).where(eq(customers.id, newPrimary.id));
            if (others.length > 0) {
                await tx
                    .update(customers)
                    .set({ primaryCustomerId: newPrimary.id, updatedAt: now })
                    .where(inArray(customers.id, others.map((o) => o.id)));
            }
            // Identities never hold links of their own; drop any stale ones so the move can't collide
            await tx.delete(shopifyCustomerLinks).where(eq(shopifyCustomerLinks.customerId, newPrimary.id));
            await tx
                .update(shopifyCustomerLinks)
                .set({ customerId: newPrimary.id, updatedAt: now })
                .where(and(eq(shopifyCustomerLinks.organizationId, organizationId), eq(shopifyCustomerLinks.customerId, contact.id)));
        });
    }

    /**
     * Clean up existing database data:
     * 1. Strips '+' from all customer phone numbers
     * 2. Merges duplicate customer records with same phone, reassigning messages to the primary customer ID
     */
    async cleanupAndMergeDuplicates(organizationId: number): Promise<{ mergedCount: number; cleanedCount: number }> {
        try {
            const allCusts = await this.listByOrg(organizationId);
            let cleanedCount = 0;
            let mergedCount = 0;

            // Group by normalized phone AND channelId so customers on different channels are NEVER merged
            const phoneAndChannelGroups: Record<string, Customer[]> = {};

            for (const c of allCusts) {
                if (c.phone) {
                    const clean = normalizePhone(c.phone);
                    if (clean) {
                        if (c.phone !== clean) {
                            await db.update(customers).set({ phone: clean }).where(eq(customers.id, c.id));
                            c.phone = clean;
                            cleanedCount++;
                        }
                        const groupKey = `${clean}_${c.channelId ?? 'default'}`;
                        if (!phoneAndChannelGroups[groupKey]) {
                            phoneAndChannelGroups[groupKey] = [];
                        }
                        phoneAndChannelGroups[groupKey].push(c);
                    }
                }
            }

            // Merge true duplicate records within the SAME channel only
            for (const [key, group] of Object.entries(phoneAndChannelGroups)) {
                if (group.length > 1) {
                    // Sort by ID ascending (primary is first)
                    group.sort((a, b) => a.id - b.id);
                    const primary = group[0];
                    const duplicates = group.slice(1);

                    for (const dup of duplicates) {
                        // Keep the duplicate's channel identities in the profile
                        await db
                            .update(customers)
                            .set({ primaryCustomerId: sql`CASE WHEN ${customers.id} = ${primary.id} THEN NULL ELSE ${primary.id}::int END` })
                            .where(eq(customers.primaryCustomerId, dup.id));

                        // Reassign messages
                        await db
                            .update(messages)
                            .set({ customerId: primary.id, receiverId: primary.id })
                            .where(eq(messages.customerId, dup.id));

                        // Reassign receiverId if any
                        await db
                            .update(messages)
                            .set({ receiverId: primary.id })
                            .where(eq(messages.receiverId, dup.id));

                        // Delete duplicate customer
                        await db.delete(customers).where(eq(customers.id, dup.id));
                        mergedCount++;
                    }
                }
            }

            return { mergedCount, cleanedCount };
        } catch (err) {
            log.warn("Customer cleanup/merge failed — continuing without it", { err });
            return { mergedCount: 0, cleanedCount: 0 };
        }
    }
}

export const customerRepository = new CustomerRepository();
