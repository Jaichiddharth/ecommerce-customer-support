import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest, assertPagePermission } from "@/lib/security/auth";
import { readFormData } from "@/lib/api/handler";
import { aiAgentService } from "@/lib/services";

/** POST /api/ai-agent/knowledge/upload (multipart: file, title): PDF, up to 20 MB. */
export const POST = withAuth(async (req: AuthenticatedRequest) => {
  assertPagePermission(req.user, "ai", "create");
  const source = await aiAgentService.uploadPdf(req.user, await readFormData(req));
  return NextResponse.json({ success: true, source }, { status: 202 });
});
