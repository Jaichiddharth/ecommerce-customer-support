import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest } from "@/lib/security/auth";
import { readJson } from "@/lib/api/handler";
import { parseId } from "@/lib/api/params";
import { whatsappFlowSendService } from "@/lib/services/whatsapp-flows";

// POST /api/whatsapp-flows/:id/send  { customerId, method: 'template'|'interactive', templateId?, cta?, bodyText?, expiresInHours? }
export const POST = withAuth(async (req: AuthenticatedRequest, context?: { params: Promise<{ id: string }> }) => {
  const flowId = parseId((await context!.params).id);
  const body = (await readJson(req)) ?? {};
  const execution = await whatsappFlowSendService.send({
    organizationId: req.user.organizationId,
    userId: req.user.id,
    flowId,
    customerId: parseId(String(body.customerId ?? ""), "customerId"),
    method: body.method,
    templateId: body.templateId ? Number(body.templateId) : null,
    cta: body.cta,
    bodyText: body.bodyText,
    headerText: body.headerText,
    footerText: body.footerText,
    expiresInHours: body.expiresInHours,
  });
  // The flow token is an internal correlation id; it isn't needed by the client
  const { flowToken: _token, ...safe } = execution;
  return NextResponse.json({ success: true, execution: safe });
});
