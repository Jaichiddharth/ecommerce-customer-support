import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest, assertPagePermission } from "@/lib/security/auth";
import { readJson } from "@/lib/api/handler";
import { aiAgentService } from "@/lib/services";
import { gapId, type GapCtx } from "../gap-id";

/** POST { answer, question?, addToKnowledge?, addCheck? } — answer the gap; it is re-tested in the background */
export const POST = withAuth<GapCtx>(async (req: AuthenticatedRequest, context) => {
  assertPagePermission(req.user, "ai", "update");
  const body = await readJson(req);
  return NextResponse.json({ success: true, gap: await aiAgentService.resolveGap(req.user, await gapId(context), body) });
});
