import { commerceRepository, type CommerceStoreWithUser } from "../db/repositories/commerce.repository";
import { CommercePlatform, CommerceStoreStatus, type CommerceCredentials, type CommerceStore } from "../db/schema";
import { AppError, toAppError } from "../errors";
import { createLogger } from "../logger";
import { decryptToken, encryptToken } from "../security/crypto";
import type { AuthUser } from "../security/auth";
import { assertCanAccessStore } from "../security/store-access";
import { buildAuthorizeUrl, createAuthState, verifyAuthState } from "../woocommerce/auth";
import { allowHttpStores, getWooCommerceConfig, getWooCommerceScope, isWooCommerceConfigured, normalizeStoreUrl } from "../woocommerce/config";
import { toCommerceChannelMapping, toWooStoreInfo } from "../woocommerce/mappers";
import { discoverStore, wooRequest, type WooAuthMode, type WooConnection, type WooResponse, type WooRestMode } from "../woocommerce/rest-client";
import type { WooCommerceStoreOverview, WooCommerceStoreWithChannels } from "../woocommerce/types";

const log = createLogger("WooCommerceService");
const PLATFORM = CommercePlatform.WOOCOMMERCE;

/** Body WooCommerce POSTs to callback_url once the merchant approves */
export interface WooKeyDelivery {
  key_id?: number | string;
  user_id?: string;
  consumer_key?: string;
  consumer_secret?: string;
  key_permissions?: string;
}

const KEY_PERMISSIONS = new Set(["read", "write", "read_write"]);

/**
 * WooCommerce connections. Unlike Shopify (one app, OAuth code → token) every WooCommerce store is its own server:
 * the merchant approves UnoCX on their store and WooCommerce generates a REST API key (consumer key + secret) that
 * it POSTs to our callback. The key is stored encrypted in commerce_stores.credentials.
 */
export class WooCommerceService {
  isConfigured(): boolean {
    return isWooCommerceConfigured();
  }

  async getConnection(organizationId: number) {
    const stores = await commerceRepository.findActiveStores(organizationId, PLATFORM);
    return { configured: this.isConfigured(), scope: getWooCommerceScope(), stores: stores.map(toWooStoreInfo) };
  }

  async listStores(organizationId: number): Promise<WooCommerceStoreWithChannels[]> {
    const [stores, mappings] = await Promise.all([
      commerceRepository.findActiveStores(organizationId, PLATFORM),
      commerceRepository.listChannelMappings(organizationId, { platform: PLATFORM }),
    ]);
    return stores.map((store) => ({
      ...toWooStoreInfo(store),
      channels: mappings.filter((m) => m.storeId === store.id).map(toCommerceChannelMapping),
    }));
  }

  async getStore(organizationId: number, storeId: number): Promise<WooCommerceStoreWithChannels> {
    const store = (await this.listStores(organizationId)).find((s) => s.id === storeId);
    if (!store) throw new AppError("WOOCOMMERCE_STORE_NOT_FOUND", { details: { storeId }, expected: true });
    return store;
  }

  /* ---------------- Connection lifecycle ---------------- */

