import { NextRequest, NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { wooCommerceService } from "@/lib/services";
import { toAppError } from "@/lib/errors";
import { createLogger } from "@/lib/logger";
import { getWooCommerceConfig } from "@/lib/woocommerce/config";

const log = createLogger("WooCommerceReturn");

/**
 * GET /api/integrations/woocommerce/return?success=1|0&user_id=<state> — WooCommerce sends the merchant's browser
 * back here after they approve (or deny). Verifies the key that was delivered to /callback, then always redirects
 * to the WooCommerce integration page with ?woocommerce=connected|reconnected|error.
 */
export const GET = apiHandler(async (req: NextRequest) => {
  let origin = req.nextUrl.origin;
  try {
    origin = getWooCommerceConfig().appUrl;
  } catch {
    // Not configured: completeReturn reports it below
  }
  const target = new URL("/integrations/woocommerce", origin);

  try {
    const { store, reconnected } = await wooCommerceService.completeReturn(req.nextUrl.searchParams);
    target.searchParams.set("woocommerce", reconnected ? "reconnected" : "connected");
    target.searchParams.set("store", store.storeHost);
    if (store.name) target.searchParams.set("name", store.name);
  } catch (err) {
    const appError = toAppError(err);
    log.warn("WooCommerce connection failed", { err: appError });
    target.searchParams.set("woocommerce", "error");
    target.searchParams.set("code", appError.code);
    if (appError.status < 500 || appError.code === "WOOCOMMERCE_UNAVAILABLE") target.searchParams.set("message", appError.message);
  }
  return NextResponse.redirect(target);
});
