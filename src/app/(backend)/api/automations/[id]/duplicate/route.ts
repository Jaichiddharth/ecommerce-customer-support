import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest } from "@/lib/security/auth";
import { parseId } from "@/lib/api/params";
import { automationService } from "@/lib/services/automation.service";

// POST /api/automations/:id/duplicate — copy as a new Draft (never active)
export const POST = withAuth(async (req: AuthenticatedRequest, context?: { params: Promise<{ id: string }> }) => {
  const id = parseId((await context!.params).id);
  const automation = await automationService.duplicate(req.user.organizationId, req.user.id, id);
  return NextResponse.json({ success: true, automation }, { status: 201 });
});
