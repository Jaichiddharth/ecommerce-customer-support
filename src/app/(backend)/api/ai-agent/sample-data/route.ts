import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest, assertPagePermission } from "@/lib/security/auth";
import { aiSampleDataService } from "@/lib/services";

/** GET /api/ai-agent/sample-data: the workspace's sample orders and products (summaries and previews) */
export const GET = withAuth(async (req: AuthenticatedRequest) => {
  assertPagePermission(req.user, "ai", "read");
  return NextResponse.json({ success: true, sample: await aiSampleDataService.get(req.user) });
});
