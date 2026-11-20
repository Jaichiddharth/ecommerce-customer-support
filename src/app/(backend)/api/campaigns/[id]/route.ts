import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest, assertPagePermission } from "@/lib/security/auth";
import { readJson } from "@/lib/api/handler";
import { parseId } from "@/lib/api/params";
import { campaignService } from "@/lib/services/campaign.service";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/campaigns/:id — the campaign with its audience summary and the first recipients as a preview
export const GET = withAuth(async (req: AuthenticatedRequest, context?: Ctx) => {
  assertPagePermission(req.user, "broadcasts", "read");
  const id = parseId((await context!.params).id);
  return NextResponse.json({ success: true, campaign: await campaignService.get(req.user.organizationId, id) });
});

// PATCH /api/campaigns/:id — edit a draft (a scheduled campaign goes back to draft and must be scheduled again)
export const PATCH = withAuth(async (req: AuthenticatedRequest, context?: Ctx) => {
  assertPagePermission(req.user, "broadcasts", "update");
  const id = parseId((await context!.params).id);
  const body = (await readJson(req)) ?? {};
  return NextResponse.json({ success: true, campaign: await campaignService.update(req.user.organizationId, id, body) });
});

// DELETE /api/campaigns/:id — drafts and finished campaigns only
export const DELETE = withAuth(async (req: AuthenticatedRequest, context?: Ctx) => {
  assertPagePermission(req.user, "broadcasts", "delete");
  const id = parseId((await context!.params).id);
  await campaignService.delete(req.user.organizationId, id);
  return NextResponse.json({ success: true });
});
