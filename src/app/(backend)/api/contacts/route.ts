import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest } from "@/lib/security/auth";
import { customerService } from "@/lib/services";
import { AppError } from "@/lib/errors";
import { CONTACT_ACTIVITY_WINDOWS, CONTACTS_PAGE_SIZE, type ContactListResponse } from "@/types/contacts";

const MAX_PAGE_SIZE = 100;

/**
 * GET /api/contacts?channelId=&consent=any|opted_out&q=&activeDays=0|7|30|90&page=1&pageSize=25
 * The Contacts page: one channel's contacts (the first live channel when channelId is left out), most recently
 * active first, with each live channel's contact and opted-out counts.
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

  const page = Math.max(1, Math.floor(Number(params.get("page")) || 1));
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(Number(params.get("pageSize")) || CONTACTS_PAGE_SIZE)));
  const search = (params.get("q") ?? "").trim().slice(0, 100);

  const result = await customerService.listContacts(req.user.organizationId, {
    channelId,
    consent: consent === "any" ? undefined : consent,
    search: search || undefined,
    activeWithinDays: activeDays || undefined,
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });

  const body: ContactListResponse = { success: true, ...result, page, pageSize };
  return NextResponse.json(body);
});
