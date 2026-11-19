import { NextRequest, NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { wooCommerceService, type WooKeyDelivery } from "@/lib/services";
import { AppError } from "@/lib/errors";

/**
 * POST /api/integrations/woocommerce/callback — WooCommerce delivers the API key it generated, server to server:
 * { key_id, user_id, consumer_key, consumer_secret, key_permissions }. There is no UnoCX session: `user_id` is our
 * signed state. Any non-2xx answer makes WooCommerce delete the key and show the merchant an error, so a forged or
 * replayed delivery leaves nothing behind on the store.
 */
export const POST = apiHandler(async (req: NextRequest) => {
  let body: WooKeyDelivery;
  const contentType = req.headers.get("content-type") || "";
  try {
    body = contentType.includes("application/x-www-form-urlencoded")
      ? (Object.fromEntries(new URLSearchParams(await req.text())) as WooKeyDelivery)
      : ((await req.json()) as WooKeyDelivery);
  } catch (err) {
    throw new AppError("INVALID_JSON", { cause: err, expected: true });
  }
  await wooCommerceService.receiveKeys(body);
  return NextResponse.json({ success: true });
});
