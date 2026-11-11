import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest } from "@/lib/security/auth";
import { assertCanManageIntegrations } from "@/lib/security/store-access";
import { shopifyService } from "@/lib/services";
import { AppError } from "@/lib/errors";
import { parseId } from "@/lib/api/params";
import type { ShopifyCustomerListSort } from "@/lib/shopify/types";

type StoreCustomersRouteContext = { params: Promise<{ storeId: string }> };

const SORTS: ShopifyCustomerListSort[] = ["updated", "created", "name"];

/**
 * GET /api/integrations/shopify/stores/[storeId]/customers?q=&tag=&sort=updated|created|name&after=
 * The store's customers, 25 per page, each with tags, last order and the UnoCX contact it's linked to.
 * q: name, email or phone (results then sorted by relevance); tag: only customers with that tag.
 */
export const GET = withAuth<StoreCustomersRouteContext>(async (req: AuthenticatedRequest, context) => {
  assertCanManageIntegrations(req.user, "read");
  const storeId = parseId((await context?.params)?.storeId, "storeId");
  const { searchParams } = req.nextUrl;

  const sort = searchParams.get("sort") || undefined;
  if (sort !== undefined && !SORTS.includes(sort as ShopifyCustomerListSort)) {
    throw AppError.validation(`Sort must be one of: ${SORTS.join(", ")}.`, "sort");
  }

  const page = await shopifyService.listStoreCustomers(req.user, storeId, {
    q: searchParams.get("q") || undefined,
    tag: searchParams.get("tag") || undefined,
    sort: sort as ShopifyCustomerListSort | undefined,
    after: searchParams.get("after"),
  });
  return NextResponse.json({ success: true, ...page });
});
