import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest } from "@/lib/security/auth";
import { shopifyService } from "@/lib/services";
import { AppError } from "@/lib/errors";
import { readJson } from "@/lib/api/handler";
import { parseId } from "@/lib/api/params";
import { optionalBodyId } from "@/lib/api/store-scope";

type LinkRouteContext = { params: Promise<{ customerId: string }> };

const contactIdFrom = async (context?: LinkRouteContext) => parseId((await context?.params)?.customerId, "customerId");

/**
 * PUT /api/integrations/shopify/contacts/[customerId]/link  { shopifyCustomerId, storeId? } — link the contact, or
 * change its link, in the store of the contact's channel (storeId, when given, must be that store)
 */
export const PUT = withAuth<LinkRouteContext>(async (req: AuthenticatedRequest, context) => {
  const customerId = await contactIdFrom(context);
  const body = (await readJson(req)) ?? {};
  if (!body.shopifyCustomerId) throw AppError.validation("Choose a Shopify customer.", "shopifyCustomerId");

  const shopifyCustomer = await shopifyService.linkCustomer(
    req.user,
    customerId,
    String(body.shopifyCustomerId),
    optionalBodyId(body.storeId, "storeId")
  );
  return NextResponse.json({ success: true, shopifyCustomer });
});

/** DELETE /api/integrations/shopify/contacts/[customerId]/link?storeId= — remove the link; the contact is then not matched automatically again */
export const DELETE = withAuth<LinkRouteContext>(async (req: AuthenticatedRequest, context) => {
  const customerId = await contactIdFrom(context);
  await shopifyService.unlinkCustomer(req.user, customerId, optionalBodyId(req.nextUrl.searchParams.get("storeId"), "storeId"));
  return NextResponse.json({ success: true });
});
