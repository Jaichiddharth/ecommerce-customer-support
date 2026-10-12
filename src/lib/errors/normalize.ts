import { isAxiosError, type AxiosError } from "axios";
import { AppError, type ProviderErrorInfo } from "./app-error";
import { errorCodeFromStatus, isErrorCode, type ErrorCode } from "./codes";
import { classifyMetaError } from "./meta-errors";
import { redactUrl } from "../logger/redact";

/**
 * Convert anything that was thrown into an AppError, recognising where it came from:
 * Meta Graph API, Shopify, Firebase Admin, Postgres/Drizzle, or our own code.
 * The original error is always kept as `cause` so the logger can print the real failure.
 */
export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (looksLikeAppError(err)) return err;

  if (isAxiosError(err)) return fromAxiosError(err);

  const anyErr = err as Record<string, any> | null;

  if (isFirebaseError(anyErr)) return fromFirebaseError(anyErr!, err);

  const dbError = fromDatabaseError(anyErr, err);
  if (dbError) return dbError;

  // Legacy pattern: Object.assign(new Error("Message not found."), { status: 404 })
  if (err instanceof Error && typeof anyErr?.status === "number") {
    const status = anyErr.status as number;
    const code = errorCodeFromStatus(status);
    return new AppError(code, { status, message: status < 500 ? err.message : undefined, cause: err });
  }

  return new AppError("INTERNAL_ERROR", { cause: err });
}

/* ------------------------------------------------------------------ */
/* HTTP integrations (axios)                                           */
/* ------------------------------------------------------------------ */

type Provider = "meta" | "shopify" | "http";

function detectProvider(url = ""): Provider {
  if (/graph\.facebook\.com|lookaside\.fbsbx\.com|fbcdn\.net/i.test(url)) return "meta";
  if (/myshopify\.com|shopify\.com/i.test(url)) return "shopify";
  return "http";
}

