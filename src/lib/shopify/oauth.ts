import crypto from "crypto";
import axios from "axios";
import { AppError, toAppError } from "../errors";
import { createLogger } from "../logger";
import { getShopifyConfig, isValidShopDomain, SHOPIFY_CALLBACK_PATH } from "./config";

/**
 * Shopify OAuth (authorization code grant) for an offline access token:
 *   1. buildAuthorizeUrl(): signed `state` (org, user, shop, nonce, expiry) + nonce cookie
 *   2. Shopify redirects back to the callback → verifyCallbackHmac() + verifyState()
 *   3. exchangeCodeForToken() → access token stored encrypted by the service
 */

const log = createLogger("ShopifyOAuth");

export const OAUTH_NONCE_COOKIE = "shopify_oauth_nonce";
export const OAUTH_STATE_TTL_SECONDS = 10 * 60;

interface OAuthStatePayload {
  o: number; // organization id
  u: number; // user id who started the flow
  s: string; // shop domain
  n: string; // nonce, also stored in an httpOnly cookie
  e: number; // expiry (unix seconds)
}

const base64url = (value: Buffer | string) => Buffer.from(value).toString("base64url");

function sign(payload: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function buildAuthorizeUrl(params: { organizationId: number; userId: number; shop: string }) {
  const config = getShopifyConfig();
  const nonce = crypto.randomBytes(16).toString("hex");
  const payload: OAuthStatePayload = {
    o: params.organizationId,
    u: params.userId,
    s: params.shop,
    n: nonce,
    e: Math.floor(Date.now() / 1000) + OAUTH_STATE_TTL_SECONDS,
  };
  const encoded = base64url(JSON.stringify(payload));
  const state = `${encoded}.${sign(encoded, config.apiSecret)}`;

  const url = new URL(`https://${params.shop}/admin/oauth/authorize`);
  url.searchParams.set("client_id", config.apiKey);
  url.searchParams.set("scope", config.scopes.join(","));
  url.searchParams.set("redirect_uri", `${config.appUrl}${SHOPIFY_CALLBACK_PATH}`);
  url.searchParams.set("state", state);
  // No grant_options[]=per-user: we need an offline token that keeps working after the merchant logs out

  return { authorizeUrl: url.toString(), nonce };
}

/** Verifies the `state` we issued: signature, expiry, nonce cookie and shop all have to match. */
export function verifyState(state: string | null, nonceCookie: string | undefined, shop: string): OAuthStatePayload {
  const fail = (reason: string) => new AppError("SHOPIFY_OAUTH_FAILED", { details: { reason }, expected: true });
  if (!state) throw fail("missing_state");

  const [encoded, signature] = state.split(".");
  if (!encoded || !signature || !safeEqual(signature, sign(encoded, getShopifyConfig().apiSecret))) {
    throw fail("bad_state_signature");
  }

  let payload: OAuthStatePayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw fail("bad_state_payload");
  }

  if (!payload.e || payload.e < Math.floor(Date.now() / 1000)) throw fail("state_expired");
  if (!nonceCookie || !safeEqual(payload.n, nonceCookie)) throw fail("nonce_mismatch");
  if (payload.s !== shop) throw fail("shop_mismatch");
  if (!Number.isInteger(payload.o) || !Number.isInteger(payload.u)) throw fail("bad_state_payload");

  return payload;
}

/**
 * Shopify signs every redirect: drop `hmac`, sort the remaining query params, join as `k=v&…`
 * and compare the HMAC-SHA256 (hex) computed with the app secret.
 */
export function verifyCallbackHmac(searchParams: URLSearchParams): boolean {
  const hmac = searchParams.get("hmac");
  if (!hmac) return false;

  const message = Array.from(searchParams.entries())
    .filter(([key]) => key !== "hmac" && key !== "signature")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");

  const digest = crypto.createHmac("sha256", getShopifyConfig().apiSecret).update(message).digest("hex");
  return safeEqual(digest, hmac.toLowerCase());
}

export interface ShopifyTokenResponse {
  accessToken: string;
  scopes: string[];
  refreshToken: string | null;
  expiresAt: Date | null;
}

async function requestToken(shop: string, body: Record<string, string>, operation: string): Promise<ShopifyTokenResponse> {
  if (!isValidShopDomain(shop)) {
    throw new AppError("SHOPIFY_OAUTH_FAILED", { details: { reason: "invalid_shop" }, expected: true });
  }
  const config = getShopifyConfig();
  try {
    const res = await axios.post(
      `https://${shop}/admin/oauth/access_token`,
      { client_id: config.apiKey, client_secret: config.apiSecret, ...body },
      { timeout: 20_000, headers: { "Content-Type": "application/json", Accept: "application/json" }, operation }
    );
    const data = res.data ?? {};
    if (!data.access_token) {
      throw new AppError("SHOPIFY_OAUTH_FAILED", { details: { reason: "no_access_token" } });
    }
    return {
      accessToken: data.access_token,
      scopes: String(data.scope || "").split(",").map((s: string) => s.trim()).filter(Boolean),
      refreshToken: data.refresh_token || null,
      expiresAt: data.expires_in ? new Date(Date.now() + Number(data.expires_in) * 1000) : null,
    };
  } catch (err) {
    const appError = toAppError(err);
    log.warn("Shopify token request failed", { shop, operation, code: appError.code, httpStatus: appError.provider?.httpStatus });
    // A rejected code/refresh token means the merchant has to authorize again
    if (appError.provider?.httpStatus === 400 || appError.provider?.httpStatus === 401) {
      throw new AppError(operation === "shopify.refresh_token" ? "SHOPIFY_AUTH_FAILED" : "SHOPIFY_OAUTH_FAILED", {
        provider: appError.provider,
        cause: appError,
        expected: true,
      });
    }
    throw appError;
  }
}

export function exchangeCodeForToken(shop: string, code: string) {
  return requestToken(shop, { code }, "shopify.exchange_code");
}

/** Only used for expiring offline tokens (the token response included a refresh_token). */
export function refreshAccessToken(shop: string, refreshToken: string) {
  return requestToken(shop, { grant_type: "refresh_token", refresh_token: refreshToken }, "shopify.refresh_token");
}
