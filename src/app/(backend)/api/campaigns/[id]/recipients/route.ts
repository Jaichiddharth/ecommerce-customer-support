import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest, assertPagePermission } from "@/lib/security/auth";
import { parseId } from "@/lib/api/params";
import { parseListQuery } from "@/lib/api/list-query";
import { paginationMeta } from "@/lib/listing";
import { campaignService } from "@/lib/services/campaign.service";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/campaigns/:id/recipients?page&limit&status&q — the campaign's contacts with status, times, error, pricing
export const GET = withAuth(async (req: AuthenticatedRequest, context?: Ctx) => {
  assertPagePermission(req.user, "broadcasts", "read");
  const id = parseId((await context!.params).id);
  const sp = req.nextUrl.searchParams;
  const query = parseListQuery(sp, { sortable: ["file"] as const, defaultSortBy: "file", defaultSortOrder: "asc", maxLimit: 100 });
  const { items, total } = await campaignService.recipients(req.user.organizationId, id, {
    ...query,
    status: sp.get("status") || undefined,
    search: sp.get("q")?.slice(0, 100) || undefined,
  });
  return NextResponse.json({ success: true, recipients: items, pagination: paginationMeta(query.page, query.limit, total) });
});
