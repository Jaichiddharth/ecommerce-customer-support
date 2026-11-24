import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest, assertPagePermission } from "@/lib/security/auth";
import { aiAgentService } from "@/lib/services";

/** GET /api/ai-agent/gaps?status=open|resolved|ignored|all — knowledge gaps, most worth fixing first */
export const GET = withAuth(async (req: AuthenticatedRequest) => {
  assertPagePermission(req.user, "ai", "read");
  const status = new URL(req.url).searchParams.get("status") ?? "open";
  return NextResponse.json({ success: true, ...(await aiAgentService.knowledgeGaps(req.user, status)) });
});
