import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest, assertPagePermission } from "@/lib/security/auth";
import { readJson } from "@/lib/api/handler";
import { campaignService } from "@/lib/services/campaign.service";

// GET /api/campaigns — every campaign of the organization with its delivery stats
export const GET = withAuth(async (req: AuthenticatedRequest) => {
  assertPagePermission(req.user, "broadcasts", "read");
  return NextResponse.json({ success: true, campaigns: await campaignService.list(req.user.organizationId) });
});

// POST /api/campaigns  { name, message?: { phoneNumberId?, template?, variables? }, schedule?: { sendAt?, timezone?, intervalSeconds? } }
export const POST = withAuth(async (req: AuthenticatedRequest) => {
  assertPagePermission(req.user, "broadcasts", "create");
  const body = (await readJson(req)) ?? {};
  const campaign = await campaignService.create(req.user.organizationId, req.user.id, body);
  return NextResponse.json({ success: true, campaign }, { status: 201 });
});
