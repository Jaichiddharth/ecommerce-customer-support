import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest } from "@/lib/security/auth";
import { parseId } from "@/lib/api/params";
import { whatsappFlowService } from "@/lib/services/whatsapp-flows";

// GET /api/whatsapp-flows/:id/versions/:versionId/preview — Meta's web preview link for that version
export const GET = withAuth(async (req: AuthenticatedRequest, context?: { params: Promise<{ id: string; versionId: string }> }) => {
  const p = await context!.params;
  const preview = await whatsappFlowService.previewUrl(req.user.organizationId, parseId(p.id), parseId(p.versionId, "versionId"));
  return NextResponse.json({ success: true, preview });
});
