import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest, assertPagePermission } from "@/lib/security/auth";
import { conversationService } from "@/lib/services";

/**
 * GET /api/conversations
 * Inbox list: latest conversation per customer with channel, AI state, unread count and last message,
 * plus the workspace's ticket credits (mock billing).
 */
export const GET = withAuth(async (req: AuthenticatedRequest) => {
  assertPagePermission(req.user, "inbox", "read");
  const orgId = req.user.organizationId;
  const canSeeAll = req.user.permissions?.see_all_chats ?? true;

  const [conversations, ticketCredits] = await Promise.all([
    conversationService.listForInbox(orgId, canSeeAll ? undefined : req.user.id),
    conversationService.ticketCredits(orgId),
  ]);

  return NextResponse.json({
    success: true,
    conversations,
    count: conversations.length,
    // Mock billing: ticket credits used by teammates' first replies
    ticketCredits,
  });
});
