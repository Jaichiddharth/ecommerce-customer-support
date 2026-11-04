import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest } from "@/lib/security/auth";
import { optionalInt } from "@/lib/api/params";
import { listBody, optionalEnum, parseListQuery } from "@/lib/api/list-query";
import { SUBMISSION_SORT_KEYS } from "@/lib/db/repositories";
import { WaSubmissionStatus } from "@/lib/db/schema";
import { whatsappFlowSubmissionService } from "@/lib/services/whatsapp-flows";

const SUBMISSION_STATUSES = Object.values(WaSubmissionStatus);

// GET /api/whatsapp-flows/submissions?page=&limit=&sortBy=&sortOrder=&flowId=&status=&fromDate=&toDate=
// Customer responses (org-scoped). fromDate/toDate bound the submitted time.
export const GET = withAuth(async (req: AuthenticatedRequest) => {
  const sp = req.nextUrl.searchParams;
  const query = parseListQuery(sp, { sortable: SUBMISSION_SORT_KEYS, defaultSortBy: "submittedAt", defaultSortOrder: "desc" });
  const result = await whatsappFlowSubmissionService.list(req.user.organizationId, {
    ...query,
    flowId: optionalInt(sp.get("flowId")),
    status: optionalEnum(sp.get("status"), SUBMISSION_STATUSES, "status"),
  });
  const items = result.items.map(({ flowToken: _t, ...s }) => s);
  return NextResponse.json(listBody("submissions", { ...result, items }));
});
