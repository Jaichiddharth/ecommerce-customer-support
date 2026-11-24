import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest, assertPagePermission } from "@/lib/security/auth";
import { aiAgentService } from "@/lib/services";

/** POST /api/ai-agent/knowledge/rebuild: re-index every source. */
export const POST = withAuth(async (req: AuthenticatedRequest) => {
  assertPagePermission(req.user, "ai", "update");
  return NextResponse.json({ success: true, ...(await aiAgentService.rebuildIndex(req.user)) }, { status: 202 });
});
