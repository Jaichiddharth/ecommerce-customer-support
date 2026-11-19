import { commerceRepository, type CommerceStoreWithUser } from "../db/repositories/commerce.repository";
import { customerRepository } from "../db/repositories/customer.repository";
import type { SharedWooProduct } from "../db/schema";
import { AppError, toAppError } from "../errors";
import { createLogger } from "../logger";
import type { AuthUser } from "../security/auth";
import { buildProductMessageText } from "../shopify/product-message";
import type {
  WooContactOrders,
  WooOrderSummary,
  WooProductDetail,
  WooProductPage,
  WooProductSummary,
  WooVariation,
} from "../woocommerce/types";
import { whatsAppService } from "./channels/whatsapp.service";
import { customerService } from "./customer.service";
import { wooCommerceService } from "./woocommerce.service";

const log = createLogger("WooCommerceInbox");

const PAGE_SIZE = 20;
const MAX_VARIATIONS = 100;
const MAX_ORDERS = 20;

/** What an inbox call is about: the store picked in the switcher, and the conversation it's for */
export interface WooInboxScope {
  storeId: number;
  channelId?: number;
  customerId?: number;
}

/* ---------------- Raw wc/v3 shapes (only the fields used) ---------------- */

type WooImage = { src?: string; alt?: string };
type RawProduct = {
  id: number;
  name: string;
  type: string;
  status?: string;
  permalink?: string;
  description?: string;
  short_description?: string;
  sku?: string;
  price?: string;
  regular_price?: string;
  stock_status?: string;
  purchasable?: boolean;
  images?: WooImage[];
  attributes?: { name: string; options?: string[]; variation?: boolean }[];
  variations?: number[];
};
type RawVariation = {
  id: number;
  sku?: string;
  price?: string;
  regular_price?: string;
  stock_status?: string;
  status?: string;
  image?: WooImage | null;
  attributes?: { name: string; option: string }[];
  permalink?: string;
};
type RawOrder = {
  id: number;
  number?: string;
  status: string;
  currency?: string;
  total?: string;
  date_created_gmt?: string | null;
  date_created?: string | null;
  billing?: { email?: string; phone?: string };
  line_items?: { name: string; quantity: number }[];
};

/* ---------------- Helpers ---------------- */

const isAvailable = (stockStatus?: string) => stockStatus !== "outofstock";
const blankToNull = (v?: string | null) => (v && v.trim() ? v.trim() : null);
const digitsOf = (v?: string | null) => (v || "").replace(/\D/g, "");

