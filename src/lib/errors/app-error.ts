import { ERROR_DEFINITIONS, ErrorCode, ErrorSource } from "./codes";

/** Details from the external system that produced the error (Meta, Shopify, Firebase, Postgres). */
export interface ProviderErrorInfo {
  name: "meta" | "shopify" | "firebase" | "postgres" | "http";
  /** Provider's own error code, e.g. Meta 131047, Postgres 23505, Firebase "auth/id-token-expired". */
  code?: string | number;
  subcode?: number;
  type?: string;
  /** Raw provider message — logged, never shown to end users. */
  message?: string;
  /** Meta fbtrace_id / Shopify X-Request-Id — quote this when contacting the provider's support. */
  traceId?: string;
  httpStatus?: number;
  method?: string;
  url?: string;
  /** Operation name, e.g. "whatsapp.send_text". */
  operation?: string;
  durationMs?: number;
  /** Failing SQL (database errors only, logged on the server). */
  query?: string;
  /** Extra provider fields worth logging (Meta error_data.details, Postgres detail/constraint, …). */
  extra?: Record<string, unknown>;
}

export interface AppErrorOptions {
  /** User-facing message. Defaults to the code's catalogue message. */
  message?: string;
  /** Short user-facing heading, e.g. "24-Hour Messaging Window Expired" (UI uses it as the toast title). */
  title?: string;
  /** Structured, safe-to-expose details (field names, ids, provider codes). */
  details?: Record<string, unknown>;
  /** Original error. Logged with its stack, never sent to the browser. */
  cause?: unknown;
  status?: number;
  source?: ErrorSource;
  retryable?: boolean;
  provider?: ProviderErrorInfo;
  /** Log at "warn" instead of "error" even for 5xx (expected/handled failures). */
  expected?: boolean;
}

/**
 * The single error type that crosses layers.
 * Throw it from services/routes; `apiHandler` turns it into the standard JSON error response,
 * and the logger prints its code, source, provider details and cause chain.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly title?: string;
  readonly status: number;
  readonly source: ErrorSource;
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;
  readonly provider?: ProviderErrorInfo;
  readonly expected: boolean;

  constructor(code: ErrorCode, options: AppErrorOptions = {}) {
    const def = ERROR_DEFINITIONS[code];
    super(options.message ?? def.message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "AppError";
    this.code = code;
    this.title = options.title;
    this.status = options.status ?? def.status;
    this.source = options.source ?? def.source;
    this.retryable = options.retryable ?? ("retryable" in def ? Boolean(def.retryable) : false);
    this.details = options.details;
    this.provider = options.provider;
    this.expected = options.expected ?? false;
  }

  /** 400 for a bad/missing input field. */
  static validation(message: string, field?: string): AppError {
    return new AppError("VALIDATION_ERROR", { message, details: field ? { field } : undefined, expected: true });
  }

  /** 404 with a specific message, e.g. "Customer not found." */
  static notFound(message: string): AppError {
    return new AppError("NOT_FOUND", { message, expected: true });
  }

  /** 409 when attempting to connect a WhatsApp account/phone that is already connected. */
  static whatsappAlreadyConnected(message: string, details?: Record<string, unknown>): AppError {
    return new AppError("WHATSAPP_ALREADY_CONNECTED", { message, details, expected: true });
  }

  /**
   * Re-label an error caught at a higher level while keeping everything the lower level knew.
   * - A specific AppError (e.g. MESSAGE_WINDOW_EXPIRED) keeps its code; only `details` are merged.
   * - A generic one (META_API_ERROR, INTERNAL_ERROR, …) or a non-AppError becomes `fallbackCode`.
   */
  static wrap(err: unknown, fallbackCode: ErrorCode, options: AppErrorOptions = {}): AppError {
    if (err instanceof AppError) {
      const details = options.details ? { ...err.details, ...options.details } : err.details;
      if (!GENERIC_CODES.has(err.code)) {
        const kept = new AppError(err.code, {
          message: err.message,
          title: err.title,
          status: err.status,
          source: err.source,
          retryable: err.retryable,
          provider: err.provider,
          expected: err.expected,
          cause: err.cause,
          details,
        });
        // Keep the original throw site so logs still point at where it really failed
        kept.stack = err.stack;
        return kept;
      }
      return new AppError(fallbackCode, {
        retryable: err.retryable,
        title: err.title,
        provider: err.provider,
        ...options,
        details,
        cause: err,
      });
    }
    return new AppError(fallbackCode, { ...options, cause: err });
  }
}

const GENERIC_CODES = new Set<ErrorCode>(["META_API_ERROR", "INTERNAL_ERROR", "DB_QUERY_FAILED", "SHOPIFY_API_ERROR"]);

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
