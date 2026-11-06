import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest } from "@/lib/security/auth";
import { customerService } from "@/lib/services";
import { AppError } from "@/lib/errors";
import { parseListQuery, toListResult } from "@/lib/api/list-query";
import { CONTACT_SORT_KEYS } from "@/lib/db/repositories";
import { CONTACT_ACTIVITY_WINDOWS, CONTACTS_PAGE_SIZE, type ContactListResponse } from "@/types/contacts";

/**
 * GET /api/contacts?channelId=&consent=any|opted_out&q=&activeDays=0|7|30|90&page=1&limit=25&sortBy=&sortOrder=
 * The Contacts page: one channel's contacts (the first live channel when channelId is left out), most recently
 * active first by default, with each live channel's contact and opted-out counts.
 * sortBy: name | lastActiveAt | createdAt. `pageSize` is still accepted as the older name of `limit`.
 * Read-only: unlike GET /api/customer it never cleans up or merges records.
 */
export const GET = withAuth(async (req: AuthenticatedRequest) => {
  const params = new URL(req.url).searchParams;

  const channelParam = params.get("channelId");
  const channelId = channelParam ? Number(channelParam) : undefined;
  if (channelId !== undefined && (!Number.isInteger(channelId) || channelId <= 0)) {
    throw AppError.validation("Invalid channel id.", "channelId");
  }

  const consent = params.get("consent") || "any";
  if (consent !== "any" && consent !== "opted_out") {
    throw AppError.validation("Consent must be any or opted_out.", "consent");
  }

  const activeDays = Number(params.get("activeDays") || 0);
  if (!(CONTACT_ACTIVITY_WINDOWS as readonly number[]).includes(activeDays)) {
    throw AppError.validation(`Last active must be one of ${CONTACT_ACTIVITY_WINDOWS.join(", ")} days.`, "activeDays");
  }

  const query = parseListQuery(params, {
    sortable: CONTACT_SORT_KEYS,
    defaultSortBy: "lastActiveAt",
    defaultSortOrder: "desc",
    defaultLimit: CONTACTS_PAGE_SIZE,
  });
  const search = (params.get("q") ?? "").trim().slice(0, 100);

  const result = await customerService.listContacts(req.user.organizationId, {
    channelId,
    consent: consent === "any" ? undefined : consent,
    search: search || undefined,
    activeWithinDays: activeDays || undefined,
    sortBy: query.sortBy,
    sortOrder: query.sortOrder,
    limit: query.limit,
    offset: query.offset,
  });

  const body: ContactListResponse = {
    success: true,
    ...result,
    pagination: toListResult(result.contacts, result.total, query).pagination,
    page: query.page,
    pageSize: query.limit,
  };
  return NextResponse.json(body);
});