  /**
   * Checks the address is a reachable WordPress site with WooCommerce's REST API, then returns the store's approval
   * URL. A store that is still connected can't be added again unless re-authorizing it.
   */
  async startInstall(user: AuthUser, rawStoreUrl: unknown, { reauthorize = false }: { reauthorize?: boolean } = {}) {
    getWooCommerceConfig(); // fail early with WOOCOMMERCE_NOT_CONFIGURED
    const typed = normalizeStoreUrl(rawStoreUrl);
    if (!typed) throw new AppError("WOOCOMMERCE_INVALID_STORE_URL", { expected: true, details: { field: "storeUrl" } });

    const discovery = await discoverStore(typed.storeUrl);
    if (!discovery) {
      throw new AppError("WOOCOMMERCE_STORE_UNREACHABLE", { details: { storeUrl: typed.storeUrl }, expected: true });
    }
    if (!discovery.hasWooCommerce) {
      throw new AppError("WOOCOMMERCE_STORE_UNREACHABLE", {
        message: `${discovery.name || typed.storeHost} is a WordPress site, but WooCommerce isn't active on it (or its REST API is disabled).`,
        details: { storeUrl: discovery.storeUrl, reason: "woocommerce_missing" },
        expected: true,
      });
    }
    // Where the site actually lives after redirects (http → https, apex → www)
    const target = normalizeStoreUrl(discovery.storeUrl) ?? typed;
    if (!target.isHttps && !allowHttpStores()) {
      throw new AppError("WOOCOMMERCE_INVALID_STORE_URL", {
        message: "Your store must use HTTPS so its API key can be sent securely.",
        details: { reason: "https_required" },
        expected: true,
      });
    }

    const existing = await commerceRepository.findStoreByHost(user.organizationId, PLATFORM, target.storeHost);
    if (existing && existing.status !== CommerceStoreStatus.DISCONNECTED && !reauthorize) {
      const label = existing.name ? `${existing.name} (${target.storeHost})` : target.storeHost;
      throw new AppError("CONFLICT", {
        message:
          existing.status === CommerceStoreStatus.REAUTH_REQUIRED
            ? `${label} is already connected and needs to be reconnected. Open the store and use Reconnect store.`
            : `${label} is already connected to this workspace. Disconnect it first to connect it again.`,
        details: { storeId: existing.id, reason: "store_already_connected" },
        expected: true,
      });
    }

    const state = createAuthState({
      organizationId: user.organizationId,
      userId: user.id,
      storeUrl: target.storeUrl,
      storeHost: target.storeHost,
      reauthorize: Boolean(existing && existing.status !== CommerceStoreStatus.DISCONNECTED),
      restMode: discovery.restMode,
    });
    log.info("WooCommerce authorization started", { organizationId: user.organizationId, storeHost: target.storeHost, restMode: discovery.restMode });
    return { authorizeUrl: buildAuthorizeUrl(target.storeUrl, state, discovery.restMode), storeUrl: target.storeUrl, storeName: discovery.name };
  }

  /**
   * callback_url: WooCommerce delivers the generated key. Trusted only through our signed state. Each authorization
   * can deliver one key (the state's nonce is remembered on the store). Throwing makes the route answer non-2xx,
   * and WooCommerce then deletes the key it just created.
   */
  async receiveKeys(body: WooKeyDelivery): Promise<CommerceStore> {
    const state = verifyAuthState(body?.user_id);
    const consumerKey = typeof body.consumer_key === "string" ? body.consumer_key.trim() : "";
    const consumerSecret = typeof body.consumer_secret === "string" ? body.consumer_secret.trim() : "";
    if (!/^ck_[A-Za-z0-9]+$/.test(consumerKey) || !/^cs_[A-Za-z0-9]+$/.test(consumerSecret)) {
      throw new AppError("WOOCOMMERCE_AUTH_FAILED", { details: { reason: "bad_key_format" }, expected: true });
    }
    const keyPermissions = KEY_PERMISSIONS.has(String(body.key_permissions)) ? String(body.key_permissions) : null;
    const keyId = Number(body.key_id);

    const existing = await commerceRepository.findStoreByHost(state.o, PLATFORM, state.h);
    if (existing?.settings?.authNonce === state.n) {
      throw new AppError("WOOCOMMERCE_AUTH_FAILED", { details: { reason: "state_already_used" }, expected: true });
    }

    const credentials: CommerceCredentials = { platform: "woocommerce", consumerKey, consumerSecret };
    const store = await commerceRepository.upsertStore({
      organizationId: state.o,
      platform: PLATFORM,
      storeUrl: state.s,
      storeHost: state.h,
      name: existing?.name ?? null,
      credentials: encryptToken(JSON.stringify(credentials)),
      settings: {
        ...(existing?.settings ?? {}),
        keyId: Number.isInteger(keyId) ? keyId : null,
        keyPermissions,
        restMode: state.m,
        authMode: state.s.startsWith("https://") ? "header" : "oauth1",
        authNonce: state.n,
      },
      scopes: keyPermissions,
      connectedById: state.u,
    });
    log.info(existing && existing.status !== CommerceStoreStatus.DISCONNECTED ? "WooCommerce key renewed" : "WooCommerce store connected", {
      organizationId: state.o,
      storeId: store.id,
      storeHost: state.h,
      keyId,
      keyPermissions,
    });
    return store;
  }

