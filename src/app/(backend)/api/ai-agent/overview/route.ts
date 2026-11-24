import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest, assertPagePermission } from "@/lib/security/auth";
import { aiAgentService } from "@/lib/services";

/** GET /api/ai-agent/overview?days=30: KPIs, resolutions by day, top topics, recent handovers. */
export const GET = withAuth(async (req: AuthenticatedRequest) => {
  assertPagePermission(req.user, "ai", "read");
  const days = Math.min(180, Math.max(7, Number(req.nextUrl.searchParams.get("days")) || 30));
  return NextResponse.json({ success: true, overview: await aiAgentService.overview(req.user, days) });
});
