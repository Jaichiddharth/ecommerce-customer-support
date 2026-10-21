import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest } from "@/lib/security/auth";
import { conversationService } from "@/lib/services";

/**
 * GET /api/conversations
 * Inbox list: latest conversation per customer with channel, AI state, unread count and last message.
 */
export const GET = withAuth(async (req: AuthenticatedRequest) => {
  const conversations = await conversationService.listForInbox(req.user.organizationId);

  return NextResponse.json({
    success: true,
    conversations,
    count: conversations.length,
  });
});
