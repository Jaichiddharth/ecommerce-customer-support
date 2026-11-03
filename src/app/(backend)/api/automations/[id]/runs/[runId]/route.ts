import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest } from "@/lib/security/auth";
import { parseId } from "@/lib/api/params";
import { automationService } from "@/lib/services/automation.service";

// GET /api/automations/:id/runs/:runId — one execution: step log, waiting state, error, contact
export const GET = withAuth(async (req: AuthenticatedRequest, context?: { params: Promise<{ id: string; runId: string }> }) => {
  const p = await context!.params;
  const run = await automationService.run(req.user.organizationId, parseId(p.id), parseId(p.runId, "runId"));
  return NextResponse.json({ success: true, run });
});