/** WooCommerce descriptions are HTML: keep line breaks, drop tags, decode the common entities */
function htmlToText(html?: string): string | null {
  if (!html) return null;
  const text = html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*(p|div|li|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&#8211;|&ndash;/g, "–")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text || null;
}

/** Same phone number when the last 10 digits agree (country codes and formatting differ between systems) */
function samePhone(a: string, b: string): boolean {
  const x = digitsOf(a);
  const y = digitsOf(b);
  if (x.length < 7 || y.length < 7) return false;
  return x.slice(-10) === y.slice(-10);
}

/**
 * The inbox's WooCommerce features: product search, product details, sharing a product in the conversation and the
 * contact's orders. Every call names the store picked in the inbox's switcher, and that store has to be linked to
 * the conversation's number (WOOCOMMERCE_STORE_CHANNEL_MISMATCH otherwise), so a number only ever shows its own stores.
 */
export class WooCommerceInboxService {
  /** The picked store, checked against the conversation's number and the member's store access */
  async resolveStore(user: AuthUser, scope: WooInboxScope): Promise<CommerceStoreWithUser> {
    let channelId = scope.channelId;
    if (channelId === undefined && scope.customerId !== undefined) {
      const contact = await customerService.requireVisible(scope.customerId, user.organizationId);
      channelId = contact.channelId ?? undefined;
    }
    const store = await wooCommerceService.requireUsableStore(user, scope.storeId);
    if (channelId !== undefined) {
      const linked = await commerceRepository.findStoresForChannel(user.organizationId, channelId, "woocommerce");
      if (!linked.some((s) => s.id === store.id)) {
        throw new AppError("WOOCOMMERCE_STORE_CHANNEL_MISMATCH", { details: { channelId, storeId: store.id }, expected: true });
      }
    }
    return store;
  }

  /* ---------------- Products ---------------- */

  /** Published products by name or SKU, newest first when there's no search term; 20 per page */
  async searchProducts(user: AuthUser, scope: WooInboxScope, term: string, page = 1): Promise<WooProductPage> {
    const store = await this.resolveStore(user, scope);
    const q = term.trim().slice(0, 100);
    const res = await wooCommerceService.getFromStore<RawProduct[]>(store, "woocommerce.products_search", "products", {
      search: q || undefined,
      status: "publish",
      per_page: PAGE_SIZE,
      page,
      orderby: q ? "relevance" : "date",
      order: "desc",
    });
    const totalPages = Number(res.headers["x-wp-totalpages"]) || 1;
    const currency = store.currencyCode || "USD";
    return {
      items: (res.data ?? []).map((p): WooProductSummary => ({
        id: p.id,
        name: p.name,
        imageUrl: p.images?.[0]?.src || null,
        price: p.price ?? "",
        currencyCode: currency,
        available: isAvailable(p.stock_status),
        type: p.type,
        variationsCount: p.variations?.length ?? 0,
        sku: blankToNull(p.sku),
      })),
      page,
      hasNextPage: page < totalPages,
    };
  }

  async getProduct(user: AuthUser, scope: WooInboxScope, productId: number): Promise<WooProductDetail> {
    const store = await this.resolveStore(user, scope);
    return this.loadProduct(store, productId);
  }

  private async loadProduct(store: CommerceStoreWithUser, productId: number): Promise<WooProductDetail> {
    let product: RawProduct;
    try {
      product = (await wooCommerceService.getFromStore<RawProduct>(store, "woocommerce.product", `products/${productId}`)).data;
    } catch (err) {
      const appError = toAppError(err);
      if (appError.code === "WOOCOMMERCE_API_ERROR" && (appError.provider?.httpStatus === 404 || appError.provider?.httpStatus === 400)) {
        throw new AppError("WOOCOMMERCE_PRODUCT_NOT_FOUND", { cause: err, details: { productId }, expected: true });
      }
      throw appError;
    }
    if (!product || product.status === "trash") throw new AppError("WOOCOMMERCE_PRODUCT_NOT_FOUND", { details: { productId }, expected: true });

    let variations: WooVariation[] = [];
    const variationCount = product.variations?.length ?? 0;
    if (product.type === "variable" && variationCount > 0) {
      const res = await wooCommerceService.getFromStore<RawVariation[]>(store, "woocommerce.product_variations", `products/${productId}/variations`, {
        per_page: MAX_VARIATIONS,
      });
      variations = (res.data ?? [])
        .filter((v) => v.status === undefined || v.status === "publish")
        .map((v) => ({
          id: v.id,
          price: v.price ?? "",
          regularPrice: blankToNull(v.regular_price),
          sku: blankToNull(v.sku),
          available: isAvailable(v.stock_status),
          imageUrl: v.image?.src || null,
          attributes: (v.attributes ?? []).map((a) => ({ name: a.name, option: a.option })),
        }));
    }

    return {
      id: product.id,
      name: product.name,
      type: product.type,
      description: htmlToText(product.short_description) || htmlToText(product.description),
      permalink: blankToNull(product.permalink),
      sku: blankToNull(product.sku),
      price: product.price ?? "",
      regularPrice: blankToNull(product.regular_price),
      currencyCode: store.currencyCode || "USD",
      available: isAvailable(product.stock_status),
      images: (product.images ?? []).filter((i) => i.src).map((i) => ({ url: i.src as string, altText: blankToNull(i.alt) })),
      attributes: (product.attributes ?? [])
        .filter((a) => product.type !== "variable" || a.variation)
        .map((a) => ({ name: a.name, options: a.options ?? [] })),
      variations,
      hasMoreVariations: variationCount > MAX_VARIATIONS,
    };
  }

  /* ---------------- Sharing ---------------- */

  /**
   * Re-reads the product (and variation) from the store and sends it through the normal WhatsApp send path:
   * the product image with the text as caption, or the text alone when it has no image.
   */
  async shareProduct(
    user: AuthUser,
    params: { customerId: number; channelId?: number; storeId: number; productId: number; variationId?: number; caption?: string }
  ) {
    const customer = await customerService.requireVisible(params.customerId, user.organizationId);
    if (!customer.phone) {
      throw AppError.validation(`"${customer.name}" has no phone number, so the product can't be sent on WhatsApp.`, "customerId");
    }
    const channelId = params.channelId ?? customer.channelId ?? undefined;
    const store = await this.resolveStore(user, { storeId: params.storeId, channelId });
    const product = await this.loadProduct(store, params.productId);

    let variation: WooVariation | null = null;
    if (product.type === "variable") {
      if (!params.variationId) throw AppError.validation("Choose a product option to share.", "variationId");
      variation = product.variations.find((v) => v.id === params.variationId) ?? null;
      if (!variation) throw AppError.validation("The selected option doesn't belong to this product.", "variationId");
    }

    const shared: SharedWooProduct = {
      storeId: store.id,
      productId: product.id,
      variationId: variation?.id ?? null,
      title: product.name,
      options: (variation?.attributes ?? []).map((a) => ({ name: a.name, value: a.option })),
      sku: variation?.sku ?? product.sku,
      price: (variation?.price || product.price || "0").toString(),
      currencyCode: product.currencyCode,
      available: variation ? variation.available : product.available,
      imageUrl: variation?.imageUrl || product.images[0]?.url || null,
      productUrl: product.permalink,
    };

    const generated = buildProductMessageText({ ...shared, variantTitle: null });
    const text = params.caption?.trim() ? params.caption.trim().slice(0, 1024) : generated;
    // WhatsApp downloads the image itself, so it has to be a public https URL
    const image = shared.imageUrl?.startsWith("https://") ? shared.imageUrl : null;

    const result = await whatsAppService.sendMessage({
      organizationId: user.organizationId,
      channelId,
      senderId: user.id,
      senderName: user.name,
      customerId: customer.id,
      to: customer.phone,
      text,
      ...(image ? { mediaLink: image, mediaType: "image" as const } : { type: "text" as const }),
      metadata: { wooProduct: shared },
    });

    log.info("WooCommerce product shared", { customerId: customer.id, storeId: store.id, productId: shared.productId, variationId: shared.variationId });
    return { ...result, product: shared };
  }

  /* ---------------- Orders ---------------- */

  /**
   * The contact's orders in the store, newest first: orders whose billing email or phone number matches any of the
   * contact profile's identities (WhatsApp, Instagram, ... rows linked into one profile). WooCommerce's order
   * search is fuzzy, so results are re-checked here and only exact matches are kept.
   */
  async getContactOrders(user: AuthUser, customerId: number, storeId: number): Promise<WooContactOrders> {
    const contact = await customerService.requireVisible(customerId, user.organizationId);
    const store = await this.resolveStore(user, { storeId, channelId: contact.channelId ?? undefined });

    const members = await customerRepository.listProfileMembers(user.organizationId, customerService.profileIdOf(contact));
    const emails = [...new Set(members.map((m) => m.email?.trim().toLowerCase()).filter((e): e is string => Boolean(e)))];
    const phones = [...new Set(members.map((m) => digitsOf(m.phone)).filter((p) => p.length >= 7))];

    const ref = { id: store.id, name: store.name, storeHost: store.storeHost };
    if (emails.length === 0 && phones.length === 0) return { store: ref, matchedBy: null, orders: [] };

    // One search per identity (a handful at most); the last 10 digits find numbers stored with or without a country code
    const terms = [...emails.slice(0, 3), ...phones.slice(0, 3).map((p) => p.slice(-10))];
    const pages = await Promise.all(
      terms.map((search) =>
        wooCommerceService
          .getFromStore<RawOrder[]>(store, "woocommerce.orders_search", "orders", { search, per_page: MAX_ORDERS, orderby: "date", order: "desc" })
          .then((r) => r.data ?? [])
      )
    );

    const byId = new Map<number, RawOrder>();
    let matchedEmail = false;
    let matchedPhone = false;
    for (const order of pages.flat()) {
      const email = order.billing?.email?.trim().toLowerCase();
      const emailHit = Boolean(email && emails.includes(email));
      const phoneHit = Boolean(order.billing?.phone && phones.some((p) => samePhone(p, order.billing!.phone!)));
      if (!emailHit && !phoneHit) continue;
      matchedEmail ||= emailHit;
      matchedPhone ||= phoneHit;
      byId.set(order.id, order);
    }

    const base = store.storeUrl.replace(/\/+$/, "");
    const orders: WooOrderSummary[] = [...byId.values()]
      .map((o) => ({
        id: o.id,
        number: o.number || String(o.id),
        status: o.status,
        total: o.total ?? "0",
        currencyCode: o.currency || store.currencyCode || "USD",
        createdAt: o.date_created_gmt ? `${o.date_created_gmt}Z` : o.date_created ?? null,
        items: (o.line_items ?? []).map((i) => ({ name: i.name, quantity: i.quantity })),
        adminUrl: `${base}/wp-admin/post.php?post=${o.id}&action=edit`,
      }))
      .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
      .slice(0, MAX_ORDERS);

    return {
      store: ref,
      matchedBy: matchedEmail && matchedPhone ? "email_or_phone" : matchedEmail ? "email" : matchedPhone ? "phone" : null,
      orders,
    };
  }
}

export const wooCommerceInboxService = new WooCommerceInboxService();
