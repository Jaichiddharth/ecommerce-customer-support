import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest } from "@/lib/security/auth";
import { readJson } from "@/lib/api/handler";
import { parseId } from "@/lib/api/params";
import { automationService } from "@/lib/services/automation.service";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withAuth(async (req: AuthenticatedRequest, context?: Ctx) => {
  const id = parseId((await context!.params).id);
  return NextResponse.json({ success: true, automation: await automationService.require(req.user.organizationId, id) });
});

// PUT /api/automations/:id  { name?, description?, graph?, isActive? } — activation is validated (Flows published, templates approved)
export const PUT = withAuth(async (req: AuthenticatedRequest, context?: Ctx) => {
  const id = parseId((await context!.params).id);
  const body = (await readJson(req)) ?? {};
  const automation = await automationService.update(req.user.organizationId, id, body);
  return NextResponse.json({ success: true, automation });
});

// DELETE /api/automations/:id — deletes a never-run automation, otherwise archives it (history is kept)
export const DELETE = withAuth(async (req: AuthenticatedRequest, context?: Ctx) => {
  const id = parseId((await context!.params).id);
  const result = await automationService.remove(req.user.organizationId, id);
  return NextResponse.json({ success: true, ...result });
});
