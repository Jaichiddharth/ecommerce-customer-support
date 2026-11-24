import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest, assertPagePermission } from "@/lib/security/auth";
import { readJson } from "@/lib/api/handler";
import { aiAgentService } from "@/lib/services";

/** POST /api/ai-agent/byo/test { provider, model, apiKey? }: one tiny call with the key (saved key if left out) */
export const POST = withAuth(async (req: AuthenticatedRequest) => {
  assertPagePermission(req.user, "ai", "update");
  return NextResponse.json({ success: true, test: await aiAgentService.testByo(req.user, await readJson(req)) });
});
