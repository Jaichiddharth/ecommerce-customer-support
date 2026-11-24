import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest, assertPagePermission } from "@/lib/security/auth";
import { readJson } from "@/lib/api/handler";
import { aiAgentService } from "@/lib/services";
import { AppError } from "@/lib/errors";

/** POST /api/ai-agent/status { enabled }: put the agent live or pause it. */
export const POST = withAuth(async (req: AuthenticatedRequest) => {
  assertPagePermission(req.user, "ai", "update");
  const body = await readJson(req);
  if (typeof body?.enabled !== "boolean") throw AppError.validation("enabled must be true or false.", "enabled");
  return NextResponse.json({ success: true, config: await aiAgentService.setEnabled(req.user, body.enabled) });
});
