import crypto from "crypto";
import axios, { type AxiosResponse, isAxiosError } from "axios";
import { AppError } from "../errors";
import { createLogger } from "../logger";
import { redactUrl } from "../logger/redact";
import { WOOCOMMERCE_API_NAMESPACE } from "./config";
import { assertPublicStoreHost } from "./url-safety";

/**
 * Minimal WooCommerce REST API (wc/v3) client.
 *  - Reaches the API through /wp-json/ (pretty permalinks) or /?rest_route= (plain permalinks).
 *  - Authenticates over HTTPS with HTTP Basic (consumer key/secret); some hosts strip the Authorization header,
 *    so a 401 is retried once with the key in the query string (WooCommerce's documented fallback). Plain-HTTP
 *    stores need OAuth 1.0a one-legged signatures, signed the way WooCommerce verifies them.
 *  - Never follows redirects with credentials attached, and only talks to public hosts (url-safety).
 */

const log = createLogger("WooCommerceApi");
const TIMEOUT_MS = 20_000;
const USER_AGENT = "UnoCX-WooCommerce/1.0";

export type WooRestMode = "wp-json" | "rest-route";
export type WooAuthMode = "header" | "query" | "oauth1";

export interface WooConnection {
  storeUrl: string;
  consumerKey: string;
  consumerSecret: string;
  restMode: WooRestMode;
  authMode?: WooAuthMode;
}

export interface WooResponse<T> {
  data: T;
  headers: Record<string, string>;
  /** The auth mode that worked; persist it when it differs from the one passed in */
  authMode: WooAuthMode;
}

/* ------------------------------------------------------------------ */
/* Discovery (no credentials)                                          */
/* ------------------------------------------------------------------ */

export interface WooStoreDiscovery {
  storeUrl: string;
  restMode: WooRestMode;
  name: string | null;
  description: string | null;
  homeUrl: string | null;
  timezone: string | null;
  hasWooCommerce: boolean;
}

const looksLikeWpIndex = (data: unknown): data is { namespaces: string[]; name?: string; description?: string; home?: string; url?: string; timezone_string?: string } =>
  Boolean(data && typeof data === "object" && Array.isArray((data as { namespaces?: unknown }).namespaces));

/** GET without credentials, following at most 3 redirects and checking every hop is a public host */
async function publicGet(url: string): Promise<{ response: AxiosResponse; finalUrl: string } | null> {
  let current = url;
  for (let hop = 0; hop < 4; hop++) {
    await assertPublicStoreHost(current);
    let response: AxiosResponse;
    try {
      response = await axios.get(current, {
        timeout: TIMEOUT_MS,
        maxRedirects: 0,
        validateStatus: () => true,
        headers: { Accept: "application/json", "User-Agent": USER_AGENT },
        responseType: "json",
      });
    } catch (err) {
      log.warn("WooCommerce store discovery request failed", { url: redactUrl(current), code: isAxiosError(err) ? err.code : undefined });
      return null;
    }
    if (response.status >= 300 && response.status < 400 && response.headers.location) {
      current = new URL(String(response.headers.location), current).toString();
      continue;
    }
    return { response, finalUrl: current };
  }
  return null;
}

/**
 * Finds the WordPress REST API of a store and whether WooCommerce is active on it. When the site redirects
 * (http → https, apex → www), the returned storeUrl is where it actually lives.
 */
export async function discoverStore(storeUrl: string): Promise<WooStoreDiscovery | null> {
  const attempts: { mode: WooRestMode; url: string; base: (finalUrl: string) => string }[] = [
    { mode: "wp-json", url: `${storeUrl}/wp-json/`, base: (u) => u.replace(/\/wp-json\/?(\?.*)?$/, "") },
    { mode: "rest-route", url: `${storeUrl}/?rest_route=/`, base: (u) => u.replace(/\/?\?.*$/, "") },
  ];
  for (const attempt of attempts) {
    const result = await publicGet(attempt.url);
    if (!result || result.response.status !== 200 || !looksLikeWpIndex(result.response.data)) continue;
    const data = result.response.data;
    const finalBase = attempt.base(result.finalUrl).replace(/\/+$/, "");
    return {
      storeUrl: finalBase || storeUrl,
      restMode: attempt.mode,
      name: typeof data.name === "string" && data.name.trim() ? decodeEntities(data.name.trim()) : null,
      description: typeof data.description === "string" ? decodeEntities(data.description) : null,
      homeUrl: typeof data.home === "string" ? data.home : typeof data.url === "string" ? data.url : null,
      timezone: typeof data.timezone_string === "string" && data.timezone_string ? data.timezone_string : null,
      hasWooCommerce: data.namespaces.includes(WOOCOMMERCE_API_NAMESPACE),
    };
  }
  return null;
}

/** WordPress returns site names HTML-escaped ("Tom &amp; Jerry") */
function decodeEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

/* ------------------------------------------------------------------ */
/* Authenticated requests                                              */
/* ------------------------------------------------------------------ */

/** PHP rawurlencode(): RFC 3986, which encodeURIComponent almost is */
const rawUrlEncode = (value: string) => encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/**
 * OAuth 1.0a one-legged signature as WooCommerce checks it (WC_REST_Authentication::check_oauth_signature): params
 * sorted by key, each key/value rawurlencoded once, joined as k%3Dv with %26, signed with "<consumer_secret>&".
 */
