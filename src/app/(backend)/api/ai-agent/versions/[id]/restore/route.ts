import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest, assertPagePermission } from "@/lib/security/auth";
import { parseId } from "@/lib/api/params";
import { aiAgentService } from "@/lib/services";

type Ctx = { params: Promise<{ id: string }> };

/** POST /api/ai-agent/versions/[id]/restore: copies an older version into a new live version. */
export const POST = withAuth<Ctx>(async (req: AuthenticatedRequest, context) => {
  assertPagePermission(req.user, "ai", "update");
  const id = parseId((await context?.params)?.id, "id");
  return NextResponse.json({ success: true, config: await aiAgentService.restoreVersion(req.user, id) });
});
