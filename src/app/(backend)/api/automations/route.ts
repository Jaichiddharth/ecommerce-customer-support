import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest, assertPagePermission } from "@/lib/security/auth";
import { readJson } from "@/lib/api/handler";
import { listBody, optionalEnum, parseListQuery } from "@/lib/api/list-query";
import { AUTOMATION_SORT_KEYS } from "@/lib/db/repositories";
import {
  automationService,
  AUTOMATION_EXECUTION_FILTERS,
  AUTOMATION_LIST_STATUSES,
  AUTOMATION_TRIGGER_TYPES,
} from "@/lib/services/automation.service";

// GET /api/automations?page=&limit=&sortBy=&sortOrder=&q=&status=&trigger=&execution=&fromDate=&toDate=
// Server-side listing: derived status (draft/active/paused/failed/archived), trigger, node count and run stats.
// fromDate/toDate bound the last-modified time; execution = latest run status or "never".
export const GET = withAuth(async (req: AuthenticatedRequest) => {
  assertPagePermission(req.user, "flows", "read");
  const sp = req.nextUrl.searchParams;
  const query = parseListQuery(sp, { sortable: AUTOMATION_SORT_KEYS, defaultSortBy: "updatedAt", defaultSortOrder: "desc" });
  const result = await automationService.listing(req.user.organizationId, {
    ...query,
    q: sp.get("q") ?? undefined,
    status: optionalEnum(sp.get("status"), AUTOMATION_LIST_STATUSES, "status"),
    trigger: optionalEnum(sp.get("trigger"), AUTOMATION_TRIGGER_TYPES, "trigger"),
    execution: optionalEnum(sp.get("execution"), AUTOMATION_EXECUTION_FILTERS, "execution"),
  });
  return NextResponse.json(listBody("automations", result));
});

// POST /api/automations  { name, description?, graph: { nodes, edges }, isActive? }
export const POST = withAuth(async (req: AuthenticatedRequest) => {
  assertPagePermission(req.user, "flows", "create");
  const body = (await readJson(req)) ?? {};
  const automation = await automationService.create(req.user.organizationId, req.user.id, body);
  return NextResponse.json({ success: true, automation }, { status: 201 });
});
