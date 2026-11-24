import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest, assertPagePermission } from "@/lib/security/auth";
import { aiAgentService } from "@/lib/services";
import { gapId, type GapCtx } from "../gap-id";

/** POST — add the gap's question to the checks as it is */
export const POST = withAuth<GapCtx>(async (req: AuthenticatedRequest, context) => {
  assertPagePermission(req.user, "ai", "create");
  return NextResponse.json({ success: true, gap: await aiAgentService.gapToCheck(req.user, await gapId(context)) }, { status: 201 });
});
