import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest, assertPagePermission } from "@/lib/security/auth";
import { readJson } from "@/lib/api/handler";
import { aiAgentService } from "@/lib/services";

/** GET /api/ai-agent/knowledge: sources and index stats. */
export const GET = withAuth(async (req: AuthenticatedRequest) => {
  assertPagePermission(req.user, "ai", "read");
  return NextResponse.json({ success: true, ...(await aiAgentService.listKnowledge(req.user)) });
});

/** POST /api/ai-agent/knowledge { type: text|markdown|faq|url, title, content?, uri? }: indexed in the background. */
export const POST = withAuth(async (req: AuthenticatedRequest) => {
  assertPagePermission(req.user, "ai", "create");
  const source = await aiAgentService.addKnowledge(req.user, await readJson(req));
  return NextResponse.json({ success: true, source }, { status: 202 });
});
