import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest } from "@/lib/security/auth";
import { shopifyService } from "@/lib/services";
import { AppError } from "@/lib/errors";
import { readJson } from "@/lib/api/handler";

type LinkRouteContext = { params: Promise<{ customerId: string }> };

async function contactIdFrom(context?: LinkRouteContext) {
  const id = Number((await context?.params)?.customerId);
  if (!id || isNaN(id)) throw AppError.validation("Invalid customer id.", "customerId");
  return id;
}

/** PUT /api/integrations/shopify/contacts/[customerId]/link  { shopifyCustomerId } — link the contact, or change its link */
export const PUT = withAuth<LinkRouteContext>(async (req: AuthenticatedRequest, context) => {
  const customerId = await contactIdFrom(context);
  const body = (await readJson(req)) ?? {};
  if (!body.shopifyCustomerId) throw AppError.validation("Choose a Shopify customer.", "shopifyCustomerId");

  const shopifyCustomer = await shopifyService.linkCustomer(req.user, customerId, String(body.shopifyCustomerId));
  return NextResponse.json({ success: true, shopifyCustomer });
});

/** DELETE /api/integrations/shopify/contacts/[customerId]/link — remove the link */
export const DELETE = withAuth<LinkRouteContext>(async (req: AuthenticatedRequest, context) => {
  const customerId = await contactIdFrom(context);
  await shopifyService.unlinkCustomer(req.user.organizationId, customerId);
  return NextResponse.json({ success: true });
});
