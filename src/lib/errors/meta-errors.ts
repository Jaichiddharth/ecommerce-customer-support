import type { ErrorCode } from "./codes";
import { META_ERROR_CATALOG, type MetaErrorEntry } from "./meta-error-catalog";

export { META_ERROR_CATALOG, type MetaErrorEntry } from "./meta-error-catalog";

/**
 * Meta Graph / WhatsApp Cloud API error lookup.
 * Used by the server (to classify API failures) and by the UI (to explain failed-message status codes
 * that arrive later through the status webhook).
 */
export interface MetaErrorClassification {
  code: ErrorCode;
  /** Short heading, e.g. "24-Hour Messaging Window Expired". */
  title: string;
  /** User-facing explanation. */
  message: string;
  /** Why it happened (for logs). */
  description?: string;
  /** What to do about it (for logs / support). */
  solution?: string;
  retryable: boolean;
  /** False when the code isn't in the catalog and a generic classification was used. */
  known: boolean;
}

export function getMetaErrorInfo(metaCode?: number | null): MetaErrorEntry | undefined {
  return metaCode !== undefined && metaCode !== null ? META_ERROR_CATALOG[metaCode] : undefined;
}

/**
 * Classify a Meta error code. Unknown codes fall back on the HTTP status, and on Meta's own
 * user-facing text (error_user_title / error_user_msg) when Meta provides it.
 */
export function classifyMetaError(
  metaCode?: number | null,
  httpStatus?: number,
  metaUserText?: { title?: string; message?: string }
): MetaErrorClassification {
  const entry = getMetaErrorInfo(metaCode);
  if (entry) {
    return {
      code: entry.code,
      title: entry.title,
      message: entry.userMessage,
      description: entry.description,
      solution: entry.solution,
      retryable: Boolean(entry.retryable),
      known: true,
    };
  }

  if (metaCode !== undefined && metaCode !== null && metaCode >= 200 && metaCode <= 299) {
    return {
      code: "META_PERMISSION_DENIED",
      title: metaUserText?.title || "Permission Not Granted",
      message: metaUserText?.message || "A required WhatsApp permission is missing. Please reconnect your account to grant access.",
      solution: "Check the access token permissions and make sure the required WhatsApp permissions have been granted.",
      retryable: false,
      known: false,
    };
  }
  if (httpStatus === 429) {
    return {
      code: "META_RATE_LIMITED",
      title: "Rate Limit Reached",
      message: "You're sending too many requests at once. Please wait a bit and try again.",
      retryable: true,
      known: false,
    };
  }
  if (httpStatus && httpStatus >= 500) {
    return {
      code: "META_UNAVAILABLE",
      title: "Temporary Service Issue",
      message: "WhatsApp is temporarily unavailable. Please try again in a few minutes.",
      retryable: true,
      known: false,
    };
  }
  return {
    code: "META_API_ERROR",
    title: metaUserText?.title || "WhatsApp Error",
    message: metaUserText?.message || "WhatsApp (Meta) returned an error. Please try again.",
    retryable: false,
    known: false,
  };
}

/** User-facing explanation for a failed message's stored Meta error code (chat bubbles, tooltips). */
export function describeMessageFailure(metaCode?: number | null): string {
  if (!metaCode) return "The message could not be delivered.";
  return getMetaErrorInfo(metaCode)?.userMessage ?? `The message could not be delivered (WhatsApp error ${metaCode}).`;
}
