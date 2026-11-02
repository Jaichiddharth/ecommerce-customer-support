import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest } from "@/lib/security/auth";
import { optionalInt } from "@/lib/api/params";
import { whatsappFlowSubmissionService } from "@/lib/services/whatsapp-flows";

// GET /api/whatsapp-flows/submissions?flowId=&status=&page=&pageSize= — customer responses (org-scoped)
export const GET = withAuth(async (req: AuthenticatedRequest) => {
  const sp = req.nextUrl.searchParams;
  const result = await whatsappFlowSubmissionService.list(req.user.organizationId, {
    flowId: optionalInt(sp.get("flowId")),
    status: sp.get("status") || undefined,
    page: optionalInt(sp.get("page")),
    pageSize: optionalInt(sp.get("pageSize")),
  });
  const submissions = result.submissions.map(({ flowToken: _t, ...s }) => s);
  return NextResponse.json({ success: true, ...result, submissions });
});
