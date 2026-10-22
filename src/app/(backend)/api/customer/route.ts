import { customerService, channelService } from "@/lib/services";
import { withAuth, AuthenticatedRequest } from "@/lib/security/auth";
import { NextResponse } from "next/server";
import { AppError } from "@/lib/errors";
import { readJson } from "@/lib/api/handler";
import { conversationRepository } from "@/lib/db/repositories";
import { ChannelStatus } from "@/lib/db/schema";

export const POST = withAuth(async (req: AuthenticatedRequest) => {
  const body = await readJson(req);
  const { channelId, name, phone, email, avatarUrl, shopifyCustomerId, tags, isOptedOut } = body ?? {};

  if (!name || typeof name !== "string" || !name.trim()) {
    throw AppError.validation("Customer name is required.", "name");
  }

  if (channelId === undefined || channelId === null || channelId === "") {
    throw AppError.validation("Please select the WhatsApp channel this customer belongs to.", "channelId");
  }

  const channel = await channelService.getById(Number(channelId), req.user.organizationId);
  if (!channel || channel.status === ChannelStatus.DISCONNECTED) {
    throw new AppError("WHATSAPP_CHANNEL_NOT_FOUND", { details: { channelId }, expected: true });
  }

  const cleanPhone = phone ? String(phone).replace(/\D/g, "") : null;

  // Directly access req.user from backend middleware!
  const customer = await customerService.createCustomer({
    organizationId: req.user.organizationId,
    channelId: channel.id,
    name: name.trim(),
    phone: cleanPhone, // Stored strictly without '+'
    email: email ? String(email).trim().toLowerCase() : null,
    avatarUrl: avatarUrl ? String(avatarUrl).trim() : null,
    shopifyCustomerId: shopifyCustomerId ? String(shopifyCustomerId).trim() : null,
    tags: Array.isArray(tags) ? tags : [],
    isOptedOut: Boolean(isOptedOut),
  });

  // Show the new contact in the inbox before the first message is exchanged
  if (customer) {
    await conversationRepository.ensureForCustomer(req.user.organizationId, customer.id, customer.channelId);
  }

  return NextResponse.json({ success: true, customer }, { status: 201 });
});

export const GET = withAuth(async (req: AuthenticatedRequest) => {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  const channelId = searchParams.get("channelId");

  if (id) {
    if (isNaN(Number(id))) throw AppError.validation("Invalid customer id.", "id");
    const customer = await customerService.getCustomerById(Number(id), req.user.organizationId);
    if (!customer) {
      throw AppError.notFound("Customer not found.");
    }
    return NextResponse.json({ success: true, customer });
  }

  // Auto-clean any legacy '+' prefixes and merge any existing duplicates
  await customerService.cleanupAndMergeDuplicates(req.user.organizationId);

  const customers = await customerService.listCustomers(
    req.user.organizationId,
    channelId ? Number(channelId) : undefined
  );
  return NextResponse.json({
    success: true,
    customers,
    count: customers.length,
  });
});
