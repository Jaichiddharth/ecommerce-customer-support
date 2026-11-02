import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest } from "@/lib/security/auth";
import { readJson } from "@/lib/api/handler";
import { parseId } from "@/lib/api/params";
import { whatsappFlowService } from "@/lib/services/whatsapp-flows";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/whatsapp-flows/:id — details incl. draft, versions, templates, automations
export const GET = withAuth(async (req: AuthenticatedRequest, context?: Ctx) => {
  const id = parseId((await context!.params).id);
  return NextResponse.json({ success: true, flow: await whatsappFlowService.get(req.user.organizationId, id) });
});

// PATCH /api/whatsapp-flows/:id — save the editable draft / metadata (published versions are untouched)
export const PATCH = withAuth(async (req: AuthenticatedRequest, context?: Ctx) => {
  const id = parseId((await context!.params).id);
  const body = (await readJson(req)) ?? {};
  const flow = await whatsappFlowService.update(req.user.organizationId, id, body);
  return NextResponse.json({ success: true, flow });
});

// DELETE /api/whatsapp-flows/:id — deletes a never-used draft, otherwise archives it
export const DELETE = withAuth(async (req: AuthenticatedRequest, context?: Ctx) => {
  const id = parseId((await context!.params).id);
  const result = await whatsappFlowService.remove(req.user.organizationId, id);
  return NextResponse.json({ success: true, ...result });
});
