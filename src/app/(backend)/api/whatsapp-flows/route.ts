import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest, assertPagePermission } from "@/lib/security/auth";
import { readJson } from "@/lib/api/handler";
import { optionalInt } from "@/lib/api/params";
import { whatsappFlowService } from "@/lib/services/whatsapp-flows";

// GET /api/whatsapp-flows?q=&status=&page=&pageSize=   — Flow listing
// GET /api/whatsapp-flows?published=1                   — sendable Flows for pickers (templates, automations)
export const GET = withAuth(async (req: AuthenticatedRequest) => {
  assertPagePermission(req.user, "flows", "read");
  const orgId = req.user.organizationId;
  const sp = req.nextUrl.searchParams;
  if (sp.get("published") === "1") {
    return NextResponse.json({ success: true, flows: await whatsappFlowService.listPublished(orgId) });
  }
  const result = await whatsappFlowService.list(orgId, {
    q: sp.get("q") ?? undefined,
    status: sp.get("status") ?? undefined,
    page: optionalInt(sp.get("page")),
    pageSize: optionalInt(sp.get("pageSize")),
  });
  return NextResponse.json({ success: true, ...result });
});

// POST /api/whatsapp-flows  { name, categories, channelId?, draft }
export const POST = withAuth(async (req: AuthenticatedRequest) => {
  assertPagePermission(req.user, "flows", "create");
  const body = (await readJson(req)) ?? {};
  const flow = await whatsappFlowService.create(req.user.organizationId, req.user.id, body);
  return NextResponse.json({ success: true, flow }, { status: 201 });
});
