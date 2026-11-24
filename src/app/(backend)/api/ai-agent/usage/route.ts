import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest, assertPagePermission } from "@/lib/security/auth";
import { aiAgentService } from "@/lib/services";

/** GET /api/ai-agent/usage: this month's AI resolutions against the plan, speed, tokens, cost. */
export const GET = withAuth(async (req: AuthenticatedRequest) => {
  assertPagePermission(req.user, "ai", "read");
  return NextResponse.json({ success: true, usage: await aiAgentService.usage(req.user) });
});
