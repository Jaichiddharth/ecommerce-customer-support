import crypto from "crypto";
import { AppError } from "../errors";
import { getWooCommerceConfig, WOOCOMMERCE_APP_NAME, WOOCOMMERCE_CALLBACK_PATH, WOOCOMMERCE_RETURN_PATH, WOOCOMMERCE_STATE_TTL_SECONDS } from "./config";

/**
 * WooCommerce Application Authentication Endpoint flow:
 *   1. buildAuthorizeUrl(): send the merchant to <store>/wc-auth/v1/authorize with app_name, scope, user_id,
 *      return_url and callback_url. `user_id` is opaque to WooCommerce and echoed back, so it carries our signed
 *      state (workspace, user, store, nonce, expiry).
 *   2. The merchant logs into WordPress and approves. WooCommerce creates a REST API key and POSTs
 *      { key_id, user_id, consumer_key, consumer_secret, key_permissions } to callback_url, server to server. If we
 *      answer with anything but 2xx, WooCommerce deletes the key and shows the merchant an error.
 *   3. WooCommerce redirects the browser to return_url?success=1|0&user_id=<state>.
 * Neither request carries a UnoCX session; both are trusted only through the signed state.
 */

export interface WooAuthState {
  o: number; // organization id
  u: number; // user who started the flow
  s: string; // normalized store URL
  h: string; // store host (identity)
  r: 0 | 1; // re-authorizing a store this workspace already has
  m: "wp-json" | "rest-route"; // how the store's REST API was reached during discovery
  n: string; // nonce: a key can be delivered once per authorization
  e: number; // expiry (unix seconds)
}

const sign = (payload: string, secret: Buffer) => crypto.createHmac("sha256", secret).update(payload).digest("base64url");

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function createAuthState(params: {
  organizationId: number;
  userId: number;
  storeUrl: string;
  storeHost: string;
  reauthorize: boolean;
  restMode: "wp-json" | "rest-route";
}): string {
  const { stateSecret } = getWooCommerceConfig();
  const payload: WooAuthState = {
    o: params.organizationId,
    u: params.userId,
    s: params.storeUrl,
    h: params.storeHost,
    r: params.reauthorize ? 1 : 0,
    m: params.restMode,
    n: crypto.randomBytes(12).toString("base64url"),
    e: Math.floor(Date.now() / 1000) + WOOCOMMERCE_STATE_TTL_SECONDS,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${sign(encoded, stateSecret)}`;
}

/**
 * Signature and shape of a state we issued. `allowExpired` is for the browser return only: it just tells the
 * merchant how it went and never stores credentials.
 */
export function verifyAuthState(state: unknown, { allowExpired = false }: { allowExpired?: boolean } = {}): WooAuthState {
  const fail = (reason: string) => new AppError("WOOCOMMERCE_AUTH_FAILED", { details: { reason }, expected: true });
  if (typeof state !== "string" || !state) throw fail("missing_state");

  const [encoded, signature] = state.split(".");
  if (!encoded || !signature || !safeEqual(signature, sign(encoded, getWooCommerceConfig().stateSecret))) throw fail("bad_state_signature");

  let payload: WooAuthState;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw fail("bad_state_payload");
  }
  if (!Number.isInteger(payload.o) || !Number.isInteger(payload.u) || typeof payload.s !== "string" || typeof payload.h !== "string") {
    throw fail("bad_state_payload");
  }
  if (payload.m !== "wp-json" && payload.m !== "rest-route") throw fail("bad_state_payload");
  if (!allowExpired && (!payload.e || payload.e < Math.floor(Date.now() / 1000))) throw fail("state_expired");
  return payload;
}

/**
 * The approval page on the merchant's store. With "plain" permalinks /wc-auth/v1/authorize isn't routed, but the
 * query-var form WooCommerce registers for it always is.
 */
export function buildAuthorizeUrl(storeUrl: string, state: string, restMode: "wp-json" | "rest-route"): string {
  const config = getWooCommerceConfig();
  const url = restMode === "wp-json" ? new URL(`${storeUrl}/wc-auth/v1/authorize`) : new URL(`${storeUrl}/`);
  if (restMode === "rest-route") {
    url.searchParams.set("wc-auth-version", "1");
    url.searchParams.set("wc-auth-route", "authorize");
  }
  url.searchParams.set("app_name", WOOCOMMERCE_APP_NAME);
  url.searchParams.set("scope", config.scope);
  url.searchParams.set("user_id", state);
  url.searchParams.set("return_url", `${config.appUrl}${WOOCOMMERCE_RETURN_PATH}`);
  url.searchParams.set("callback_url", `${config.appUrl}${WOOCOMMERCE_CALLBACK_PATH}`);
  return url.toString();
}
