import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest, assertPagePermission } from "@/lib/security/auth";
import { aiAgentService } from "@/lib/services";

/** GET /api/ai-agent/test-runs: the latest run (poll while status is "running"). */
export const GET = withAuth(async (req: AuthenticatedRequest) => {
  assertPagePermission(req.user, "ai", "read");
  return NextResponse.json({ success: true, run: await aiAgentService.latestTestRun(req.user) });
});

/** POST /api/ai-agent/test-runs: run every test case against the live configuration. */
export const POST = withAuth(async (req: AuthenticatedRequest) => {
  assertPagePermission(req.user, "ai", "update");
  return NextResponse.json({ success: true, run: await aiAgentService.startTestRun(req.user) }, { status: 202 });
});
