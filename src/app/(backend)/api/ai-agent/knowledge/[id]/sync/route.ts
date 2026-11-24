import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest, assertPagePermission } from "@/lib/security/auth";
import { aiAgentService } from "@/lib/services";
import { AppError } from "@/lib/errors";

type Ctx = { params: Promise<{ id: string }> };

/** POST /api/ai-agent/knowledge/[id]/sync: re-index one source (e.g. a website that changed). */
export const POST = withAuth<Ctx>(async (req: AuthenticatedRequest, context) => {
  assertPagePermission(req.user, "ai", "update");
  const id = (await context?.params)?.id ?? "";
  if (!/^ks_[a-f0-9]{6,32}$/.test(id)) throw AppError.validation("Invalid source id.", "id");
  return NextResponse.json({ success: true, ...(await aiAgentService.syncKnowledge(req.user, id)) }, { status: 202 });
});
