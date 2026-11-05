import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest } from "@/lib/security/auth";
import { consentService } from "@/lib/services";
import { AppError } from "@/lib/errors";
import { readJson } from "@/lib/api/handler";

type ConsentRouteContext = { params: Promise<{ id: string }> };

/**
 * PUT /api/customer/[id]/consent  { status: 'opted_in' | 'opted_out', reason? }
 * A teammate records the contact's WhatsApp marketing consent (e.g. the customer asked on a call).
 * The change is written to the consent log in the thread; no message is sent to the customer.
 */
export const PUT = withAuth<ConsentRouteContext>(async (req: AuthenticatedRequest, context) => {
  const id = Number((await context?.params)?.id);
  if (!id || isNaN(id)) throw AppError.validation("Invalid customer id.", "id");

  const body = (await readJson(req)) ?? {};
  if (body.status !== "opted_in" && body.status !== "opted_out") {
    throw AppError.validation("Status must be opted_in or opted_out.", "status");
  }
  if (body.reason !== undefined && body.reason !== null && typeof body.reason !== "string") {
    throw AppError.validation("Reason must be text.", "reason");
  }

  const { customer, changed } = await consentService.changeByAgent(
    req.user.organizationId,
    id,
    body.status,
    { id: req.user.id, name: req.user.name ?? null },
    body.reason
  );

  return NextResponse.json({ success: true, changed, isOptedOut: Boolean(customer.isOptedOut) });
});
