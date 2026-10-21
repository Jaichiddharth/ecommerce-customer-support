import { customerRepository } from "../db/repositories/customer.repository";
import { shopifyRepository, pickPrimaryStore, type ShopifyStoreWithUser } from "../db/repositories/shopify.repository";
import { ShopifyStoreStatus, type ShopifyStore, type SharedShopifyProduct } from "../db/schema";
import { AppError, toAppError } from "../errors";
import { createLogger } from "../logger";
import { encryptToken, decryptToken } from "../security/crypto";
import type { AuthUser } from "../security/auth";
import { shopifyGraphql, revokeShopifyAccess } from "../shopify/admin-client";
import { getShopifyConfig, isValidShopDomain, shopifyLegacyId, toShopifyGid, SHOPIFY_REQUIRED_SCOPES } from "../shopify/config";
import { buildAuthorizeUrl, exchangeCodeForToken, refreshAccessToken, verifyCallbackHmac, verifyState } from "../shopify/oauth";
import { buildProductMessageText } from "../shopify/product-message";
import type {
  ShopifyCustomerSummary,
  ShopifyMoney,
  ShopifyOrder,
  ShopifyPage,
  ShopifyProductDetail,
  ShopifyProductSummary,
  ShopifyStoreInfo,
  ShopifyVariant,
  ShopifyContactOrdersResponse,
} from "../shopify/types";
import { whatsAppService } from "./channels/whatsapp.service";

const log = createLogger("ShopifyService");

const PRODUCTS_PAGE_SIZE = 20;
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
      options { name position optionValues { name } }
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
  id displayName createdAt numberOfOrders
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

