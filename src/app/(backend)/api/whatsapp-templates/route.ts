import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest } from "@/lib/security/auth";
import { readJson } from "@/lib/api/handler";
import { optionalInt } from "@/lib/api/params";
import { whatsappTemplateService } from "@/lib/services/whatsapp-flows";

// GET /api/whatsapp-templates?flowId=&status=  — templates created in Unocx (with their Flow link)
export const GET = withAuth(async (req: AuthenticatedRequest) => {
  const sp = req.nextUrl.searchParams;
  const templates = await whatsappTemplateService.list(req.user.organizationId, {
    flowId: optionalInt(sp.get("flowId")),
    status: sp.get("status") || undefined,
  });
  return NextResponse.json({ success: true, templates });
});

// POST /api/whatsapp-templates — create a template with a WhatsApp Flow button and submit it for review
export const POST = withAuth(async (req: AuthenticatedRequest) => {
  const body = (await readJson(req)) ?? {};
  const template = await whatsappTemplateService.create(req.user.organizationId, req.user.id, body);
  return NextResponse.json({ success: true, template }, { status: 201 });
});
