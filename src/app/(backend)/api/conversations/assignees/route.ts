import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest, assertPagePermission } from "@/lib/security/auth";
import { conversationService } from "@/lib/services";

/**
 * GET /api/conversations/assignees
 * Teammates a ticket can be assigned to (joined members who can reply), for the inbox's assignee menu.
 * Needs inbox access only, unlike /api/team, so agents can hand tickets to each other.
 */
export const GET = withAuth(async (req: AuthenticatedRequest) => {
  assertPagePermission(req.user, "inbox", "read");
  const teammates = await conversationService.listAssignees(req.user.organizationId);
  return NextResponse.json({ success: true, teammates });
});