const CUSTOMER_ORDERS_QUERY = /* GraphQL */ `
  query CustomerOrders($id: ID!, $first: Int!, $after: String) {
    customer(id: $id) {
      ${CUSTOMER_FIELDS}
      orders(first: $first, after: $after, sortKey: CREATED_AT, reverse: true) {
        nodes {
          id name createdAt cancelledAt closed displayFinancialStatus displayFulfillmentStatus
          totalPriceSet { shopMoney { amount currencyCode } }
          lineItems(first: 20) {
            nodes { id title variantTitle quantity sku image { url(transform: { maxWidth: 120 }) } }
            pageInfo { hasNextPage }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
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

/** Shopify search syntax value, quoted so spaces, colons and parentheses can't change the query */
const quoteSearchValue = (value: string) => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

function buildProductSearchQuery(term: string): string {
  const words = term
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}_.-]/gu, ""))
    .filter(Boolean)
    .slice(0, 6);
  const quoted = quoteSearchValue(term);
  const titleClause = words.length > 0 ? `(${words.map((w) => `title:${w}*`).join(" AND ")}) OR ` : "";
  // Drafts and archived products can't be bought, so they're never offered for sharing
  return `status:active AND (${titleClause}sku:${quoted} OR barcode:${quoted})`;
}

function hasScope(granted: string[], required: string): boolean {
  // write_x implies read_x
  return granted.includes(required) || granted.includes(required.replace(/^read_/, "write_"));
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

  toStoreInfo(store: ShopifyStoreWithUser): ShopifyStoreInfo {
    const scopes = (store.scopes || "").split(",").map((s) => s.trim()).filter(Boolean);
    return {
      id: store.id,
      shopDomain: store.shopDomain,
      name: store.name,
      email: store.email,
      currencyCode: store.currencyCode,
      primaryDomainUrl: store.primaryDomainUrl,
      status: store.status,
      scopes,
      missingScopes: SHOPIFY_REQUIRED_SCOPES.filter((s) => !hasScope(scopes, s)),
      lastError: store.lastError,
      connectedAt: store.connectedAt.toISOString(),
      connectedByName: store.connectedByName,
    };
  }

  async getConnection(organizationId: number) {
    const stores = await shopifyRepository.findActiveStores(organizationId);
    const primary = pickPrimaryStore(stores);
    return {
      configured: this.isConfigured(),
      store: primary ? this.toStoreInfo(primary) : null,
      stores: stores.map((store) => this.toStoreInfo(store)),
    };
  }

  /* ---------------- Connection lifecycle ---------------- */

  /** Connects another store, or re-authorizes one already connected (expired token, missing scopes) */
  async startInstall(user: AuthUser, shop: string) {
    return buildAuthorizeUrl({ organizationId: user.organizationId, userId: user.id, shop });
  }

  /** OAuth callback: every check has to pass before a token is requested or stored. */
  async completeInstall(searchParams: URLSearchParams, nonceCookie: string | undefined): Promise<ShopifyStore> {
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
    log.info("Shopify store connected", { organizationId: state.o, shop, storeId: store.id });
    return store;
  }

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

    await shopifyRepository.updateStore(store.id, organizationId, {
      status: ShopifyStoreStatus.DISCONNECTED,
      accessToken: null,
      refreshToken: null,
      tokenExpiresAt: null,
      lastError: null,
    });
    log.info("Shopify store disconnected", { organizationId, shop: store.shopDomain, storeId: store.id });
  }

  /* ---------------- Authenticated Admin API calls ---------------- */

  private async requireStore(organizationId: number): Promise<ShopifyStoreWithUser> {
    const store = await shopifyRepository.findActiveStore(organizationId);
    if (!store) throw new AppError("SHOPIFY_NOT_CONNECTED", { expected: true });
    if (store.status === ShopifyStoreStatus.REAUTH_REQUIRED) throw new AppError("SHOPIFY_AUTH_FAILED", { expected: true });
    return store;
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

  /* ---------------- Products ---------------- */

  async searchProducts(organizationId: number, term: string, after?: string | null): Promise<ShopifyPage<ShopifyProductSummary>> {
    const store = await this.requireStore(organizationId);
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

  async getProduct(organizationId: number, productId: string): Promise<ShopifyProductDetail> {
    const gid = toShopifyGid("Product", productId);
    if (!gid) throw AppError.validation("Invalid product id.", "productId");

    const store = await this.requireStore(organizationId);
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
        .map((o: Node) => ({ name: o.name, values: (o.optionValues ?? []).map((v: Node) => v.name) })),
      variants: (p.variants?.nodes ?? []).map(mapVariant),
      hasMoreVariants: Boolean(p.variants?.pageInfo?.hasNextPage),
      productUrl: p.onlineStoreUrl ?? null,
    };
  }

  /** Loads a variant straight from Shopify, so what gets shared is always current and real */
  async getVariant(organizationId: number, variantId: string) {
    const gid = toShopifyGid("ProductVariant", variantId);
    if (!gid) throw AppError.validation("Invalid variant id.", "variantId");

    const store = await this.requireStore(organizationId);
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

  async shareProduct(
    user: AuthUser,
    params: { customerId: number; channelId?: number; productId?: string; variantId: string; caption?: string }
  ) {
    const customer = await customerRepository.findById(params.customerId, user.organizationId);
    if (!customer) throw AppError.notFound("Customer not found.");
    if (!customer.phone) {
      throw AppError.validation(`"${customer.name}" has no phone number, so the product can't be sent on WhatsApp.`, "customerId");
    }

    const { productStatus, shared } = await this.getVariant(user.organizationId, params.variantId);
    if (params.productId && toShopifyGid("Product", params.productId) !== shared.productId) {
      throw AppError.validation("The selected option doesn't belong to this product.", "variantId");
    }
    if (productStatus !== "ACTIVE") {
      throw AppError.validation("This product isn't active in your Shopify store, so it can't be shared.", "productId");
    }

    const text = params.caption?.trim() ? params.caption.trim().slice(0, 1024) : buildProductMessageText(shared);
    const result = await whatsAppService.sendMessage({
      organizationId: user.organizationId,
      channelId: params.channelId ?? customer.channelId ?? undefined,
      senderId: user.id,
      senderName: user.name,
      customerId: customer.id,
      to: customer.phone,
      text,
      ...(shared.imageUrl ? { mediaLink: shared.imageUrl, mediaType: "image" as const } : { type: "text" as const }),
      metadata: { shopifyProduct: shared },
    });

    log.info("Shopify product shared", { customerId: customer.id, productId: shared.productId, variantId: shared.variantId });
    return { ...result, product: shared };
  }

  /* ---------------- Customers & links ---------------- */

  async searchCustomers(organizationId: number, params: { email?: string; phone?: string }): Promise<ShopifyCustomerSummary[]> {
    const email = params.email?.trim().toLowerCase();
    const phoneDigits = params.phone?.replace(/\D/g, "");

    const clauses: string[] = [];
    if (email) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw AppError.validation("Enter a valid email address.", "email");
      clauses.push(`email:${quoteSearchValue(email)}`);
    }
    if (phoneDigits) {
      if (phoneDigits.length < 6) throw AppError.validation("Enter a phone number with its country code.", "phone");
      clauses.push(`phone:${quoteSearchValue(`+${phoneDigits}`)}`);
    }
    if (clauses.length === 0) throw AppError.validation("Enter an email address or phone number to search.", "email");

    const store = await this.requireStore(organizationId);
    const data = await this.query<{ customers: { nodes: Node[] } }>(store, "search_customers", SEARCH_CUSTOMERS_QUERY, {
      query: clauses.join(" OR "),
    });
    return data.customers.nodes.map(mapCustomer);
  }

  private async requireContact(organizationId: number, customerId: number) {
    const customer = await customerRepository.findById(customerId, organizationId);
    if (!customer) throw AppError.notFound("Customer not found.");
    return customer;
  }

  async linkCustomer(user: AuthUser, customerId: number, shopifyCustomerId: string) {
    const gid = toShopifyGid("Customer", shopifyCustomerId);
    if (!gid) throw AppError.validation("Invalid Shopify customer id.", "shopifyCustomerId");

    await this.requireContact(user.organizationId, customerId);
    const store = await this.requireStore(user.organizationId);

    // Never trust the id from the browser: it has to be a real customer of this store
    const { customer } = await this.query<{ customer: Node | null }>(store, "customer_by_id", CUSTOMER_QUERY, { id: gid });
    if (!customer) throw AppError.notFound("This customer was not found in your Shopify store.");

    const other = await shopifyRepository.findLinkByShopifyCustomer(user.organizationId, store.id, gid);
    if (other && other.customerId !== customerId) {
      throw new AppError("SHOPIFY_CUSTOMER_ALREADY_LINKED", { details: { linkedContactId: other.customerId }, expected: true });
    }

    try {
      await shopifyRepository.upsertLink({
        organizationId: user.organizationId,
        storeId: store.id,
        customerId,
        shopifyCustomerId: gid,
        linkedById: user.id,
      });
    } catch (err) {
      const appError = toAppError(err);
      if (appError.code === "DB_CONSTRAINT_VIOLATION") {
        throw new AppError("SHOPIFY_CUSTOMER_ALREADY_LINKED", { cause: appError, expected: true });
      }
      throw appError;
    }

    log.info("Contact linked to Shopify customer", { customerId, storeId: store.id, shopifyCustomerId: gid });
    return mapCustomer(customer);
  }

  async unlinkCustomer(organizationId: number, customerId: number): Promise<void> {
    await this.requireContact(organizationId, customerId);
    const store = await shopifyRepository.findActiveStore(organizationId);
    if (!store) throw new AppError("SHOPIFY_NOT_CONNECTED", { expected: true });

    const removed = await shopifyRepository.deleteLink(organizationId, store.id, customerId);
    if (!removed) throw AppError.notFound("This contact isn't linked to a Shopify customer.");
    log.info("Contact unlinked from Shopify customer", { customerId, storeId: store.id });
  }

  /** Link + Shopify customer + one page of their orders, for the contact panel */
  async getContactOrders(
    organizationId: number,
    customerId: number,
    after?: string | null
  ): Promise<Omit<ShopifyContactOrdersResponse, "success">> {
    await this.requireContact(organizationId, customerId);
    const emptyOrders: ShopifyPage<ShopifyOrder> = { items: [], hasNextPage: false, endCursor: null };

    const store = await shopifyRepository.findActiveStore(organizationId);
    if (!store) return { connected: false, link: null, shopifyCustomer: null, orders: emptyOrders };
    if (store.status === ShopifyStoreStatus.REAUTH_REQUIRED) throw new AppError("SHOPIFY_AUTH_FAILED", { expected: true });

    const link = await shopifyRepository.findLink(organizationId, store.id, customerId);
    if (!link) return { connected: true, link: null, shopifyCustomer: null, orders: emptyOrders };

    const linkInfo = {
      id: link.id,
      shopifyCustomerId: link.shopifyCustomerId,
      linkedAt: link.createdAt.toISOString(),
      linkedByName: link.linkedByName,
    };

    const { customer } = await this.query<{ customer: Node | null }>(store, "customer_orders", CUSTOMER_ORDERS_QUERY, {
      id: link.shopifyCustomerId,
      first: ORDERS_PAGE_SIZE,
      after: after || null,
    });
    // Deleted or merged in Shopify: keep the link so the agent sees it and can re-link
    if (!customer) return { connected: true, link: linkInfo, shopifyCustomer: null, orders: emptyOrders };

    return {
      connected: true,
      link: linkInfo,
      shopifyCustomer: mapCustomer(customer),
      orders: {
        items: (customer.orders?.nodes ?? []).map((o: Node) => mapOrder(o, store.shopDomain)),
        hasNextPage: Boolean(customer.orders?.pageInfo?.hasNextPage),
        endCursor: customer.orders?.pageInfo?.endCursor ?? null,
      },
    };
  }
}

export const shopifyService = new ShopifyService();
