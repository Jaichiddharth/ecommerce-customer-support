import { shopifyRepository, type ShopifyStoreWithUser } from "../db/repositories/shopify.repository";
import { customerRepository } from "../db/repositories/customer.repository";
import { channelRepository } from "../db/repositories/channel.repository";
import { ShopifyLinkSource, ShopifyStoreStatus, type ShopifyStore, type SharedShopifyProduct } from "../db/schema";
import { AppError, toAppError } from "../errors";
import { createLogger } from "../logger";
import { encryptToken, decryptToken } from "../security/crypto";
import type { AuthUser } from "../security/auth";
import { canAccessStore } from "../security/store-access";
import { shopifyGraphql, revokeShopifyAccess } from "../shopify/admin-client";
import { getShopifyConfig, getShopifyDistribution, isValidShopDomain, shopifyLegacyId, toShopifyGid, SHOPIFY_REQUIRED_SCOPES, SHOPIFY_WEBHOOKS_PATH } from "../shopify/config";
import { subscribeShopifyWebhooks, listShopifyWebhooks } from "../shopify/webhooks";
import { hasScope, toOrderLinkInfo, toStoreInfo, toStoreRef } from "../shopify/mappers";
import { buildAuthorizeUrl, exchangeCodeForToken, refreshAccessToken, verifyCallbackHmac, verifyState } from "../shopify/oauth";
import { buildProductMessageText } from "../shopify/product-message";
import type {
  ShopifyAutoMatchStatus,
  ShopifyCustomerSummary,
  ShopifyOrderLinkInfo,
  ShopifyOrderSearchResult,
  ShopifyMoney,
  ShopifyOrder,
  ShopifyPage,
  ShopifyProductDetail,
  ShopifyProductSummary,
  ShopifyVariant,
  ShopifyContactOrdersResponse,
  ShopifyCount,
  ShopifyCustomerListSort,
  ShopifyStoreCustomer,
  ShopifyStoreOverview,
  ShopifyStoreOrder,
  ShopifyOrderStatusFilter,
  ShopifyCustomerOrdersPage,
} from "../shopify/types";
import { whatsAppService } from "./channels/whatsapp.service";
import { customerService } from "./customer.service";
import { shopifyStoreConnectionService, type StoreScope } from "./shopify-store-connection.service";

const log = createLogger("ShopifyService");

const PRODUCTS_PAGE_SIZE = 20;
const CUSTOMERS_PAGE_SIZE = 25;
const STORE_ORDERS_PAGE_SIZE = 20;
const ORDERS_PAGE_SIZE = 10;
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;

/* ------------------------------------------------------------------ */
/* GraphQL documents                                                   */
/* ------------------------------------------------------------------ */

const SHOP_QUERY = /* GraphQL */ `
  query ShopInfo {
    shop { id name email myshopifyDomain currencyCode primaryDomain { url } }
  }
`;

const PRODUCT_SUMMARY_FIELDS = /* GraphQL */ `
  id title handle vendor onlineStoreUrl
  featuredMedia { preview { image { url(transform: { maxWidth: 240 }) } } }
  priceRangeV2 { minVariantPrice { amount currencyCode } maxVariantPrice { amount currencyCode } }
  variantsCount { count }
  variants(first: 10) { nodes { sku availableForSale } }
`;

const SEARCH_PRODUCTS_QUERY = /* GraphQL */ `
  query SearchProducts($first: Int!, $after: String, $query: String, $sortKey: ProductSortKeys, $reverse: Boolean) {
    products(first: $first, after: $after, query: $query, sortKey: $sortKey, reverse: $reverse) {
      nodes { ${PRODUCT_SUMMARY_FIELDS} }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const VARIANT_FIELDS = /* GraphQL */ `
  id title sku barcode price compareAtPrice availableForSale
  selectedOptions { name value }
  media(first: 1) { nodes { ... on MediaImage { image { url(transform: { maxWidth: 800 }) } } } }
`;

const PRODUCT_DETAIL_QUERY = /* GraphQL */ `
  query ProductDetail($id: ID!) {
    product(id: $id) {
      id title handle status vendor productType description onlineStoreUrl
      options { name position optionValues { name hasVariants } }
      media(first: 20) { nodes { ... on MediaImage { image { url(transform: { maxWidth: 800 }) altText } } } }
      priceRangeV2 { minVariantPrice { currencyCode } }
      variants(first: 100) { nodes { ${VARIANT_FIELDS} } pageInfo { hasNextPage } }
    }
  }
`;

const VARIANT_QUERY = /* GraphQL */ `
  query VariantDetail($id: ID!) {
    productVariant(id: $id) {
      ${VARIANT_FIELDS}
      product {
        id title handle status onlineStoreUrl
        featuredMedia { preview { image { url(transform: { maxWidth: 800 }) } } }
        priceRangeV2 { minVariantPrice { currencyCode } }
        variantsCount { count }
      }
    }
  }
`;

const CUSTOMER_FIELDS = /* GraphQL */ `
  id displayName createdAt numberOfOrders tags
  defaultEmailAddress { emailAddress }
  defaultPhoneNumber { phoneNumber }
  amountSpent { amount currencyCode }
`;

const SEARCH_CUSTOMERS_QUERY = /* GraphQL */ `
  query SearchCustomers($query: String!) {
    customers(first: 10, query: $query) { nodes { ${CUSTOMER_FIELDS} } }
  }
`;

const CUSTOMER_QUERY = /* GraphQL */ `
  query CustomerById($id: ID!) {
    customer(id: $id) { ${CUSTOMER_FIELDS} }
  }
`;

const STORE_OVERVIEW_QUERY = /* GraphQL */ `
  query StoreOverview {
    shop {
      name email contactEmail myshopifyDomain currencyCode ianaTimezone createdAt
      plan { publicDisplayName partnerDevelopment shopifyPlus }
      primaryDomain { url }
      shopAddress { city province country }
    }
    productsCount(query: "status:active", limit: null) { count precision }
    customersCount(limit: null) { count precision }
    ordersCount(limit: null) { count precision }
  }
