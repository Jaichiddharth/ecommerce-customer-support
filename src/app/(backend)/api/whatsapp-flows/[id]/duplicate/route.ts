import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest } from "@/lib/security/auth";
import { parseId } from "@/lib/api/params";
import { whatsappFlowService } from "@/lib/services/whatsapp-flows";

// POST /api/whatsapp-flows/:id/duplicate — copy the draft into a new Flow
export const POST = withAuth(async (req: AuthenticatedRequest, context?: { params: Promise<{ id: string }> }) => {
  const id = parseId((await context!.params).id);
  const flow = await whatsappFlowService.duplicate(req.user.organizationId, req.user.id, id);
  return NextResponse.json({ success: true, flow });
});
