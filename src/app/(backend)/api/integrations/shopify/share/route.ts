import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest } from "@/lib/security/auth";
import { shopifyService } from "@/lib/services";
import { AppError } from "@/lib/errors";
import { readJson } from "@/lib/api/handler";
import { optionalBodyId } from "@/lib/api/store-scope";

/**
 * POST /api/integrations/shopify/share  { customerId, variantId, productId?, channelId?, storeId?, caption? }
 * Re-reads the variant from Shopify and sends it through the normal WhatsApp send path
 * (image + caption, or text when the product has no image).
 */
export const POST = withAuth(async (req: AuthenticatedRequest) => {
  const body = (await readJson(req)) ?? {};
  const customerId = Number(body.customerId);
  if (!customerId || isNaN(customerId)) throw AppError.validation("Invalid customer id.", "customerId");
  if (!body.variantId) throw AppError.validation("Choose a product option to share.", "variantId");

  const result = await shopifyService.shareProduct(req.user, {
    customerId,
    variantId: String(body.variantId),
    productId: body.productId ? String(body.productId) : undefined,
    channelId: optionalBodyId(body.channelId, "channelId"),
    // Must be the store of the channel the product is sent on, when that channel is mapped
    storeId: optionalBodyId(body.storeId, "storeId"),
    caption: typeof body.caption === "string" ? body.caption : undefined,
  });

  return NextResponse.json({
    success: true,
    // false = delivered by WhatsApp but not saved to history (UI shows `warning`)
    persisted: result.persisted,
    warning: "warning" in result ? result.warning : undefined,
    message: result.message,
    product: result.product,
  });
});
