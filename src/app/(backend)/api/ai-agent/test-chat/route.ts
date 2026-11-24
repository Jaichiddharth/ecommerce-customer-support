import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest, assertPagePermission } from "@/lib/security/auth";
import { readJson } from "@/lib/api/handler";
import { aiAgentService } from "@/lib/services";

/**
 * POST /api/ai-agent/test-chat { conversationId, messages, testAs?, channel?, policy? }
 * Runs the real pipeline without sending anything to customers. `policy` lets the Guardrails tab
 * try unsaved changes. Test chats are excluded from metrics and don't count toward AI resolutions.
 */
export const POST = withAuth(async (req: AuthenticatedRequest) => {
  assertPagePermission(req.user, "ai", "read");
  const reply = await aiAgentService.testChat(req.user, await readJson(req));
  return NextResponse.json({ success: true, reply });
});
