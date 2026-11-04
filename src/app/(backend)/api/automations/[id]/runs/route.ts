import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest } from "@/lib/security/auth";
import { optionalInt, parseId } from "@/lib/api/params";
import { automationService } from "@/lib/services/automation.service";

// GET /api/automations/:id/runs?status=&page=&pageSize= — execution history, newest first
export const GET = withAuth(async (req: AuthenticatedRequest, context?: { params: Promise<{ id: string }> }) => {
  const id = parseId((await context!.params).id);
  const sp = req.nextUrl.searchParams;
  const result = await automationService.runs(req.user.organizationId, id, {
    status: sp.get("status") || undefined,
    page: optionalInt(sp.get("page")),
    pageSize: optionalInt(sp.get("pageSize")),
  });
  return NextResponse.json({ success: true, ...result });
});
