import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest, assertPagePermission } from "@/lib/security/auth";
import { conversationService } from "@/lib/services";

/**
 * GET /api/conversations
 * Inbox list: latest conversation per customer with channel, AI state, unread count and last message.
 */
export const GET = withAuth(async (req: AuthenticatedRequest) => {
  assertPagePermission(req.user, "inbox", "read");
  const orgId = req.user.organizationId;
  const canSeeAll = req.user.permissions?.see_all_chats ?? true;

  const conversations = await conversationService.listForInbox(
    orgId,
    canSeeAll ? undefined : req.user.id
  );

  return NextResponse.json({
    success: true,
    conversations,
    count: conversations.length,
  });
});
