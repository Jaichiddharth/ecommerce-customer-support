import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest } from "@/lib/security/auth";
import { readJson } from "@/lib/api/handler";
import { optionalInt } from "@/lib/api/params";
import { listBody, parseListQuery, wantsListing } from "@/lib/api/list-query";
import { AppError } from "@/lib/errors";
import { TEMPLATE_SORT_KEYS } from "@/lib/db/repositories";
import { whatsappTemplateService } from "@/lib/services/whatsapp-flows";

/** Meta / local template statuses are UPPER_SNAKE words (APPROVED, PENDING, SUBMISSION_FAILED, …). */
function templateStatus(value: string | null): string | undefined {
  if (!value) return undefined;
  if (!/^[A-Z_]{1,30}$/.test(value)) throw AppError.validation("status is not a valid template status.", "status");
  return value;
}

// GET /api/whatsapp-templates?page=&limit=&sortBy=&sortOrder=&flowId=&status=&fromDate=&toDate=
//   Paginated listing (Flow templates page). fromDate/toDate bound the created time.
// GET /api/whatsapp-templates?flowId=&status=
//   Without listing params: every matching template (pickers — automation action, Test Flow).
export const GET = withAuth(async (req: AuthenticatedRequest) => {
  const sp = req.nextUrl.searchParams;
  const filter = { flowId: optionalInt(sp.get("flowId")), status: templateStatus(sp.get("status")) };
  if (wantsListing(sp)) {
    const query = parseListQuery(sp, { sortable: TEMPLATE_SORT_KEYS, defaultSortBy: "updatedAt", defaultSortOrder: "desc" });
    const result = await whatsappTemplateService.listing(req.user.organizationId, { ...query, ...filter });
    return NextResponse.json(listBody("templates", result));
  }
  const templates = await whatsappTemplateService.list(req.user.organizationId, filter);
  return NextResponse.json({ success: true, templates });
});

// POST /api/whatsapp-templates — create a template with a WhatsApp Flow button and submit it for review
export const POST = withAuth(async (req: AuthenticatedRequest) => {
  const body = (await readJson(req)) ?? {};
  const template = await whatsappTemplateService.create(req.user.organizationId, req.user.id, body);
  return NextResponse.json({ success: true, template }, { status: 201 });
});
