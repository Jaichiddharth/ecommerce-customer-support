import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest, assertPagePermission } from "@/lib/security/auth";
import { readJson } from "@/lib/api/handler";
import { aiAgentService } from "@/lib/services";
import { AppError } from "@/lib/errors";

/** GET /api/ai-agent/config: live policy, live/paused, plan limits. */
export const GET = withAuth(async (req: AuthenticatedRequest) => {
  assertPagePermission(req.user, "ai", "read");
  return NextResponse.json({ success: true, config: await aiAgentService.getConfig(req.user) });
});

/** PUT /api/ai-agent/config { policy, note? }: saves a new version and makes it live. */
export const PUT = withAuth(async (req: AuthenticatedRequest) => {
  assertPagePermission(req.user, "ai", "update");
  const body = await readJson(req);
  if (!body?.policy || typeof body.policy !== "object") throw AppError.validation("Missing policy.", "policy");
  const config = await aiAgentService.savePolicy(req.user, body.policy, typeof body.note === "string" ? body.note : undefined);
  return NextResponse.json({ success: true, config });
});