export function signOAuth1(method: string, baseUrl: string, params: Record<string, string>, consumerKey: string, consumerSecret: string): Record<string, string> {
  const oauth: Record<string, string> = {
    ...params,
    oauth_consumer_key: consumerKey,
    oauth_nonce: crypto.randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA256",
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
  };
  const query = Object.keys(oauth)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((key) => `${rawUrlEncode(key)}%3D${rawUrlEncode(oauth[key])}`)
    .join("%26");
  const stringToSign = `${method.toUpperCase()}&${rawUrlEncode(baseUrl)}&${query}`;
  const signature = crypto.createHmac("sha256", `${consumerSecret}&`).update(stringToSign).digest("base64");
  return { ...oauth, oauth_signature: signature };
}

function endpoint(conn: WooConnection, path: string): { url: string; params: Record<string, string> } {
  const clean = path.replace(/^\/+/, "");
  if (conn.restMode === "rest-route") {
    return { url: `${conn.storeUrl}/`, params: { rest_route: `/${WOOCOMMERCE_API_NAMESPACE}/${clean}` } };
  }
  return { url: `${conn.storeUrl}/wp-json/${WOOCOMMERCE_API_NAMESPACE}/${clean}`, params: {} };
}

function toWooError(err: unknown, operation: string, url: string): AppError {
  if (!isAxiosError(err)) return err instanceof AppError ? err : new AppError("WOOCOMMERCE_API_ERROR", { cause: err });
  const provider = { name: "http" as const, operation, url: redactUrl(url), method: err.config?.method?.toUpperCase() };
  if (!err.response) {
    const timedOut = err.code === "ECONNABORTED" || err.code === "ETIMEDOUT";
    return new AppError("WOOCOMMERCE_UNAVAILABLE", {
      message: timedOut ? "The WooCommerce store did not respond in time. Please try again." : undefined,
      provider: { ...provider, code: err.code, message: err.message },
      cause: err,
    });
  }
  const status = err.response.status;
  const body = err.response.data as { code?: string; message?: string } | string | undefined;
  const wooCode = typeof body === "object" ? body?.code : undefined;
  const wooMessage = typeof body === "object" ? body?.message : typeof body === "string" ? body.slice(0, 300) : undefined;
  const info = { ...provider, httpStatus: status, code: wooCode, message: wooMessage };

  if (status === 401 || status === 403) return new AppError("WOOCOMMERCE_CREDENTIALS_REJECTED", { provider: info, details: { wooCode }, cause: err, expected: true });
  if (status === 429 || status >= 500) return new AppError("WOOCOMMERCE_UNAVAILABLE", { provider: info, cause: err });
  if (status >= 300 && status < 400) {
    return new AppError("WOOCOMMERCE_API_ERROR", {
      message: "The store redirected the API request. Update the store address (e.g. https:// or www.) and reconnect.",
      provider: info,
      details: { reason: "redirected", location: err.response.headers?.location },
      cause: err,
    });
  }
  return new AppError("WOOCOMMERCE_API_ERROR", { provider: info, details: { wooCode }, cause: err });
}

/**
 * Calls the store's wc/v3 API. Throws WOOCOMMERCE_CREDENTIALS_REJECTED on 401/403 (the caller marks the store
 * reauth_required), WOOCOMMERCE_UNAVAILABLE on timeouts/5xx/429, WOOCOMMERCE_API_ERROR otherwise.
 */
export async function wooRequest<T>(
  conn: WooConnection,
  operation: string,
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  options: { params?: Record<string, string | number | undefined>; data?: unknown } = {}
): Promise<WooResponse<T>> {
  const { url, params: routeParams } = endpoint(conn, path);
  const query: Record<string, string> = { ...routeParams };
  for (const [key, value] of Object.entries(options.params ?? {})) if (value !== undefined) query[key] = String(value);

  const isHttps = conn.storeUrl.startsWith("https://");
  const firstMode: WooAuthMode = !isHttps ? "oauth1" : conn.authMode === "query" ? "query" : "header";

  const send = async (mode: WooAuthMode) => {
    let params = query;
    const headers: Record<string, string> = { Accept: "application/json", "User-Agent": USER_AGENT };
    if (mode === "header") {
      headers.Authorization = `Basic ${Buffer.from(`${conn.consumerKey}:${conn.consumerSecret}`).toString("base64")}`;
    } else if (mode === "query") {
      params = { ...query, consumer_key: conn.consumerKey, consumer_secret: conn.consumerSecret };
    } else {
      params = signOAuth1(method, url, query, conn.consumerKey, conn.consumerSecret);
    }
    return axios.request<T>({
      url,
      method,
      params,
      data: options.data,
      headers,
      timeout: TIMEOUT_MS,
      maxRedirects: 0, // never replay credentials to another host
      responseType: "json",
    });
  };

  try {
    const res = await send(firstMode);
    return { data: res.data, headers: res.headers as Record<string, string>, authMode: firstMode };
  } catch (err) {
    // Hosts running PHP as CGI often drop the Authorization header: retry with the key in the query string
    if (firstMode === "header" && isAxiosError(err) && err.response?.status === 401) {
      try {
        const res = await send("query");
        return { data: res.data, headers: res.headers as Record<string, string>, authMode: "query" };
      } catch (retryErr) {
        throw toWooError(retryErr, operation, url);
      }
    }
    throw toWooError(err, operation, url);
  }
}