  /**
   * return_url: the merchant's browser comes back. Tells them how it went and verifies the delivered key against
   * the store (fills in the store name and currency). Never stores credentials.
   */
  async completeReturn(searchParams: URLSearchParams): Promise<{ store: CommerceStore; reconnected: boolean }> {
    const state = verifyAuthState(searchParams.get("user_id"), { allowExpired: true });
    if (searchParams.get("success") !== "1") {
      throw new AppError("WOOCOMMERCE_AUTH_FAILED", {
        message: "The connection was not approved on your WooCommerce store.",
        details: { reason: "denied" },
        expected: true,
      });
    }
    const store = await commerceRepository.findStoreByHost(state.o, PLATFORM, state.h);
    if (!store || store.settings?.authNonce !== state.n || !store.credentials) {
      throw new AppError("WOOCOMMERCE_AUTH_FAILED", {
        message:
          "Your store approved UnoCX, but the API key never reached UnoCX. Make sure your store can make outgoing HTTPS requests (some security plugins and hosts block them), then try again.",
        details: { reason: "key_not_received" },
        expected: true,
      });
    }
    try {
      const verified = await this.refreshStoreDetails(store);
      return { store: verified, reconnected: state.r === 1 };
    } catch (err) {
      const appError = toAppError(err);
      // A rejected key is a failed connection; a slow or flaky store isn't: the key arrived, verify it later
      if (appError.code === "WOOCOMMERCE_CREDENTIALS_REJECTED") throw appError;
      log.warn("WooCommerce key received but not verified yet", { storeId: store.id, code: appError.code });
      return { store, reconnected: state.r === 1 };
    }
  }

  /**
   * Checks the key against the store and refreshes the name and currency. A rejected key marks the store
   * reauth_required (and throws); an unreachable store is left as it is (and throws).
   */
  async refreshStoreDetails(store: CommerceStore): Promise<CommerceStore> {
    const conn = this.connectionFor(store);
    const [discovery, currency] = await Promise.all([
      discoverStore(store.storeUrl).catch(() => null),
      this.request<{ value?: string }>(store, conn, "woocommerce.currency", "GET", "settings/general/woocommerce_currency"),
    ]);
    const updated = await commerceRepository.updateStore(store.id, store.organizationId, {
      name: discovery?.name ?? store.name,
      currencyCode: typeof currency.value === "string" ? currency.value.slice(0, 10) : store.currencyCode,
      status: CommerceStoreStatus.CONNECTED,
      lastError: null,
      lastVerifiedAt: new Date(),
      settings: { ...(store.settings ?? {}), timezone: discovery?.timezone ?? store.settings?.timezone ?? null, authMode: conn.authMode },
    });
    return updated ?? store;
  }

  /** Re-checks a store from its page ("Test connection") */
  async verifyStore(user: AuthUser, storeId: number): Promise<WooCommerceStoreWithChannels> {
    const store = await commerceRepository.findActiveStore(user.organizationId, storeId, PLATFORM);
    if (!store) throw new AppError("WOOCOMMERCE_STORE_NOT_FOUND", { details: { storeId }, expected: true });
    assertCanAccessStore(user, { id: store.id, shopDomain: store.storeHost });
    await this.refreshStoreDetails(store);
    return this.getStore(user.organizationId, storeId);
  }

  /**
   * Deletes the key on our side. WooCommerce has no REST endpoint to revoke an API key, so the merchant is told to
   * revoke it in WooCommerce → Settings → Advanced → REST API. Channel mappings stay for a reconnect.
   */
  async disconnect(organizationId: number, storeId: number): Promise<{ keyId: number | null }> {
    const store = await commerceRepository.findActiveStore(organizationId, storeId, PLATFORM);
    if (!store) throw new AppError("WOOCOMMERCE_STORE_NOT_FOUND", { details: { storeId }, expected: true });
    await commerceRepository.markStoreDisconnected(store.id, organizationId);
    log.info("WooCommerce store disconnected", { organizationId, storeId, storeHost: store.storeHost });
    return { keyId: typeof store.settings?.keyId === "number" ? store.settings.keyId : null };
  }

  /* ---------------- Store data ---------------- */

  async getStoreOverview(user: AuthUser, storeId: number): Promise<WooCommerceStoreOverview> {
    const store = await this.requireStore(user, storeId);
    const conn = this.connectionFor(store);
    type Totals = { slug: string; total: number | string }[];
    const sum = (rows: Totals | null) => (rows ? rows.reduce((n, r) => n + (Number(r.total) || 0), 0) : null);
    const optional = <T>(p: Promise<T>) =>
      p.catch((err) => {
        const appError = toAppError(err);
        if (appError.code === "WOOCOMMERCE_CREDENTIALS_REJECTED") throw appError;
        return null;
      });

    const [discovery, products, orders, customers] = await Promise.all([
      discoverStore(store.storeUrl).catch(() => null),
      optional(this.request<Totals>(store, conn, "woocommerce.products_totals", "GET", "reports/products/totals")),
      optional(this.request<Totals>(store, conn, "woocommerce.orders_totals", "GET", "reports/orders/totals")),
      optional(this.request<Totals>(store, conn, "woocommerce.customers_totals", "GET", "reports/customers/totals")),
    ]);
    return {
      name: discovery?.name ?? store.name ?? store.storeHost,
      storeUrl: store.storeUrl,
      description: discovery?.description || null,
      currencyCode: store.currencyCode,
      timezone: discovery?.timezone ?? (typeof store.settings?.timezone === "string" ? store.settings.timezone : null),
      counts: { products: sum(products), orders: sum(orders), customers: sum(customers) },
    };
  }