function fullUrl(err: AxiosError): string | undefined {
  const { baseURL, url } = err.config ?? {};
  if (!url) return baseURL;
  if (/^https?:\/\//i.test(url) || !baseURL) return url;
  return `${baseURL.replace(/\/$/, "")}/${url.replace(/^\//, "")}`;
}

export function fromAxiosError(err: AxiosError): AppError {
  const url = fullUrl(err);
  const provider = detectProvider(url);
  const method = err.config?.method?.toUpperCase();
  const operation = (err.config as { operation?: string } | undefined)?.operation;
  const startedAt = (err.config as { startedAt?: number } | undefined)?.startedAt;
  const durationMs = startedAt ? Math.round(performance.now() - startedAt) : undefined;
  const base: ProviderErrorInfo = { name: provider, method, url: redactUrl(url), operation, durationMs };

  // No response at all: timeout, DNS failure, connection refused…
  if (!err.response) {
    const timedOut = err.code === "ECONNABORTED" || err.code === "ETIMEDOUT";
    const code: ErrorCode =
      provider === "meta" ? "META_UNAVAILABLE" : provider === "shopify" ? "SHOPIFY_UNAVAILABLE" : "UPSTREAM_TIMEOUT";
    const who = provider === "meta" ? "WhatsApp (Meta)" : provider === "shopify" ? "Shopify" : "An external service";
    return new AppError(code, {
      message: timedOut ? `${who} did not respond in time. Please try again.` : undefined,
      retryable: true,
      provider: { ...base, code: err.code, message: err.message },
      cause: err,
    });
  }

  const status = err.response.status;
  const data = err.response.data as any;

  if (provider === "meta") {
    return fromMetaErrorBody(status, data, { ...base, cause: err });
  }

  if (provider === "shopify") {
    const headers = err.response.headers ?? {};
    const shopifyMessage = typeof data?.errors === "string" ? data.errors : data?.errors ? JSON.stringify(data.errors) : err.message;
    const info: ProviderErrorInfo = { ...base, httpStatus: status, message: shopifyMessage, traceId: headers["x-request-id"] };
    if (status === 401 || status === 403) return new AppError("SHOPIFY_AUTH_FAILED", { provider: info, cause: err });
    if (status === 429) {
      return new AppError("SHOPIFY_RATE_LIMITED", { provider: info, details: { retryAfterSeconds: Number(headers["retry-after"]) || undefined }, cause: err });
    }
    if (status === 402 || status === 423) {
      return new AppError("SHOPIFY_UNAVAILABLE", { message: "The Shopify store is frozen or locked.", retryable: false, provider: info, cause: err });
    }
    if (status >= 500) return new AppError("SHOPIFY_UNAVAILABLE", { provider: info, cause: err });
    return new AppError("SHOPIFY_API_ERROR", { provider: info, cause: err });
  }

  return new AppError(status >= 500 ? "UPSTREAM_TIMEOUT" : "INTERNAL_ERROR", {
    message: status >= 500 ? "An external service failed to respond. Please try again." : undefined,
    provider: { ...base, httpStatus: status, message: typeof data === "string" ? data.slice(0, 300) : err.message },
    cause: err,
  });
}

/**
 * Build an AppError from a Meta Graph error body: { error: { message, type, code, error_subcode, fbtrace_id, … } }.
 * Also used by fetch()-based calls (media upload/download) that don't go through axios.
 */
export function fromMetaErrorBody(
  httpStatus: number,
  body: any,
  context: Omit<ProviderErrorInfo, "name"> & { cause?: unknown } = {}
): AppError {
  const { cause, ...info } = context;
  const metaErr = body?.error ?? {};
  const rawCode = metaErr.code;
  const metaCode = rawCode !== undefined && rawCode !== null && rawCode !== "" && Number.isFinite(Number(rawCode)) ? Number(rawCode) : undefined;
  const classification = classifyMetaError(metaCode, httpStatus, {
    title: metaErr.error_user_title,
    message: metaErr.error_user_msg,
  });
  const details = metaErr.error_data?.details as string | undefined;

  // Meta rejected the request for a business reason (4xx): that's not a gateway failure
  const status = httpStatus < 500 && classification.code === "MESSAGE_SEND_FAILED" ? 422 : undefined;

  return new AppError(classification.code, {
    message: classification.message,
    title: classification.title,
    status,
    retryable: classification.retryable,
    details: {
      metaCode,
      ...(metaErr.error_subcode ? { metaSubcode: metaErr.error_subcode } : {}),
      ...(details ? { metaDetails: details } : {}),
      ...(classification.solution ? { solution: classification.solution } : {}),
    },
    provider: {
      ...info,
      name: "meta",
      httpStatus,
      code: metaCode,
      subcode: metaErr.error_subcode,
      type: metaErr.type,
      message: metaErr.message || metaErr.error_user_msg || (typeof body === "string" ? body.slice(0, 300) : undefined),
      traceId: metaErr.fbtrace_id,
      extra: {
        title: classification.title,
        ...(classification.description ? { description: classification.description } : {}),
        ...(classification.solution ? { solution: classification.solution } : {}),
        ...(details ? { details } : {}),
        ...(classification.known ? {} : { note: `Meta code ${metaCode ?? "?"} is not in META_ERROR_CATALOG` }),
      },
    },
    cause,
  });
}

/* ------------------------------------------------------------------ */
/* Firebase Admin                                                      */
/* ------------------------------------------------------------------ */

function isFirebaseError(err: Record<string, any> | null): boolean {
  return Boolean(err && typeof err.code === "string" && /^(auth|app)\//.test(err.code));
}

const FIREBASE_CODE_MAP: Record<string, ErrorCode> = {
  "auth/id-token-expired": "AUTH_TOKEN_EXPIRED",
  "auth/session-cookie-expired": "AUTH_TOKEN_EXPIRED",
  "auth/user-token-expired": "AUTH_TOKEN_EXPIRED",
  "auth/id-token-revoked": "AUTH_TOKEN_INVALID",
  "auth/session-cookie-revoked": "AUTH_TOKEN_INVALID",
  "auth/invalid-id-token": "AUTH_TOKEN_INVALID",
  "auth/argument-error": "AUTH_TOKEN_INVALID",
  "auth/user-disabled": "AUTH_USER_DISABLED",
  "auth/user-not-found": "AUTH_USER_NOT_FOUND",
};

function fromFirebaseError(fbErr: Record<string, any>, original: unknown): AppError {
  const code = FIREBASE_CODE_MAP[fbErr.code as string] ?? "FIREBASE_UNAVAILABLE";
  return new AppError(code, {
    provider: { name: "firebase", code: fbErr.code, message: fbErr.message },
    // Bad/expired tokens are a normal part of life — log them as warnings, not errors
    expected: code !== "FIREBASE_UNAVAILABLE",
    cause: original,
  });
}

/* ------------------------------------------------------------------ */
/* Postgres / Drizzle                                                  */
/* ------------------------------------------------------------------ */

const CONNECTION_ERROR_CODES = new Set([
  "ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "ECONNRESET", "EAI_AGAIN", "EPIPE",
  "CONNECT_TIMEOUT", "CONNECTION_CLOSED", "CONNECTION_ENDED", "CONNECTION_DESTROYED",
]);

function isPostgresError(err: Record<string, any> | null | undefined): boolean {
  return Boolean(
    err &&
      (err.name === "PostgresError" ||
        (typeof err.code === "string" && /^[0-9A-Z]{5}$/.test(err.code) && "severity" in err))
  );
}

function fromDatabaseError(anyErr: Record<string, any> | null, original: unknown): AppError | null {
  if (!anyErr) return null;

  const isDrizzle = anyErr.name === "DrizzleQueryError" || (typeof anyErr.query === "string" && Array.isArray(anyErr.params));
  const pg = isDrizzle ? (anyErr.cause as Record<string, any> | undefined) : anyErr;
  const query = isDrizzle ? String(anyErr.query).slice(0, 600) : undefined;

  if (pg && isPostgresError(pg)) {
    const sqlState: string = pg.code;
    const provider: ProviderErrorInfo = {
      name: "postgres",
      code: sqlState,
      message: pg.message,
      query,
      extra: {
        ...(pg.detail ? { detail: pg.detail } : {}),
        ...(pg.hint ? { hint: pg.hint } : {}),
        ...(pg.table_name ? { table: pg.table_name } : {}),
        ...(pg.column_name ? { column: pg.column_name } : {}),
        ...(pg.constraint_name ? { constraint: pg.constraint_name } : {}),
      },
    };
    const code = classifySqlState(sqlState);
    // Only connection problems and serialization/deadlock (class 40) are worth retrying
    const retryable = code === "DB_UNAVAILABLE" || sqlState.startsWith("40");
    return new AppError(code, { provider, retryable, cause: original });
  }

  if (isDrizzle) {
    const connCode = pg?.code as string | undefined;
    if (connCode && CONNECTION_ERROR_CODES.has(connCode)) {
      return new AppError("DB_UNAVAILABLE", {
        provider: { name: "postgres", code: connCode, message: pg?.message, query },
        cause: original,
      });
    }
    return new AppError("DB_QUERY_FAILED", {
      provider: { name: "postgres", message: pg?.message ?? anyErr.message, query },
      cause: original,
    });
  }

  return null;
}

function classifySqlState(sqlState: string): ErrorCode {
  if (sqlState === "23505") return "DB_CONSTRAINT_VIOLATION";
  if (sqlState.startsWith("23") || sqlState.startsWith("22")) return "DB_INVALID_DATA";
  if (sqlState.startsWith("08") || sqlState.startsWith("53") || sqlState.startsWith("28") || sqlState === "57P01" || sqlState === "57P03") {
    return "DB_UNAVAILABLE";
  }
  return "DB_QUERY_FAILED";
}

/* ------------------------------------------------------------------ */

/** Duck-typed check so AppErrors still match across separately bundled module copies. */
function looksLikeAppError(err: unknown): err is AppError {
  const e = err as Record<string, unknown> | null;
  return Boolean(e && e.name === "AppError" && isErrorCode(e.code) && typeof e.status === "number");
}
