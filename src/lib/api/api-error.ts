import { isAxiosError, isCancel } from "axios";
import {
  ERROR_DEFINITIONS,
  errorCodeFromStatus,
  isErrorCode,
  type ApiErrorBody,
  type ErrorCode,
  type ErrorSource,
} from "@/lib/errors/codes";
import { getFirebaseAuthErrorMessage } from "@/lib/firebase/errors";

export type ClientErrorCode = ErrorCode | "REQUEST_CANCELLED";

/**
 * Every failure the UI handles, normalised: API error bodies, network failures, timeouts,
 * Firebase client errors and plain JS errors all become an ApiError with a user-friendly `message`.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ClientErrorCode;
  /** Specific heading when the server knows one (e.g. "24-Hour Messaging Window Expired"). */
  readonly title?: string;
  readonly source: ErrorSource;
  readonly retryable: boolean;
  readonly requestId?: string;
  readonly details?: Record<string, unknown>;
  /** Development-only server info: where it failed and what the underlying error said. */
  readonly debug?: ApiErrorBody["debug"];
  /** "POST /api/channels/whatsapp/send" */
  readonly endpoint?: string;
  /** Kept so existing `err.response?.data?.error` reads keep working. */
  readonly response?: { status: number; data: unknown };
  /** Set once the error has been written to the console, to avoid logging it twice. */
  logged = false;

  constructor(init: {
    message: string;
    status: number;
    code: ClientErrorCode;
    title?: string;
    source: ErrorSource;
    retryable?: boolean;
    requestId?: string;
    details?: Record<string, unknown>;
    debug?: ApiErrorBody["debug"];
    endpoint?: string;
    response?: { status: number; data: unknown };
    cause?: unknown;
  }) {
    super(init.message, init.cause !== undefined ? { cause: init.cause } : undefined);
    this.name = "ApiError";
    this.status = init.status;
    this.code = init.code;
    this.title = init.title;
    this.source = init.source;
    this.retryable = init.retryable ?? false;
    this.requestId = init.requestId;
    this.details = init.details;
    this.debug = init.debug;
    this.endpoint = init.endpoint;
    this.response = init.response;
  }

  get isCancelled() {
    return this.code === "REQUEST_CANCELLED";
  }

  get isAuthError() {
    return this.status === 401 || this.source === "auth" || this.code.startsWith("AUTH_");
  }

  /** Compact object for console output. */
  toLogObject() {
    return {
      code: this.code,
      ...(this.title ? { title: this.title } : {}),
      status: this.status,
      source: this.source,
      message: this.message,
      endpoint: this.endpoint,
      requestId: this.requestId,
      retryable: this.retryable,
      ...(this.details ? { details: this.details } : {}),
      ...(this.debug ? { debug: this.debug } : {}),
    };
  }
}

function isApiErrorBody(data: unknown): data is ApiErrorBody {
  const d = data as Partial<ApiErrorBody> | null;
  return Boolean(d && d.success === false && typeof d.error === "string" && typeof d.code === "string");
}

function definition(code: ErrorCode) {
  return ERROR_DEFINITIONS[code] as { status: number; source: ErrorSource; message: string; retryable?: boolean };
}

export function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;

  if (isCancel(err)) {
    return new ApiError({ message: "Request cancelled.", status: 0, code: "REQUEST_CANCELLED", source: "network", cause: err });
  }

  if (isAxiosError(err)) {
    const method = err.config?.method?.toUpperCase();
    const url = err.config?.url?.split("?")[0];
    const endpoint = method && url ? `${method} ${url}` : url;

    // 1. Our standard API error body
    if (err.response && isApiErrorBody(err.response.data)) {
      const body = err.response.data;
      return new ApiError({
        message: body.error,
        title: body.title,
        status: err.response.status,
        code: isErrorCode(body.code) ? body.code : errorCodeFromStatus(err.response.status),
        source: body.source,
        retryable: body.retryable,
        requestId: body.requestId ?? err.response.headers?.["x-request-id"],
        details: body.details,
        debug: body.debug,
        endpoint,
        response: { status: err.response.status, data: body },
        cause: err,
      });
    }

    // 2. A response that isn't ours (proxy error page, 413 from a load balancer, Next.js HTML 500…)
    if (err.response) {
      const status = err.response.status;
      const code = errorCodeFromStatus(status);
      const def = definition(code);
      const data = err.response.data as { error?: unknown; message?: unknown } | undefined;
      const serverMessage = typeof data?.error === "string" ? data.error : typeof data?.message === "string" ? data.message : undefined;
      return new ApiError({
        message: serverMessage ?? def.message,
        status,
        code,
        source: def.source,
        retryable: status >= 500 || status === 429,
        requestId: err.response.headers?.["x-request-id"],
        endpoint,
        response: { status, data: err.response.data },
        cause: err,
      });
    }

    // 3. No response at all: offline, DNS, CORS, server down, timeout
    const timedOut = err.code === "ECONNABORTED" || err.code === "ETIMEDOUT";
    const offline = typeof navigator !== "undefined" && navigator.onLine === false;
    return new ApiError({
      message: timedOut
        ? "The server took too long to respond. Please try again."
        : offline
          ? "You appear to be offline. Check your internet connection."
          : ERROR_DEFINITIONS.NETWORK_ERROR.message,
      status: 0,
      code: timedOut ? "UPSTREAM_TIMEOUT" : "NETWORK_ERROR",
      source: "network",
      retryable: true,
      endpoint,
      cause: err,
    });
  }

  // Firebase client SDK errors (sign-in, token refresh)
  const anyErr = err as { code?: unknown; message?: unknown } | null;
  if (anyErr && typeof anyErr.code === "string" && /^auth\//.test(anyErr.code)) {
    const expired = anyErr.code === "auth/user-token-expired" || anyErr.code === "auth/id-token-expired";
    const network = anyErr.code === "auth/network-request-failed";
    return new ApiError({
      message: getFirebaseAuthErrorMessage(err),
      status: network ? 0 : 401,
      code: network ? "NETWORK_ERROR" : expired ? "AUTH_TOKEN_EXPIRED" : "AUTH_TOKEN_INVALID",
      source: network ? "network" : "firebase",
      retryable: network,
      details: { firebaseCode: anyErr.code },
      cause: err,
    });
  }

  // Anything else is a bug in the browser code
  return new ApiError({
    message: ERROR_DEFINITIONS.INTERNAL_ERROR.message,
    status: 0,
    code: "INTERNAL_ERROR",
    source: "internal",
    debug: { message: err instanceof Error ? err.message : String(err) },
    cause: err,
  });
}
