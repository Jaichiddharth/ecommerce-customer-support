import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest, assertPagePermission } from "@/lib/security/auth";
import { readJson } from "@/lib/api/handler";
import { aiAgentService } from "@/lib/services";
import { gapId, type GapCtx } from "./gap-id";

/** PATCH { status: "ignored" | "open" } — ignore a gap, or put it back on the list */
export const PATCH = withAuth<GapCtx>(async (req: AuthenticatedRequest, context) => {
  assertPagePermission(req.user, "ai", "update");
  const body = await readJson(req);
  return NextResponse.json({ success: true, gap: await aiAgentService.setGapStatus(req.user, await gapId(context), body?.status) });
});
