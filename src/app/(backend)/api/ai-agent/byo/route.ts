import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest, assertPagePermission } from "@/lib/security/auth";
import { readJson } from "@/lib/api/handler";
import { aiAgentService } from "@/lib/services";

/** GET /api/ai-agent/byo: the own-model setup (provider, model, key hint; never the key) */
export const GET = withAuth(async (req: AuthenticatedRequest) => {
  assertPagePermission(req.user, "ai", "read");
  return NextResponse.json({ success: true, byo: await aiAgentService.getByo(req.user) });
});

/** PUT /api/ai-agent/byo { provider, model, apiKey?, monthlyLimitUsd? }: tests the key, then saves it encrypted */
export const PUT = withAuth(async (req: AuthenticatedRequest) => {
  assertPagePermission(req.user, "ai", "update");
  const result = await aiAgentService.saveByo(req.user, await readJson(req));
  return NextResponse.json({ success: true, ...result });
});

/** DELETE /api/ai-agent/byo: removes the key (a live version using it moves to UnoCX Standard) */
export const DELETE = withAuth(async (req: AuthenticatedRequest) => {
  assertPagePermission(req.user, "ai", "update");
  return NextResponse.json({ success: true, config: await aiAgentService.removeByo(req.user) });
});
