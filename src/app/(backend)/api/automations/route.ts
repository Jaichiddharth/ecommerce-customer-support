import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest } from "@/lib/security/auth";
import { readJson } from "@/lib/api/handler";
import { optionalInt } from "@/lib/api/params";
import { automationService } from "@/lib/services/automation.service";

// GET /api/automations?q=&status=&trigger=&modified=&execution=&page=&pageSize=
// Listing with derived status (draft/active/paused/failed/archived), trigger, node count and run stats.
export const GET = withAuth(async (req: AuthenticatedRequest) => {
  const sp = req.nextUrl.searchParams;
  const result = await automationService.listing(req.user.organizationId, {
    q: sp.get("q") ?? undefined,
    status: sp.get("status") || undefined,
    trigger: sp.get("trigger") || undefined,
    modified: sp.get("modified") || undefined,
    execution: sp.get("execution") || undefined,
    page: optionalInt(sp.get("page")),
    pageSize: optionalInt(sp.get("pageSize")),
  });
  return NextResponse.json({ success: true, ...result });
});

// POST /api/automations  { name, description?, graph: { nodes, edges }, isActive? }
export const POST = withAuth(async (req: AuthenticatedRequest) => {
  const body = (await readJson(req)) ?? {};
  const automation = await automationService.create(req.user.organizationId, req.user.id, body);
  return NextResponse.json({ success: true, automation }, { status: 201 });
});
