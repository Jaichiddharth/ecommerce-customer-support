import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest } from "@/lib/security/auth";
import { parseId } from "@/lib/api/params";
import { whatsappTemplateService } from "@/lib/services/whatsapp-flows";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withAuth(async (req: AuthenticatedRequest, context?: Ctx) => {
  const id = parseId((await context!.params).id);
  const template = whatsappTemplateService.view(await whatsappTemplateService.require(req.user.organizationId, id));
  return NextResponse.json({ success: true, template });
});

// DELETE /api/whatsapp-templates/:id — deletes at Meta and locally
export const DELETE = withAuth(async (req: AuthenticatedRequest, context?: Ctx) => {
  const id = parseId((await context!.params).id);
  await whatsappTemplateService.remove(req.user.organizationId, id);
  return NextResponse.json({ success: true });
});
