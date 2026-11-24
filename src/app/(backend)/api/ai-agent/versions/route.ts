import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest, assertPagePermission } from "@/lib/security/auth";
import { aiAgentService } from "@/lib/services";

/** GET /api/ai-agent/versions: configuration history, newest first, with test-set scores. */
export const GET = withAuth(async (req: AuthenticatedRequest) => {
  assertPagePermission(req.user, "ai", "read");
  return NextResponse.json({ success: true, versions: await aiAgentService.listVersions(req.user) });
});