`;

const LIST_CUSTOMERS_QUERY = /* GraphQL */ `
  query ListCustomers($first: Int!, $after: String, $query: String, $sortKey: CustomerSortKeys, $reverse: Boolean) {
    customers(first: $first, after: $after, query: $query, sortKey: $sortKey, reverse: $reverse) {
      nodes {
        ${CUSTOMER_FIELDS}
        defaultAddress { city countryCodeV2 }
        lastOrder { name createdAt }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const ORDER_FIELDS = /* GraphQL */ `
  id name createdAt cancelledAt closed displayFinancialStatus displayFulfillmentStatus
  totalPriceSet { shopMoney { amount currencyCode } }
  lineItems(first: 20) {
    nodes { id title variantTitle quantity sku image { url(transform: { maxWidth: 120 }) } }
    pageInfo { hasNextPage }
  }
`;

const CUSTOMER_ORDERS_QUERY = /* GraphQL */ `
  query CustomerOrders($id: ID!, $first: Int!, $after: String) {
    customer(id: $id) {
      ${CUSTOMER_FIELDS}
      orders(first: $first, after: $after, sortKey: CREATED_AT, reverse: true) {
        nodes { ${ORDER_FIELDS} }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

const ORDER_REF_QUERY = /* GraphQL */ `
  query OrderRef($id: ID!) {
    order(id: $id) { id name }
  }
`;

const LIST_ORDERS_QUERY = /* GraphQL */ `
  query ListOrders($first: Int!, $after: String, $query: String) {
    orders(first: $first, after: $after, query: $query, sortKey: CREATED_AT, reverse: true) {
      nodes {
        ${ORDER_FIELDS}
        customer { id displayName defaultEmailAddress { emailAddress } }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const SEARCH_ORDERS_QUERY = /* GraphQL */ `
  query SearchOrders($query: String!) {
    orders(first: 10, query: $query, sortKey: CREATED_AT, reverse: true) {
      nodes { ${ORDER_FIELDS} customer { ${CUSTOMER_FIELDS} } }
    }
  }
`;

/* ------------------------------------------------------------------ */
/* Mapping                                                             */
/* ------------------------------------------------------------------ */

type Node = Record<string, any>;

const money = (m: Node | null | undefined): ShopifyMoney | null =>
  m && m.amount !== undefined ? { amount: String(m.amount), currencyCode: String(m.currencyCode) } : null;

const productUrlFor = (onlineStoreUrl: string | null | undefined, variantLegacyId?: string) =>
  onlineStoreUrl ? (variantLegacyId ? `${onlineStoreUrl}?variant=${variantLegacyId}` : onlineStoreUrl) : null;

function mapProductSummary(p: Node): ShopifyProductSummary {
  const variants: Node[] = p.variants?.nodes ?? [];
  return {
    id: p.id,
    legacyId: shopifyLegacyId(p.id),
    title: p.title,
    handle: p.handle,
    vendor: p.vendor || null,
    imageUrl: p.featuredMedia?.preview?.image?.url ?? null,
    priceMin: money(p.priceRangeV2?.minVariantPrice),
    priceMax: money(p.priceRangeV2?.maxVariantPrice),
    variantsCount: Number(p.variantsCount?.count ?? variants.length),
    available: variants.some((v) => v.availableForSale),
    sku: variants.length === 1 ? variants[0].sku || null : null,
    productUrl: p.onlineStoreUrl ?? null,
  };
}

function mapVariant(v: Node): ShopifyVariant {
  return {
    id: v.id,
    legacyId: shopifyLegacyId(v.id),
    title: v.title,
    sku: v.sku || null,
    barcode: v.barcode || null,
    price: String(v.price),
    compareAtPrice: v.compareAtPrice != null ? String(v.compareAtPrice) : null,
    available: Boolean(v.availableForSale),
    selectedOptions: (v.selectedOptions ?? []).map((o: Node) => ({ name: o.name, value: o.value })),
    imageUrl: v.media?.nodes?.find((m: Node) => m?.image?.url)?.image?.url ?? null,
  };
}

function mapCustomer(c: Node): ShopifyCustomerSummary {
  return {
    id: c.id,
    legacyId: shopifyLegacyId(c.id),
    displayName: c.displayName || c.defaultEmailAddress?.emailAddress || "Unnamed customer",
    email: c.defaultEmailAddress?.emailAddress ?? null,
    phone: c.defaultPhoneNumber?.phoneNumber ?? null,
    numberOfOrders: Number(c.numberOfOrders ?? 0),
    amountSpent: money(c.amountSpent),
    tags: Array.isArray(c.tags) ? c.tags.map(String) : [],
    createdAt: c.createdAt,
  };
}

function mapOrder(o: Node, shopDomain: string): ShopifyOrder {
  const legacyId = shopifyLegacyId(o.id);
  return {
    id: o.id,
    legacyId,
    name: o.name,
    createdAt: o.createdAt,
    cancelledAt: o.cancelledAt ?? null,
    closed: Boolean(o.closed),
    financialStatus: o.displayFinancialStatus ?? null,
    fulfillmentStatus: o.displayFulfillmentStatus ?? null,
    total: money(o.totalPriceSet?.shopMoney),
    lineItems: (o.lineItems?.nodes ?? []).map((li: Node) => ({
      id: li.id,
      title: li.title,
      variantTitle: li.variantTitle && li.variantTitle !== "Default Title" ? li.variantTitle : null,
      quantity: Number(li.quantity ?? 0),
      sku: li.sku || null,
      imageUrl: li.image?.url ?? null,
    })),
    moreLineItems: Boolean(o.lineItems?.pageInfo?.hasNextPage),
    adminUrl: `https://${shopDomain}/admin/orders/${legacyId}`,
  };
}

const toCount = (c: Node | null | undefined): ShopifyCount | null =>
  c && c.count !== undefined ? { count: Number(c.count), atLeast: c.precision === "AT_LEAST" } : null;

const CUSTOMER_LIST_SORTS: Record<ShopifyCustomerListSort, { sortKey: string; reverse: boolean }> = {
  updated: { sortKey: "UPDATED_AT", reverse: true },
  created: { sortKey: "CREATED_AT", reverse: true },
  name: { sortKey: "NAME", reverse: false },
};

/** Shopify search syntax value, quoted so spaces, colons and parentheses can't change the query */
const quoteSearchValue = (value: string) => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

function buildProductSearchQuery(term: string): string {
  const words = prefixWords(term);
  const quoted = quoteSearchValue(term);
  const titleClause = words ? `(${words.replace(/(^| AND )/g, "$1title:")}) OR ` : "";
  // Drafts and archived products can't be bought, so they're never offered for sharing
  return `status:active AND (${titleClause}sku:${quoted} OR barcode:${quoted})`;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_MATCH_IDENTIFIERS = 5;

/** Letters, digits and a few separators of each word, as prefix terms: "jee kum" → "jee* AND kum*" */
function prefixWords(term: string): string {
  return term
    .split(/\s+/)
    // A leading "-" would negate the term in Shopify search syntax
    .map((w) => w.replace(/[^\p{L}\p{N}_.-]/gu, "").replace(/^-+/, ""))
    .filter(Boolean)
    .slice(0, 6)
    .map((w) => `${w}*`)
    .join(" AND ");
}

/** Free-text customer search: an email, a phone number, or words of the name */
function buildCustomerSearchQuery(term: string): string {
  if (EMAIL_PATTERN.test(term)) return `email:${quoteSearchValue(term.toLowerCase())}`;
  const digits = term.replace(/\D/g, "");
  if (digits.length >= 6 && /^[\d\s()+.-]+$/.test(term)) return `phone:${quoteSearchValue(`+${digits}`)}`;
  return prefixWords(term);
}

/** Order search: an order number ("#1001", "1001", "SO-1001"), an email, or any other text */
function buildOrderSearchQuery(term: string): string {
  if (EMAIL_PATTERN.test(term)) return `email:${quoteSearchValue(term.toLowerCase())}`;
  if (/^#?[\p{L}\p{N}_-]*\d[\p{L}\p{N}_-]*$/u.test(term)) {
    const bare = term.replace(/^#/, "");
    return `name:${quoteSearchValue(`#${bare}`)} OR name:${quoteSearchValue(bare)}`;
  }
  return quoteSearchValue(term);
}

/* ------------------------------------------------------------------ */
/* Service                                                             */
/* ------------------------------------------------------------------ */

export class ShopifyService {
  isConfigured(): boolean {
    try {
      getShopifyConfig();
      return true;
    } catch {
      return false;
    }
  }

  async getConnection(organizationId: number) {
    const stores = await shopifyRepository.findActiveStores(organizationId);
    return {
      configured: this.isConfigured(),
      distribution: getShopifyDistribution(),
      stores: stores.map(toStoreInfo),
    };
  }

  /* ---------------- Connection lifecycle ---------------- */

  /**
   * Connects another store, or (reauthorize) re-authorizes one this workspace already has (expired token,
   * missing scopes). A store that is still connected can't be added again until it's disconnected.
   */
  async startInstall(user: AuthUser, shop: string, { reauthorize = false }: { reauthorize?: boolean } = {}) {
    await this.assertShopCanConnect(user.organizationId, shop, { allowSameWorkspace: reauthorize });
    return buildAuthorizeUrl({ organizationId: user.organizationId, userId: user.id, shop });
  }

  /**
   * Blocks connecting a shop that is live in another workspace (disconnecting there would revoke this workspace's
   * access too), and, unless re-authorizing, one this workspace already has.
   */
  private async assertShopCanConnect(organizationId: number, shop: string, { allowSameWorkspace }: { allowSameWorkspace: boolean }) {
    const live = await shopifyRepository.findActiveStoresByDomain(shop);

    // 409 CONFLICT with `details.reason: "store_already_connected"` tells callers apart from other conflicts
    if (live.some((s) => s.organizationId !== organizationId)) {
      throw new AppError("CONFLICT", {
        message: `${shop} is already connected to another UnoCX workspace. Disconnect it there first, then connect it here.`,
        details: { shop, reason: "store_already_connected", connectedTo: "other_workspace" },
        expected: true,
      });
    }

    const own = live.find((s) => s.organizationId === organizationId);
    if (own && !allowSameWorkspace) {
      const label = own.name ? `${own.name} (${shop})` : shop;
      throw new AppError("CONFLICT", {
        message:
          own.status === ShopifyStoreStatus.REAUTH_REQUIRED
            ? `${label} is already connected to this workspace and needs to be reconnected. Open the store and use Reconnect store.`
            : `${label} is already connected to this workspace. Disconnect it first to connect it again.`,
        details: { shop, storeId: own.id, reason: "store_already_connected", connectedTo: "this_workspace" },
        expected: true,
      });
    }
    // This workspace's live row for the shop, if any: connecting it again is a re-authorization
    return own ?? null;
  }

  /**
   * OAuth callback: every check has to pass before a token is requested or stored.
   * `reconnected` is true when the workspace already had this store (a re-authorization), false for a new connection.
   */
  async completeInstall(
    searchParams: URLSearchParams,
    nonceCookie: string | undefined
  ): Promise<{ store: ShopifyStore; reconnected: boolean }> {
    const shop = searchParams.get("shop") || "";
    const code = searchParams.get("code") || "";

    if (!isValidShopDomain(shop)) {
      throw new AppError("SHOPIFY_OAUTH_FAILED", { details: { reason: "invalid_shop" }, expected: true });
    }
    if (!verifyCallbackHmac(searchParams)) {
      throw new AppError("SHOPIFY_OAUTH_FAILED", { details: { reason: "bad_hmac" }, expected: true });
    }
    const state = verifyState(searchParams.get("state"), nonceCookie, shop);
    if (!code) {
      throw new AppError("SHOPIFY_OAUTH_FAILED", { details: { reason: "missing_code" }, expected: true });
    }
    // Checked again here: another workspace may have connected the shop while this one was on Shopify's approval
    // page. This workspace's own row is fine (the install was allowed to start, e.g. a re-authorization).
    const existing = await this.assertShopCanConnect(state.o, shop, { allowSameWorkspace: true });

    const token = await exchangeCodeForToken(shop, code);
    const missing = SHOPIFY_REQUIRED_SCOPES.filter((s) => !hasScope(token.scopes, s));
    if (missing.length > 0) {
      throw new AppError("SHOPIFY_OAUTH_FAILED", {
        message: `The store didn't grant all required permissions (${missing.join(", ")}). Please connect again and approve them.`,
        details: { reason: "missing_scopes", missing },
        expected: true,
      });
    }

    const { shop: info } = await shopifyGraphql<{ shop: Node }>(shop, token.accessToken, "shop_info", SHOP_QUERY);

    const store = await shopifyRepository.upsertStore({
      organizationId: state.o,
      shopDomain: shop,
      shopifyShopId: info?.id ?? null,
      name: info?.name ?? null,
      email: info?.email ?? null,
      currencyCode: info?.currencyCode ?? null,
      primaryDomainUrl: info?.primaryDomain?.url ?? null,
      accessToken: encryptToken(token.accessToken),
      refreshToken: token.refreshToken ? encryptToken(token.refreshToken) : null,
      tokenExpiresAt: token.expiresAt,
      scopes: token.scopes.join(","),
      connectedById: state.u,
    });
    const reconnected = existing !== null;
    log.info(reconnected ? "Shopify store re-authorized" : "Shopify store connected", { organizationId: state.o, shop, storeId: store.id });

    // Automatically subscribe to essential Shopify webhooks (orders/create, orders/cancelled, orders/paid, checkouts/create, checkouts/update)
    try {
      const config = getShopifyConfig();
      const callbackUrl = `${config.appUrl}${SHOPIFY_WEBHOOKS_PATH}`;
      const subResult = await subscribeShopifyWebhooks(shop, token.accessToken, callbackUrl);
      log.info("Shopify webhook subscription attempted during install", {
        shop,
        allSubscribed: subResult.allSubscribed,
        results: subResult.results,
      });
    } catch (whErr: any) {
      log.warn("Failed to subscribe Shopify webhooks during installation", {
        shop,
        err: whErr?.message,
      });
    }

    return { store, reconnected };
  }

  /**
   * Subscribes a connected store to the required webhooks:
   * orders/create, orders/cancelled, orders/paid, checkouts/create, checkouts/update
   */
  async subscribeStoreWebhooks(organizationId: number, storeId: number) {
    const store = await shopifyRepository.findActiveStore(organizationId, storeId);
    if (!store) throw new AppError("SHOPIFY_NOT_CONNECTED", { expected: true });
    const token = store.accessToken ? decryptToken(store.accessToken) : "";
    if (!token) throw new AppError("SHOPIFY_NOT_CONNECTED", { expected: true });

    const config = getShopifyConfig();
    const callbackUrl = `${config.appUrl}${SHOPIFY_WEBHOOKS_PATH}`;
    return await subscribeShopifyWebhooks(store.shopDomain, token, callbackUrl);
  }

  /**
   * Lists existing webhooks configured on Shopify for this store.
   */
  async listStoreWebhooks(organizationId: number, storeId: number) {
    const store = await shopifyRepository.findActiveStore(organizationId, storeId);
    if (!store) throw new AppError("SHOPIFY_NOT_CONNECTED", { expected: true });
    const token = store.accessToken ? decryptToken(store.accessToken) : "";
    if (!token) throw new AppError("SHOPIFY_NOT_CONNECTED", { expected: true });

    return await listShopifyWebhooks(store.shopDomain, token);
  }

  /** Revokes and clears the token. Channel mappings and links stay, so reconnecting the shop restores them. */
  async disconnect(organizationId: number, storeId: number): Promise<void> {
    const store = await shopifyRepository.findActiveStore(organizationId, storeId);
    if (!store) throw new AppError("SHOPIFY_NOT_CONNECTED", { expected: true });

    const token = store.accessToken ? decryptToken(store.accessToken) : "";
    if (token) {
      try {
        await revokeShopifyAccess(store.shopDomain, token);
      } catch (err) {
        // The token is deleted on our side either way
        log.warn("Could not revoke Shopify access token", { err: toAppError(err), shop: store.shopDomain });
      }
    }

    // Its numbers have no store until the shop is reconnected (or they're connected to another store)
    await shopifyRepository.markStoreDisconnected(store.id, organizationId);
    log.info("Shopify store disconnected", { organizationId, shop: store.shopDomain, storeId: store.id });
  }

  /* ---------------- Authenticated Admin API calls ---------------- */

  /** The store for this scope (see StoreScope), usable for Admin API calls */
  private async requireStore(user: AuthUser, scope: StoreScope): Promise<ShopifyStoreWithUser> {
    const resolved = await shopifyStoreConnectionService.resolveStore(user, scope);
    if (!resolved) throw new AppError("SHOPIFY_NOT_CONNECTED", { expected: true });
    if (resolved.store.status === ShopifyStoreStatus.REAUTH_REQUIRED) {
      throw new AppError("SHOPIFY_AUTH_FAILED", { details: { storeId: resolved.store.id }, expected: true });
    }
    return resolved.store;
  }

  private async markReauthRequired(store: ShopifyStore, reason: string) {
    try {
      await shopifyRepository.updateStore(store.id, store.organizationId, {
        status: ShopifyStoreStatus.REAUTH_REQUIRED,
        lastError: reason.slice(0, 500),
      });
    } catch (err) {
      log.warn("Could not flag Shopify store for re-authorization", { err, storeId: store.id });
    }
  }

  private async accessTokenFor(store: ShopifyStore): Promise<string> {
    let token = store.accessToken ? decryptToken(store.accessToken) : "";
    if (!token) {
      await this.markReauthRequired(store, "Stored access token could not be read.");
      throw new AppError("SHOPIFY_AUTH_FAILED", { expected: true });
    }

    // Expiring offline tokens only: refresh shortly before expiry
    if (store.tokenExpiresAt && store.refreshToken && store.tokenExpiresAt.getTime() - Date.now() < TOKEN_REFRESH_MARGIN_MS) {
      try {
        const refreshed = await refreshAccessToken(store.shopDomain, decryptToken(store.refreshToken));
        await shopifyRepository.updateStore(store.id, store.organizationId, {
          accessToken: encryptToken(refreshed.accessToken),
          refreshToken: refreshed.refreshToken ? encryptToken(refreshed.refreshToken) : store.refreshToken,
          tokenExpiresAt: refreshed.expiresAt,
        });
        token = refreshed.accessToken;
      } catch (err) {
        const appError = toAppError(err);
        if (appError.code === "SHOPIFY_AUTH_FAILED") await this.markReauthRequired(store, "Access token refresh was rejected.");
        throw appError;
      }
    }
    return token;
  }

  private async query<T>(store: ShopifyStore, operation: string, document: string, variables?: Record<string, unknown>): Promise<T> {
    const token = await this.accessTokenFor(store);
    try {
      return await shopifyGraphql<T>(store.shopDomain, token, operation, document, variables);
    } catch (err) {
      const appError = toAppError(err);
      if (appError.code === "SHOPIFY_AUTH_FAILED") {
        await this.markReauthRequired(store, appError.provider?.message || "Shopify rejected the access token.");
      }
      throw appError;
    }
  }

  /* ---------------- Store details ---------------- */

  /** Live details and counts of one store, straight from Shopify */
  async getStoreOverview(user: AuthUser, storeId: number): Promise<ShopifyStoreOverview> {
    const store = await this.requireStore(user, { storeId });
    const data = await this.query<{ shop: Node; productsCount: Node | null; customersCount: Node | null; ordersCount: Node | null }>(
      store,
      "store_overview",
      STORE_OVERVIEW_QUERY
    );
    const shop = data.shop ?? {};
    const address = [shop.shopAddress?.city, shop.shopAddress?.province, shop.shopAddress?.country].filter(Boolean).join(", ");
    return {
      name: shop.name ?? store.name ?? store.shopDomain,
      email: shop.email ?? null,
      contactEmail: shop.contactEmail ?? null,
      myshopifyDomain: shop.myshopifyDomain ?? store.shopDomain,
      currencyCode: shop.currencyCode ?? store.currencyCode ?? "",
      timezone: shop.ianaTimezone ?? null,
      shopCreatedAt: shop.createdAt ?? null,
      plan: {
        name: shop.plan?.publicDisplayName ?? null,
        shopifyPlus: Boolean(shop.plan?.shopifyPlus),
        developmentStore: Boolean(shop.plan?.partnerDevelopment),
      },
      address: address || null,
      storefrontUrl: shop.primaryDomain?.url ?? store.primaryDomainUrl ?? null,
      counts: { products: toCount(data.productsCount), customers: toCount(data.customersCount), orders: toCount(data.ordersCount) },
    };
  }

  /**
   * One page of a store's customers, each with its tags and the UnoCX contact it's linked to.
   * `q` is a name, email or phone number; `tag` keeps only customers with that tag.
   */
  async listStoreCustomers(
    user: AuthUser,
    storeId: number,
    params: { q?: string; tag?: string; sort?: ShopifyCustomerListSort; after?: string | null }
  ): Promise<ShopifyPage<ShopifyStoreCustomer>> {
    const q = params.q?.trim().slice(0, 100);
    const tag = params.tag?.trim().slice(0, 255);
    const clauses = [q ? buildCustomerSearchQuery(q) : "", tag ? `tag:${quoteSearchValue(tag)}` : ""].filter(Boolean);
    const query = clauses.length > 1 ? clauses.map((c) => `(${c})`).join(" AND ") : clauses[0] || null;
    // A free-text search is ordered by relevance; otherwise by the chosen sort
    const sort = q ? { sortKey: "RELEVANCE", reverse: false } : CUSTOMER_LIST_SORTS[params.sort ?? "updated"];

    const store = await this.requireStore(user, { storeId });
    const data = await this.query<{ customers: { nodes: Node[]; pageInfo: Node } }>(store, "list_customers", LIST_CUSTOMERS_QUERY, {
      first: CUSTOMERS_PAGE_SIZE,
      after: params.after || null,
      query,
      ...sort,
    });

    const nodes = data.customers.nodes;
    const links = await shopifyRepository.findLinkedContacts(user.organizationId, store.id, nodes.map((c) => c.id));
    const linkByCustomer = new Map(links.map((l) => [l.shopifyCustomerId, { id: l.customerId, name: l.customerName }]));

    return {
      items: nodes.map((c) => {
        const summary = mapCustomer(c);
        const location = [c.defaultAddress?.city, c.defaultAddress?.countryCodeV2].filter(Boolean).join(", ");
        return {
          ...summary,
          location: location || null,
          lastOrder: c.lastOrder ? { name: String(c.lastOrder.name), createdAt: String(c.lastOrder.createdAt) } : null,
          linkedContact: linkByCustomer.get(c.id) ?? null,
          adminUrl: `https://${store.shopDomain}/admin/customers/${summary.legacyId}`,
        };
      }),
      hasNextPage: Boolean(data.customers.pageInfo?.hasNextPage),
      endCursor: data.customers.pageInfo?.endCursor ?? null,
    };
  }

  /** One page of a store's orders, newest first. `q` is an order number, email or other text. */
  async listStoreOrders(
    user: AuthUser,
    storeId: number,
    params: { q?: string; status?: ShopifyOrderStatusFilter; after?: string | null }
  ): Promise<ShopifyPage<ShopifyStoreOrder>> {
    const q = params.q?.trim().slice(0, 100);
    const clauses = [q ? buildOrderSearchQuery(q) : "", params.status && params.status !== "any" ? `status:${params.status}` : ""].filter(Boolean);
    const query = clauses.length > 1 ? clauses.map((c) => `(${c})`).join(" AND ") : clauses[0] || null;

    const store = await this.requireStore(user, { storeId });
    const data = await this.query<{ orders: { nodes: Node[]; pageInfo: Node } }>(store, "list_orders", LIST_ORDERS_QUERY, {
      first: STORE_ORDERS_PAGE_SIZE,
      after: params.after || null,
      query,
    });

    return {
      items: data.orders.nodes.map((o) => ({
        ...mapOrder(o, store.shopDomain),
        customer: o.customer
          ? {
              id: o.customer.id,
              legacyId: shopifyLegacyId(o.customer.id),
              displayName: o.customer.displayName || o.customer.defaultEmailAddress?.emailAddress || "Unnamed customer",
              email: o.customer.defaultEmailAddress?.emailAddress ?? null,
            }
          : null,
      })),
      hasNextPage: Boolean(data.orders.pageInfo?.hasNextPage),
      endCursor: data.orders.pageInfo?.endCursor ?? null,
    };
  }

  /** A customer of the store with one page of their orders, newest first */
  async getStoreCustomerOrders(
    user: AuthUser,
    storeId: number,
    shopifyCustomerId: string,
    after?: string | null
  ): Promise<ShopifyCustomerOrdersPage> {
    const gid = toShopifyGid("Customer", shopifyCustomerId);
    if (!gid) throw AppError.validation("Invalid Shopify customer id.", "customerId");

    const store = await this.requireStore(user, { storeId });
    const { customer } = await this.query<{ customer: Node | null }>(store, "customer_orders", CUSTOMER_ORDERS_QUERY, {
      id: gid,
      first: ORDERS_PAGE_SIZE,
      after: after || null,
    });
    if (!customer) return { customer: null, orders: { items: [], hasNextPage: false, endCursor: null } };

    return {
      customer: mapCustomer(customer),
      orders: {
        items: (customer.orders?.nodes ?? []).map((o: Node) => mapOrder(o, store.shopDomain)),
        hasNextPage: Boolean(customer.orders?.pageInfo?.hasNextPage),
        endCursor: customer.orders?.pageInfo?.endCursor ?? null,
      },
    };
  }

  /* ---------------- Products ---------------- */

  async searchProducts(user: AuthUser, scope: StoreScope, term: string, after?: string | null): Promise<ShopifyPage<ShopifyProductSummary>> {
    const store = await this.requireStore(user, scope);
    const q = term.trim().slice(0, 100);
    const data = await this.query<{ products: { nodes: Node[]; pageInfo: Node } }>(store, "search_products", SEARCH_PRODUCTS_QUERY, {
      first: PRODUCTS_PAGE_SIZE,
      after: after || null,
      query: q ? buildProductSearchQuery(q) : "status:active",
      sortKey: q ? "RELEVANCE" : "UPDATED_AT",
      reverse: !q,
    });
    return {
      items: data.products.nodes.map(mapProductSummary),
      hasNextPage: Boolean(data.products.pageInfo?.hasNextPage),
      endCursor: data.products.pageInfo?.endCursor ?? null,
    };
  }

  async getProduct(user: AuthUser, scope: StoreScope, productId: string): Promise<ShopifyProductDetail> {
    const gid = toShopifyGid("Product", productId);
    if (!gid) throw AppError.validation("Invalid product id.", "productId");

    const store = await this.requireStore(user, scope);
    const { product: p } = await this.query<{ product: Node | null }>(store, "product_detail", PRODUCT_DETAIL_QUERY, { id: gid });
    if (!p) throw AppError.notFound("This product no longer exists in your Shopify store.");

    return {
      id: p.id,
      legacyId: shopifyLegacyId(p.id),
      title: p.title,
      handle: p.handle,
      status: p.status,
      vendor: p.vendor || null,
      productType: p.productType || null,
      description: p.description || "",
      currencyCode: p.priceRangeV2?.minVariantPrice?.currencyCode || store.currencyCode || "USD",
      images: (p.media?.nodes ?? [])
        .filter((m: Node) => m?.image?.url)
        .map((m: Node) => ({ url: m.image.url, altText: m.image.altText ?? null })),
      options: [...(p.options ?? [])]
        .sort((a: Node, b: Node) => a.position - b.position)
        // A value can be defined on the product without any variant using it (e.g. a size not stocked): only offer real ones
        .map((o: Node) => ({
          name: o.name,
          values: (o.optionValues ?? []).filter((v: Node) => v.hasVariants !== false).map((v: Node) => v.name),
        }))
        .filter((o: { values: string[] }) => o.values.length > 0),
      variants: (p.variants?.nodes ?? []).map(mapVariant),
      hasMoreVariants: Boolean(p.variants?.pageInfo?.hasNextPage),
      productUrl: p.onlineStoreUrl ?? null,
    };
  }

  /** Loads a variant straight from Shopify, so what gets shared is always current and real */
  async getVariant(user: AuthUser, scope: StoreScope, variantId: string) {
    const gid = toShopifyGid("ProductVariant", variantId);
    if (!gid) throw AppError.validation("Invalid variant id.", "variantId");

    const store = await this.requireStore(user, scope);
    const { productVariant: v } = await this.query<{ productVariant: Node | null }>(store, "variant_detail", VARIANT_QUERY, { id: gid });
    if (!v || !v.product) throw AppError.notFound("This product option no longer exists in your Shopify store.");

    const variant = mapVariant(v);
    const product = v.product as Node;
    const multiVariant = Number(product.variantsCount?.count ?? 1) > 1;
    const shared: SharedShopifyProduct = {
      storeId: store.id,
      productId: product.id,
      variantId: variant.id,
      title: product.title,
      variantTitle: multiVariant ? variant.title : null,
      options: multiVariant ? variant.selectedOptions : [],
      sku: variant.sku,
      price: variant.price,
      currencyCode: product.priceRangeV2?.minVariantPrice?.currencyCode || store.currencyCode || "USD",
      available: variant.available,
      imageUrl: variant.imageUrl || product.featuredMedia?.preview?.image?.url || null,
      productUrl: productUrlFor(product.onlineStoreUrl, multiVariant ? variant.legacyId : undefined),
    };
    return { productStatus: String(product.status), variant, shared };
  }

  /* ---------------- Sharing ---------------- */

  /** The product comes from the store of the channel it's sent on (an explicit storeId must be that store) */
  async shareProduct(
    user: AuthUser,
    params: { customerId: number; channelId?: number; storeId?: number; productId?: string; variantId: string; caption?: string }
  ) {
    const customer = await customerService.requireVisible(params.customerId, user.organizationId);
    if (!customer.phone) {
      throw AppError.validation(`"${customer.name}" has no phone number, so the product can't be sent on WhatsApp.`, "customerId");
    }

    const channelId = params.channelId ?? customer.channelId ?? undefined;
    const { productStatus, shared } = await this.getVariant(user, { storeId: params.storeId, channelId }, params.variantId);
    if (params.productId && toShopifyGid("Product", params.productId) !== shared.productId) {
      throw AppError.validation("The selected option doesn't belong to this product.", "variantId");
    }
    if (productStatus !== "ACTIVE") {
      throw AppError.validation("This product isn't active in your Shopify store, so it can't be shared.", "productId");
    }

    const text = params.caption?.trim() ? params.caption.trim().slice(0, 1024) : buildProductMessageText(shared);
    const result = await whatsAppService.sendMessage({
      organizationId: user.organizationId,
      channelId,
      senderId: user.id,
      senderName: user.name,
      customerId: customer.id,
      to: customer.phone,
      text,
      ...(shared.imageUrl ? { mediaLink: shared.imageUrl, mediaType: "image" as const } : { type: "text" as const }),
      metadata: { shopifyProduct: shared },
    });

    log.info("Shopify product shared", { customerId: customer.id, storeId: shared.storeId, productId: shared.productId, variantId: shared.variantId });
    return { ...result, product: shared };
  }

  /* ---------------- Customers & links ---------------- */

  /**
   * Customer search for linking: `q` is a name, email or phone number; `email` / `phone` match exactly (any of
   * them may match). `tag` narrows the result to customers with that tag, and can also be used on its own.
   */
  async searchCustomers(
    user: AuthUser,
    scope: StoreScope,
    params: { q?: string; email?: string; phone?: string; tag?: string }
  ): Promise<ShopifyCustomerSummary[]> {
    const q = params.q?.trim().slice(0, 100);
    const email = params.email?.trim().toLowerCase();
    const phoneDigits = params.phone?.replace(/\D/g, "");
    const tag = params.tag?.trim().slice(0, 255);

    const clauses: string[] = [];
    if (q) {
      const clause = buildCustomerSearchQuery(q);
      if (!clause) throw AppError.validation("Enter a name, email address or phone number to search.", "q");
      clauses.push(`(${clause})`);
    }
    if (email) {
      if (!EMAIL_PATTERN.test(email)) throw AppError.validation("Enter a valid email address.", "email");
      clauses.push(`email:${quoteSearchValue(email)}`);
    }
    if (phoneDigits) {
      if (phoneDigits.length < 6) throw AppError.validation("Enter a phone number with its country code.", "phone");
      clauses.push(`phone:${quoteSearchValue(`+${phoneDigits}`)}`);
    }
    if (clauses.length === 0 && !tag) throw AppError.validation("Enter a name, email address or phone number to search.", "q");

    const tagClause = tag ? `tag:${quoteSearchValue(tag)}` : "";
    const identity = clauses.join(" OR ");
    const query = identity && tagClause ? `(${identity}) AND ${tagClause}` : identity || tagClause;

    const store = await this.requireStore(user, scope);
    const data = await this.query<{ customers: { nodes: Node[] } }>(store, "search_customers", SEARCH_CUSTOMERS_QUERY, { query });
    return data.customers.nodes.map(mapCustomer);
  }

  /** Orders by number, email or other text, each with its customer so the agent can link them */
  async searchOrders(user: AuthUser, scope: StoreScope, term: string): Promise<ShopifyOrderSearchResult[]> {
    const q = term.trim().slice(0, 100);
    if (!q) throw AppError.validation("Enter an order number or email address to search.", "q");

    const store = await this.requireStore(user, scope);
    const data = await this.query<{ orders: { nodes: Node[] } }>(store, "search_orders", SEARCH_ORDERS_QUERY, {
      query: buildOrderSearchQuery(q),
    });
    return data.orders.nodes.map((o) => ({
      order: mapOrder(o, store.shopDomain),
      customer: o.customer ? mapCustomer(o.customer) : null,
    }));
  }

  /** The contact's profile id: Shopify links are shared by every channel identity of a person */
  private async requireProfile(organizationId: number, customerId: number) {
    const contact = await customerService.requireVisible(customerId, organizationId);
    return { contact, profileId: customerService.profileIdOf(contact) };
  }

  /** Links the contact's profile in the store of the contact's channel (or the given store) */
  async linkCustomer(user: AuthUser, customerId: number, shopifyCustomerId: string, storeId?: number) {
    const gid = toShopifyGid("Customer", shopifyCustomerId);
    if (!gid) throw AppError.validation("Invalid Shopify customer id.", "shopifyCustomerId");

    const { profileId } = await this.requireProfile(user.organizationId, customerId);
    const store = await this.requireStore(user, { storeId, customerId });

    // Never trust the id from the browser: it has to be a real customer of this store
    const { customer } = await this.query<{ customer: Node | null }>(store, "customer_by_id", CUSTOMER_QUERY, { id: gid });
    if (!customer) throw AppError.notFound("This customer was not found in your Shopify store.");

    const other = await shopifyRepository.findLinkByShopifyCustomer(user.organizationId, store.id, gid);
    if (other && other.customerId !== profileId) {
      throw new AppError("SHOPIFY_CUSTOMER_ALREADY_LINKED", { details: { linkedContactId: other.customerId }, expected: true });
    }

    try {
      await shopifyRepository.upsertLink({
        organizationId: user.organizationId,
        storeId: store.id,
        customerId: profileId,
        shopifyCustomerId: gid,
        linkedById: user.id,
        source: ShopifyLinkSource.MANUAL,
      });
    } catch (err) {
      const appError = toAppError(err);
      if (appError.code === "DB_CONSTRAINT_VIOLATION") {
        throw new AppError("SHOPIFY_CUSTOMER_ALREADY_LINKED", { cause: appError, expected: true });
      }
      throw appError;
    }

    log.info("Contact linked to Shopify customer", { customerId, profileId, storeId: store.id, shopifyCustomerId: gid });
    return mapCustomer(customer);
  }

  async unlinkCustomer(user: AuthUser, customerId: number, storeId?: number): Promise<void> {
    const { profileId } = await this.requireProfile(user.organizationId, customerId);
    // A store needing re-authorization can still be unlinked: no Shopify call is made
    const resolved = await shopifyStoreConnectionService.resolveStore(user, { storeId, customerId });
    if (!resolved) throw new AppError("SHOPIFY_NOT_CONNECTED", { expected: true });
    const { store } = resolved;

    const removed = await shopifyRepository.markUnlinked(user.organizationId, store.id, profileId, user.id);
    if (!removed) throw AppError.notFound("This contact isn't linked to a Shopify customer.");
    log.info("Contact unlinked from Shopify customer", { customerId, profileId, storeId: store.id });
  }

  /**
   * Finds the profile's Shopify customer by the phone numbers and emails of all its channel identities.
   * Exactly one unclaimed match is linked automatically; anything else is left for an agent to choose.
   */
  private async autoMatch(
    store: ShopifyStoreWithUser,
    organizationId: number,
    profileId: number
  ): Promise<{ status: ShopifyAutoMatchStatus; candidates: ShopifyCustomerSummary[] }> {
    const members = await customerRepository.listProfileMembers(organizationId, profileId);
    const phones = [...new Set(members.map((m) => m.phone?.replace(/\D/g, "")).filter((p): p is string => !!p && p.length >= 6))];
    const emails = [...new Set(members.map((m) => m.email?.trim().toLowerCase()).filter((e): e is string => !!e && EMAIL_PATTERN.test(e)))];
    if (phones.length === 0 && emails.length === 0) return { status: "no_details", candidates: [] };

    const clauses = [
      ...phones.slice(0, MAX_MATCH_IDENTIFIERS).map((p) => `phone:${quoteSearchValue(`+${p}`)}`),
      ...emails.slice(0, MAX_MATCH_IDENTIFIERS).map((e) => `email:${quoteSearchValue(e)}`),
    ];
    const data = await this.query<{ customers: { nodes: Node[] } }>(store, "match_customers", SEARCH_CUSTOMERS_QUERY, {
      query: clauses.join(" OR "),
    });

    // Shopify search is fuzzy; only exact phone or email matches count
    const candidates = data.customers.nodes
      .map(mapCustomer)
      .filter((c) => (c.phone && phones.includes(c.phone.replace(/\D/g, ""))) || (c.email && emails.includes(c.email.toLowerCase())));
    if (candidates.length === 0) return { status: "none", candidates };
    if (candidates.length > 1) return { status: "review", candidates };

    const [match] = candidates;
    const claimed = await shopifyRepository.findLinkByShopifyCustomer(organizationId, store.id, match.id);
    if (claimed && claimed.customerId !== profileId) return { status: "review", candidates };

    try {
      await shopifyRepository.upsertLink({
        organizationId,
        storeId: store.id,
        customerId: profileId,
        shopifyCustomerId: match.id,
        linkedById: null,
        source: ShopifyLinkSource.AUTO,
      });
    } catch (err) {
      // Another contact claimed this customer at the same moment
      if (toAppError(err).code === "DB_CONSTRAINT_VIOLATION") return { status: "review", candidates };
      throw err;
    }
    log.info("Contact linked to Shopify customer automatically", { profileId, storeId: store.id, shopifyCustomerId: match.id });
    return { status: "none", candidates: [] };
  }

  /**
   * Link + Shopify customer + one page of their orders, for the contact panel, from the store of the contact's
   * channel (or the given store). Matches unlinked contacts first.
   */
  async getContactOrders(
    user: AuthUser,
    customerId: number,
    after?: string | null,
    storeId?: number
  ): Promise<Omit<ShopifyContactOrdersResponse, "success">> {
    const organizationId = user.organizationId;
    const { profileId } = await this.requireProfile(organizationId, customerId);
    const emptyOrders: ShopifyPage<ShopifyOrder> = { items: [], hasNextPage: false, endCursor: null };

    const resolved = await shopifyStoreConnectionService.resolveStore(user, { storeId, customerId });
    if (!resolved) return { connected: false, store: null, link: null, shopifyCustomer: null, orders: emptyOrders, autoMatch: null };
    const { store } = resolved;
    if (store.status === ShopifyStoreStatus.REAUTH_REQUIRED) {
      throw new AppError("SHOPIFY_AUTH_FAILED", { details: { storeId: store.id }, expected: true });
    }

    const storeRef = toStoreRef(store);
    const unlinked = (autoMatch: ShopifyContactOrdersResponse["autoMatch"]) => ({
      connected: true,
      store: storeRef,
      link: null,
      shopifyCustomer: null,
      orders: emptyOrders,
      autoMatch,
    });

    let link = await shopifyRepository.findLink(organizationId, store.id, profileId);
    if (link && !link.shopifyCustomerId) return unlinked({ status: "dismissed", candidates: [] });
    if (!link) {
      const match = await this.autoMatch(store, organizationId, profileId);
      link = await shopifyRepository.findLink(organizationId, store.id, profileId);
      if (!link?.shopifyCustomerId) return unlinked(link ? { status: "dismissed", candidates: [] } : match);
    }

    const linkInfo = {
      id: link.id,
      shopifyCustomerId: link.shopifyCustomerId!,
      source: link.source,
      linkedAt: link.createdAt.toISOString(),
      linkedByName: link.linkedByName,
    };

    const { customer } = await this.query<{ customer: Node | null }>(store, "customer_orders", CUSTOMER_ORDERS_QUERY, {
      id: link.shopifyCustomerId,
      first: ORDERS_PAGE_SIZE,
      after: after || null,
    });
    // Deleted or merged in Shopify: keep the link so the agent sees it and can re-link
    if (!customer) return { connected: true, store: storeRef, link: linkInfo, shopifyCustomer: null, orders: emptyOrders, autoMatch: null };

    return {
      connected: true,
      store: storeRef,
      link: linkInfo,
      shopifyCustomer: mapCustomer(customer),
      orders: {
        items: (customer.orders?.nodes ?? []).map((o: Node) => mapOrder(o, store.shopDomain)),
        hasNextPage: Boolean(customer.orders?.pageInfo?.hasNextPage),
        endCursor: customer.orders?.pageInfo?.endCursor ?? null,
      },
      autoMatch: null,
    };
  }

  /* ---------------- Order associations ---------------- */

  /** Orders associated with the contact's profile, in the active stores the member can access; optionally one store */
  async listOrderLinks(user: AuthUser, customerId: number, storeId?: number): Promise<ShopifyOrderLinkInfo[]> {
    const { profileId } = await this.requireProfile(user.organizationId, customerId);
    const stores = (await shopifyRepository.findActiveStores(user.organizationId)).filter((s) => canAccessStore(user, s));
    if (storeId !== undefined && !stores.some((s) => s.id === storeId)) {
      throw new AppError("SHOPIFY_STORE_NOT_FOUND", { details: { storeId }, expected: true });
    }
    const visible = new Set(stores.map((s) => s.id));
    const rows = await shopifyRepository.listOrderLinks(user.organizationId, profileId, storeId);
    return rows.filter((row) => visible.has(row.shopifyStoreId)).map(toOrderLinkInfo);
  }

  /**
   * Associates an order with the contact's profile. The store is the one of the channel the order is
   * associated through (channelId, else the contact's channel), or the given store. The order is read from
   * Shopify first, so only real orders of that store can be associated. Associating it again is a no-op.
   */
  async linkOrder(
    user: AuthUser,
    customerId: number,
    params: { orderId: string; storeId?: number; channelId?: number }
  ): Promise<{ link: ShopifyOrderLinkInfo; created: boolean }> {
    const organizationId = user.organizationId;
    const gid = toShopifyGid("Order", params.orderId);
    if (!gid) throw AppError.validation("Invalid order id.", "orderId");

    const { contact, profileId } = await this.requireProfile(organizationId, customerId);
    if (params.channelId !== undefined && !(await channelRepository.findById(params.channelId, organizationId))) {
      throw AppError.notFound("Channel not found.");
    }
    const channelId = params.channelId ?? contact.channelId ?? null;
    const store = await this.requireStore(user, { storeId: params.storeId, channelId: channelId ?? undefined });

    const { order } = await this.query<{ order: Node | null }>(store, "order_ref", ORDER_REF_QUERY, { id: gid });
    if (!order) throw AppError.notFound("This order was not found in your Shopify store.");

    const findOwn = async () =>
      (await shopifyRepository.listOrderLinks(organizationId, profileId, store.id)).find((l) => l.shopifyOrderId === gid);

    const existing = await shopifyRepository.findOrderLinkByOrder(organizationId, store.id, gid);
    if (existing) {
      if (existing.customerId !== profileId) {
        throw new AppError("SHOPIFY_ORDER_ALREADY_LINKED", { details: { linkedContactId: existing.customerId }, expected: true });
      }
      const own = await findOwn();
      if (own) return { link: toOrderLinkInfo(own), created: false };
    }

    try {
      await shopifyRepository.createOrderLink({
        organizationId,
        storeId: store.id,
        customerId: profileId,
        channelId,
        shopifyOrderId: gid,
        orderName: typeof order.name === "string" ? order.name.slice(0, 100) : null,
        linkedById: user.id,
        source: ShopifyLinkSource.MANUAL,
      });
    } catch (err) {
      const appError = toAppError(err);
      if (appError.code === "DB_CONSTRAINT_VIOLATION") {
        throw new AppError("SHOPIFY_ORDER_ALREADY_LINKED", { cause: appError, expected: true });
      }
      throw appError;
    }

    const created = await findOwn();
    if (!created) throw new AppError("INTERNAL_ERROR", { message: "The order was linked but could not be read back." });
    log.info("Order linked to contact", { customerId, profileId, storeId: store.id, channelId, shopifyOrderId: gid, userId: user.id });
    return { link: toOrderLinkInfo(created), created: true };
  }

  async unlinkOrder(user: AuthUser, customerId: number, linkId: number): Promise<void> {
    const { profileId } = await this.requireProfile(user.organizationId, customerId);
    const link = (await shopifyRepository.listOrderLinks(user.organizationId, profileId)).find((l) => l.id === linkId);
    if (!link) throw AppError.notFound("This order isn't linked to the contact.");

    const store = await shopifyRepository.findActiveStore(user.organizationId, link.shopifyStoreId);
    if (!store || !canAccessStore(user, store)) throw AppError.notFound("This order isn't linked to the contact.");

    await shopifyRepository.deleteOrderLink(user.organizationId, profileId, linkId);
    log.info("Order unlinked from contact", { customerId, profileId, linkId, storeId: link.shopifyStoreId, userId: user.id });
  }
}

export const shopifyService = new ShopifyService();