  /* ---------------- Internals ---------------- */

  /** An active, usable store the member may access */
  private async requireStore(user: AuthUser, storeId: number): Promise<CommerceStoreWithUser> {
    const store = await commerceRepository.findActiveStore(user.organizationId, storeId, PLATFORM);
    if (!store) throw new AppError("WOOCOMMERCE_STORE_NOT_FOUND", { details: { storeId }, expected: true });
    assertCanAccessStore(user, { id: store.id, shopDomain: store.storeHost });
    if (store.status === CommerceStoreStatus.REAUTH_REQUIRED) {
      throw new AppError("WOOCOMMERCE_CREDENTIALS_REJECTED", { details: { storeId }, expected: true });
    }
    return store;
  }

  private connectionFor(store: CommerceStore): WooConnection {
    let credentials: CommerceCredentials | null = null;
    try {
      credentials = store.credentials ? (JSON.parse(decryptToken(store.credentials)) as CommerceCredentials) : null;
    } catch {
      credentials = null;
    }
    if (!credentials || credentials.platform !== "woocommerce") {
      throw new AppError("WOOCOMMERCE_NOT_CONNECTED", { details: { storeId: store.id }, expected: true });
    }
    return {
      storeUrl: store.storeUrl,
      consumerKey: credentials.consumerKey,
      consumerSecret: credentials.consumerSecret,
      restMode: (store.settings?.restMode as WooRestMode) ?? "wp-json",
      authMode: (store.settings?.authMode as WooAuthMode) ?? undefined,
    };
  }

  /* ---------------- For other services (inbox) ---------------- */

  /** A connected store of the workspace the member may use (not one waiting for re-authorization) */
  async requireUsableStore(user: AuthUser, storeId: number): Promise<CommerceStoreWithUser> {
    return this.requireStore(user, storeId);
  }

  /** GET on the store's wc/v3 API with the usual bookkeeping; returns headers too (x-wp-total, x-wp-totalpages) */
  async getFromStore<T>(store: CommerceStore, operation: string, path: string, params?: Record<string, string | number | undefined>): Promise<WooResponse<T>> {
    return this.requestFull<T>(store, this.connectionFor(store), operation, "GET", path, { params });
  }

  /** wooRequest + bookkeeping: remembers the auth mode that works, flags rejected keys */
  private async request<T>(
    store: CommerceStore,
    conn: WooConnection,
    operation: string,
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    options: { params?: Record<string, string | number | undefined>; data?: unknown } = {}
  ): Promise<T> {
    return (await this.requestFull<T>(store, conn, operation, method, path, options)).data;
  }

  private async requestFull<T>(
    store: CommerceStore,
    conn: WooConnection,
    operation: string,
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    options: { params?: Record<string, string | number | undefined>; data?: unknown } = {}
  ): Promise<WooResponse<T>> {
    try {
      const res = await wooRequest<T>(conn, operation, method, path, options);
      if (res.authMode !== conn.authMode) {
        conn.authMode = res.authMode;
        await commerceRepository.mergeSettings(store, { authMode: res.authMode }).catch(() => undefined);
      }
      return res;
    } catch (err) {
      const appError = toAppError(err);
      if (appError.code === "WOOCOMMERCE_CREDENTIALS_REJECTED") {
        await commerceRepository
          .updateStore(store.id, store.organizationId, {
            status: CommerceStoreStatus.REAUTH_REQUIRED,
            lastError: (appError.provider?.message || "The store rejected UnoCX's API key.").slice(0, 500),
          })
          .catch((e) => log.warn("Could not flag WooCommerce store for re-authorization", { err: e, storeId: store.id }));
      }
      throw appError;
    }
  }
}

export const wooCommerceService = new WooCommerceService();
