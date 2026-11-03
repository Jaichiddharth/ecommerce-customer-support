import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest } from "@/lib/security/auth";
import { parseId } from "@/lib/api/params";
import { whatsappFlowService } from "@/lib/services/whatsapp-flows";

// POST /api/whatsapp-flows/:id/versions/:versionId/deprecate — irreversible at Meta
export const POST = withAuth(async (req: AuthenticatedRequest, context?: { params: Promise<{ id: string; versionId: string }> }) => {
  const p = await context!.params;
  const flow = await whatsappFlowService.deprecateVersion(req.user.organizationId, parseId(p.id), parseId(p.versionId, "versionId"));
  return NextResponse.json({ success: true, flow });
});
