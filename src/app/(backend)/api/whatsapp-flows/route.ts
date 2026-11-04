import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest } from "@/lib/security/auth";
import { readJson } from "@/lib/api/handler";
import { listBody, optionalEnum, parseListQuery } from "@/lib/api/list-query";
import { FLOW_SORT_KEYS } from "@/lib/db/repositories";
import { WaFlowStatus } from "@/lib/db/schema";
import { whatsappFlowService } from "@/lib/services/whatsapp-flows";

const FLOW_STATUSES = Object.values(WaFlowStatus);

// GET /api/whatsapp-flows?page=&limit=&sortBy=&sortOrder=&q=&status=&fromDate=&toDate=  — Flow listing (fromDate/toDate: created at)
// GET /api/whatsapp-flows?published=1   — sendable Flows for pickers (templates, automations)
// GET /api/whatsapp-flows?options=1     — every Flow as { id, name, status } for filter pickers
export const GET = withAuth(async (req: AuthenticatedRequest) => {
  const orgId = req.user.organizationId;
  const sp = req.nextUrl.searchParams;
  if (sp.get("published") === "1") {
    return NextResponse.json({ success: true, flows: await whatsappFlowService.listPublished(orgId) });
  }
  if (sp.get("options") === "1") {
    return NextResponse.json({ success: true, flows: await whatsappFlowService.options(orgId) });
  }
  const query = parseListQuery(sp, { sortable: FLOW_SORT_KEYS, defaultSortBy: "updatedAt", defaultSortOrder: "desc" });
  const result = await whatsappFlowService.list(orgId, {
    ...query,
    q: sp.get("q") ?? undefined,
    status: optionalEnum(sp.get("status"), FLOW_STATUSES, "status"),
  });
  return NextResponse.json(listBody("flows", result));
});

// POST /api/whatsapp-flows  { name, categories, channelId?, draft }
export const POST = withAuth(async (req: AuthenticatedRequest) => {
  const body = (await readJson(req)) ?? {};
  const flow = await whatsappFlowService.create(req.user.organizationId, req.user.id, body);
  return NextResponse.json({ success: true, flow }, { status: 201 });
});
