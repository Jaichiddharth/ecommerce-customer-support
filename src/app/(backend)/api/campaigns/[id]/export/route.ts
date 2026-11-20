import { withAuth, AuthenticatedRequest, assertPagePermission } from "@/lib/security/auth";
import { parseId } from "@/lib/api/params";
import { campaignService } from "@/lib/services/campaign.service";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/campaigns/:id/export — CSV log: every contact (with the uploaded file's columns) and its result
export const GET = withAuth(async (req: AuthenticatedRequest, context?: Ctx) => {
  assertPagePermission(req.user, "broadcasts", "read");
  const id = parseId((await context!.params).id);
  const { filename, stream } = await campaignService.exportLogs(req.user.organizationId, id);
  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
});
