import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest } from "@/lib/security/auth";
import { messageRepository } from "@/lib/db/repositories/message.repository";
import { customerRepository } from "@/lib/db/repositories/customer.repository";
import { MessageStatus } from "@/lib/db/schema";
import { publish } from "@/lib/realtime";
import { AppError } from "@/lib/errors";
import { readJson } from "@/lib/api/handler";

/**
 * GET /api/messages?customerId=123
 * Fetch all messages for a customer from PostgreSQL in chronological order
 */
export const GET = withAuth(async (req: AuthenticatedRequest) => {
  const orgId = req.user.organizationId;
  const { searchParams } = new URL(req.url);
  const customerIdStr = searchParams.get("customerId");

  if (!customerIdStr) {
    throw AppError.validation("customerId query parameter is required.", "customerId");
  }

  const customerId = Number(customerIdStr);
  if (isNaN(customerId)) {
    throw AppError.validation("Invalid customerId parameter.", "customerId");
  }

  const messages = await messageRepository.listByCustomer(customerId, orgId);

  // Automatically mark unread incoming messages as read when fetched
  await messageRepository.markAsReadByCustomer(customerId, orgId);

  return NextResponse.json({
    success: true,
    messages,
    total: messages.length,
  });
});

/**
 * POST /api/messages
 * Store a custom message or internal note directly
 */
export const POST = withAuth(async (req: AuthenticatedRequest) => {
  const orgId = req.user.organizationId;
  const body = await readJson(req);
  const { customerId, textContent, mediaUrl, mediaType, isInternalNote, status, errorCode, repliedToId } = body ?? {};

  if (!customerId) {
    throw AppError.validation("customerId is required.", "customerId");
  }

  const customer = await customerRepository.findById(Number(customerId), orgId);
  if (!customer) {
    throw AppError.notFound("Customer not found.");
  }

  const repliedTo = repliedToId
    ? await messageRepository.findById(Number(repliedToId), orgId)
    : null;

  const createdMessage = await messageRepository.createMessage({
    organizationId: orgId,
    customerId: customer.id,
    senderType: isInternalNote ? "system" : "agent",
    senderId: req.user.id,
    receiverId: customer.id,
    textContent: textContent || null,
    mediaUrl: mediaUrl || null,
    mediaType: mediaType || "text",
    isInternalNote: Boolean(isInternalNote),
    status: status !== undefined ? status : isInternalNote ? MessageStatus.READ : MessageStatus.SENT,
    errorCode: errorCode ? Number(errorCode) : null,
    repliedToId: repliedTo?.id ?? null,
    createdAt: new Date(),
  });

  const message = createdMessage ? { ...createdMessage, senderName: req.user.name } : null;

  if (message) {
    publish(orgId, {
      type: "message.new",
      customerId: customer.id,
      message,
    });
  }

  return NextResponse.json({
    success: true,
    message,
  });
});
