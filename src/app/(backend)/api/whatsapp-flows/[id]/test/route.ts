import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest } from "@/lib/security/auth";
import { readJson } from "@/lib/api/handler";
import { parseId } from "@/lib/api/params";
import { whatsappFlowSendService } from "@/lib/services/whatsapp-flows";

// POST /api/whatsapp-flows/:id/test  { phone, templateId } — sends an approved template of this Flow to any WhatsApp number
export const POST = withAuth(async (req: AuthenticatedRequest, context?: { params: Promise<{ id: string }> }) => {
  const flowId = parseId((await context!.params).id);
  const body = (await readJson(req)) ?? {};
  const result = await whatsappFlowSendService.sendTest({
    organizationId: req.user.organizationId,
    userId: req.user.id,
    flowId,
    templateId: Number(body.templateId) || 0,
    phone: typeof body.phone === "string" ? body.phone : "",
  });
  // The flow token is an internal correlation id; it isn't needed by the client
  const { flowToken: _token, ...execution } = result.execution;
  return NextResponse.json({ success: true, execution, to: result.to, from: result.from });
});
