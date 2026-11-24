import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest, assertPagePermission } from "@/lib/security/auth";
import { aiAgentService } from "@/lib/services";
import { gapId, type GapCtx } from "../gap-id";

/** POST — ask the gap's question again now and store the new confidence */
export const POST = withAuth<GapCtx>(async (req: AuthenticatedRequest, context) => {
  assertPagePermission(req.user, "ai", "update");
  return NextResponse.json({ success: true, gap: await aiAgentService.retestGap(req.user, await gapId(context)) });
});
