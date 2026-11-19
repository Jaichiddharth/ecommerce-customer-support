/**
 * What the logs must never show.
 *
 * REDACT_PATHS feeds pino's built-in `redact` option. pino matches exact field names and each `*`
 * stands for one level, so every name is listed three times to cover
 *   { accessToken }, { connection: { accessToken } } and { data: { connection: { accessToken } } }.
 * To protect a new kind of secret, add its field name to SECRET_FIELDS.
 *
 * redactUrl() masks secrets inside URL strings, which pino's `redact` can't look into.
 */

const SECRET_FIELDS = [
  "password", "passwordHash",
  "token", "accessToken", "access_token", "metaAccessToken", "refreshToken", "idToken",
  "firebaseIdToken", "firebaseGcmToken", "verifyToken", "input_token",
  "secret", "appSecret", "clientSecret", "client_secret", "apiKey", "privateKey", "private_key", "credential",
  "authorization", "Authorization", "cookie", "signature", "signatureHeader",
  "consumer_key", "consumer_secret", "consumerKey", "consumerSecret", "credentials", "oauth_signature",
];

export const REDACT_PATHS = SECRET_FIELDS.flatMap((field) => [field, `*.${field}`, `*.*.${field}`]);

const SECRET_QUERY_PARAMS = [
  "access_token", "client_secret", "input_token", "code", "token", "hub.verify_token", "appsecret_proof",
  "consumer_key", "consumer_secret", "oauth_signature", "user_id",
];

/** Remove secrets from query strings, e.g. ?access_token=…, ?token=… (SSE), ?client_secret=… */
export function redactUrl(url: string | undefined | null): string | undefined {
  if (!url) return undefined;
  try {
    const isAbsolute = /^[a-z]+:\/\//i.test(url);
    const parsed = new URL(url, "http://relative.local");
    for (const param of SECRET_QUERY_PARAMS) {
      if (parsed.searchParams.has(param)) parsed.searchParams.set(param, "[REDACTED]");
    }
    const out = isAbsolute ? parsed.toString() : `${parsed.pathname}${parsed.search}`;
    return decodeURIComponent(out);
  } catch {
    return url.replace(/(access_token|client_secret|input_token|token|consumer_key|consumer_secret|oauth_signature)=[^&]+/gi, "$1=[REDACTED]");
  }
}
