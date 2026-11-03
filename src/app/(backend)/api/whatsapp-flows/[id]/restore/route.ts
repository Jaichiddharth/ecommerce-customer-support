import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest } from "@/lib/security/auth";
import { parseId } from "@/lib/api/params";
import { whatsappFlowService } from "@/lib/services/whatsapp-flows";

// POST /api/whatsapp-flows/:id/restore — un-archive
export const POST = withAuth(async (req: AuthenticatedRequest, context?: { params: Promise<{ id: string }> }) => {
  const id = parseId((await context!.params).id);
  const flow = await whatsappFlowService.restore(req.user.organizationId, id);
  return NextResponse.json({ success: true, flow });
});
