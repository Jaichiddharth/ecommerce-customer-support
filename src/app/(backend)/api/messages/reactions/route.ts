import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest } from "@/lib/security/auth";
import { whatsAppService } from "@/lib/services/channels/whatsapp.service";
import { AppError } from "@/lib/errors";
import { readJson } from "@/lib/api/handler";

/**
 * POST /api/messages/reactions
 * Add, update, or remove reaction for a message from an agent/user
 */
export const POST = withAuth(async (req: AuthenticatedRequest) => {
  const orgId = req.user.organizationId;
  const body = await readJson(req);
  const { messageId, emoji, to, channelId } = body ?? {};

  if (!messageId) {
    throw AppError.validation("messageId is required.", "messageId");
  }

  const res = await whatsAppService.sendReaction({
    organizationId: orgId,
    messageId: Number(messageId),
    userId: req.user.id,
    emoji: emoji || "",
    to: to || undefined,
    channelId: channelId ? Number(channelId) : undefined,
  });

  return NextResponse.json({
    success: true,
    reaction: res.reaction,
    // false when the reaction was saved but WhatsApp didn't accept it (UI shows a warning)
    metaDelivered: res.metaDelivered,
    metaError: res.metaError,
  });
});
