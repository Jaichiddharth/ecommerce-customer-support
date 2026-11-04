import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest } from "@/lib/security/auth";
import { parseId } from "@/lib/api/params";
import { listBody, optionalEnum, parseListQuery } from "@/lib/api/list-query";
import { RUN_SORT_KEYS } from "@/lib/db/repositories";
import { AutomationRunStatus } from "@/lib/db/schema";
import { automationService } from "@/lib/services/automation.service";

const RUN_STATUSES = Object.values(AutomationRunStatus);

// GET /api/automations/:id/runs?page=&limit=&sortBy=&sortOrder=&status=&fromDate=&toDate= — execution history (newest first by default)
export const GET = withAuth(async (req: AuthenticatedRequest, context?: { params: Promise<{ id: string }> }) => {
  const id = parseId((await context!.params).id);
  const sp = req.nextUrl.searchParams;
  const query = parseListQuery(sp, { sortable: RUN_SORT_KEYS, defaultSortBy: "createdAt", defaultSortOrder: "desc" });
  const result = await automationService.runs(req.user.organizationId, id, {
    ...query,
    status: optionalEnum(sp.get("status"), RUN_STATUSES, "status"),
  });
  return NextResponse.json(listBody("runs", result));
});
