import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest, assertPagePermission } from "@/lib/security/auth";
import { messageRepository } from "@/lib/db/repositories/message.repository";
import { customerService } from "@/lib/services";
import { MessageStatus } from "@/lib/db/schema";
import { publish } from "@/lib/realtime";
import { AppError } from "@/lib/errors";
import { readJson } from "@/lib/api/handler";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

/**
 * GET /api/messages?customerId=123&limit=50&before=<messageId>
 * One batch of a customer's messages in chronological order. Without `before` it is the newest batch;
 * pass the oldest loaded message id as `before` to get the batch above it.
 */
export const GET = withAuth(async (req: AuthenticatedRequest) => {
  assertPagePermission(req.user, "inbox", "read");
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

  const limitParam = searchParams.get("limit");
  const limit = limitParam ? Number(limitParam) : DEFAULT_PAGE_SIZE;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
    throw AppError.validation(`limit must be between 1 and ${MAX_PAGE_SIZE}.`, "limit");
  }

  const beforeParam = searchParams.get("before");
  const beforeId = beforeParam ? Number(beforeParam) : null;
  if (beforeParam && (!Number.isInteger(beforeId) || beforeId! < 1)) {
    throw AppError.validation("Invalid before parameter.", "before");
  }

  await customerService.requireVisible(customerId, orgId);

  const { messages, hasMore } = await messageRepository.listPageByCustomer(customerId, orgId, { limit, beforeId });

  // Opening the thread (newest batch) marks unread incoming messages as read
  if (!beforeId) {
    await messageRepository.markAsReadByCustomer(customerId, orgId);
  }

  return NextResponse.json({
    success: true,
    messages,
    hasMore,
    nextCursor: hasMore && messages.length > 0 ? messages[0].id : null,
  });
});

/**
 * POST /api/messages
 * Store a custom message or internal note directly
 */
export const POST = withAuth(async (req: AuthenticatedRequest) => {
  assertPagePermission(req.user, "inbox", "update");
  const orgId = req.user.organizationId;

  const body = await readJson(req);
  const { customerId, textContent, mediaUrl, mediaType, isInternalNote, status, errorCode, repliedToId } = body ?? {};

  if (!customerId) {
    throw AppError.validation("customerId is required.", "customerId");
  }

  const customer = await customerService.requireVisible(Number(customerId), orgId);

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
