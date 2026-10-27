import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest } from "@/lib/security/auth";
import { customerService } from "@/lib/services";
import { AppError } from "@/lib/errors";
import { readJson } from "@/lib/api/handler";

type IdentitiesRouteContext = { params: Promise<{ id: string }> };

async function contactIdFrom(context?: IdentitiesRouteContext) {
  const id = Number((await context?.params)?.id);
  if (!id || isNaN(id)) throw AppError.validation("Invalid customer id.", "id");
  return id;
}

function otherContactId(value: unknown) {
  const id = Number(value);
  if (!id || isNaN(id)) throw AppError.validation("Choose a contact.", "contactId");
  return id;
}

/**
 * GET /api/customer/[id]/identities — the channel identities of the contact's profile
 * GET /api/customer/[id]/identities?q= — contacts that could be linked as another identity
 */
export const GET = withAuth<IdentitiesRouteContext>(async (req: AuthenticatedRequest, context) => {
  const id = await contactIdFrom(context);
  const q = req.nextUrl.searchParams.get("q");
  if (q !== null) {
    const candidates = await customerService.searchIdentityCandidates(id, req.user.organizationId, q);
    return NextResponse.json({ success: true, candidates });
  }

  const identities = await customerService.listIdentities(id, req.user.organizationId);
  return NextResponse.json({ success: true, identities });
});

/** PUT /api/customer/[id]/identities  { contactId } — link another contact (and its identities) to this profile */
export const PUT = withAuth<IdentitiesRouteContext>(async (req: AuthenticatedRequest, context) => {
  const id = await contactIdFrom(context);
  const body = (await readJson(req)) ?? {};
  const identities = await customerService.linkIdentity(id, req.user.organizationId, otherContactId(body.contactId));
  return NextResponse.json({ success: true, identities });
});

/** DELETE /api/customer/[id]/identities?contactId= — take one identity out of this profile */
export const DELETE = withAuth<IdentitiesRouteContext>(async (req: AuthenticatedRequest, context) => {
  const id = await contactIdFrom(context);
  const memberId = otherContactId(req.nextUrl.searchParams.get("contactId"));
  const identities = await customerService.unlinkIdentity(id, req.user.organizationId, memberId);
  return NextResponse.json({ success: true, identities });
});
