import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest } from "@/lib/security/auth";
import { parseId } from "@/lib/api/params";
import { whatsappTemplateService } from "@/lib/services/whatsapp-flows";

// POST /api/whatsapp-templates/:id/sync — pull the review status from Meta
export const POST = withAuth(async (req: AuthenticatedRequest, context?: { params: Promise<{ id: string }> }) => {
  const id = parseId((await context!.params).id);
  const template = await whatsappTemplateService.sync(req.user.organizationId, id);
  return NextResponse.json({ success: true, template });
});
