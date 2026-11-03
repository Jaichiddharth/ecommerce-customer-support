import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest } from "@/lib/security/auth";
import { parseId } from "@/lib/api/params";
import { whatsappFlowService } from "@/lib/services/whatsapp-flows";

// POST /api/whatsapp-flows/:id/publish — validate the draft and publish it as a new immutable version (retry-safe)
export const POST = withAuth(async (req: AuthenticatedRequest, context?: { params: Promise<{ id: string }> }) => {
  const id = parseId((await context!.params).id);
  const flow = await whatsappFlowService.publish(req.user.organizationId, req.user.id, id);
  return NextResponse.json({ success: true, flow });
});
