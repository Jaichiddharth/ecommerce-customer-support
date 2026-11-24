import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest, assertPagePermission } from "@/lib/security/auth";
import { readJson } from "@/lib/api/handler";
import { aiAgentService } from "@/lib/services";
import { AppError } from "@/lib/errors";

type Ctx = { params: Promise<{ id: string }> };

async function sourceId(context?: Ctx) {
  const id = (await context?.params)?.id ?? "";
  if (!/^ks_[a-f0-9]{6,32}$/.test(id)) throw AppError.validation("Invalid source id.", "id");
  return id;
}

/** GET /api/ai-agent/knowledge/[id]: the source's editable content. */
export const GET = withAuth<Ctx>(async (req: AuthenticatedRequest, context) => {
  assertPagePermission(req.user, "ai", "read");
  return NextResponse.json({ success: true, source: await aiAgentService.knowledgeContent(req.user, await sourceId(context)) });
});

/** PATCH /api/ai-agent/knowledge/[id] { title?, content?, uri?, enabled? }: edit, or switch draft/live. */
export const PATCH = withAuth<Ctx>(async (req: AuthenticatedRequest, context) => {
  assertPagePermission(req.user, "ai", "update");
  const source = await aiAgentService.updateKnowledge(req.user, await sourceId(context), await readJson(req));
  return NextResponse.json({ success: true, source });
});

export const DELETE = withAuth<Ctx>(async (req: AuthenticatedRequest, context) => {
  assertPagePermission(req.user, "ai", "delete");
  await aiAgentService.deleteKnowledge(req.user, await sourceId(context));
  return NextResponse.json({ success: true });
});
