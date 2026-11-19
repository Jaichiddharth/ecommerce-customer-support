import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest } from "@/lib/security/auth";
import { wooCommerceInboxService } from "@/lib/services";
import { readJson } from "@/lib/api/handler";
import { parseId } from "@/lib/api/params";
import { optionalBodyId } from "@/lib/api/store-scope";

/**
 * POST /api/integrations/woocommerce/share  { customerId, storeId, productId, variationId?, channelId?, caption? }
 * Re-reads the product from the store and sends it through the normal WhatsApp send path (image + caption, or text
 * when the product has no image). The store must be linked to the number the product is sent on.
 */
export const POST = withAuth(async (req: AuthenticatedRequest) => {
  const body = (await readJson(req)) ?? {};
  const id = (field: string) => parseId(body[field] != null ? String(body[field]) : null, field);

  const result = await wooCommerceInboxService.shareProduct(req.user, {
    customerId: id("customerId"),
    storeId: id("storeId"),
    productId: id("productId"),
    variationId: optionalBodyId(body.variationId, "variationId"),
    channelId: optionalBodyId(body.channelId, "channelId"),
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
