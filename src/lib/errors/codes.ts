/**
 * Central catalogue of every error the API can return.
 * Shared by server and browser: the server picks a code, the UI reads the same code to decide how to react.
 */

/** Subsystem the error originated from — shown in logs and returned to the UI. */
export type ErrorSource =
  | "validation"
  | "auth"
  | "firebase"
  | "meta"
  | "whatsapp"
  | "webhook"
  | "upload"
  | "shopify"
  | "database"
  | "network"
  | "internal";

interface ErrorDefinition {
  status: number;
  source: ErrorSource;
  /** Default user-facing message (safe to show in the UI). */
  message: string;
  retryable?: boolean;
}

export const ERROR_DEFINITIONS = {
  // Request validation
  VALIDATION_ERROR: { status: 400, source: "validation", message: "Some of the information provided is invalid." },
  INVALID_JSON: { status: 400, source: "validation", message: "The request body is not valid JSON." },
  NOT_FOUND: { status: 404, source: "validation", message: "The requested item was not found." },
  CONFLICT: { status: 409, source: "validation", message: "This conflicts with existing data." },

  // Authentication (Firebase)
  AUTH_TOKEN_MISSING: { status: 401, source: "auth", message: "Please sign in to continue." },
  AUTH_TOKEN_EXPIRED: { status: 401, source: "firebase", message: "Your session has expired. Please sign in again." },
  AUTH_TOKEN_INVALID: { status: 401, source: "firebase", message: "Your session is invalid. Please sign in again." },
  AUTH_USER_NOT_FOUND: { status: 401, source: "auth", message: "Your account is not set up yet. Please sign out and sign in again." },
  AUTH_USER_DISABLED: { status: 403, source: "firebase", message: "This account has been disabled. Contact your administrator." },
  FORBIDDEN: { status: 403, source: "auth", message: "You don't have permission to do this." },
  FIREBASE_UNAVAILABLE: { status: 503, source: "firebase", message: "The sign-in service is unavailable right now. Please try again shortly.", retryable: true },

  // Meta Graph API
  META_API_ERROR: { status: 502, source: "meta", message: "WhatsApp (Meta) returned an error. Please try again." },
  META_INVALID_REQUEST: { status: 422, source: "meta", message: "WhatsApp (Meta) rejected the request." },
  META_PERMISSION_DENIED: { status: 422, source: "meta", message: "The WhatsApp account is missing required permissions. Reconnect it and grant all permissions." },
  META_RATE_LIMITED: { status: 429, source: "meta", message: "WhatsApp rate limit reached. Please wait a moment and try again.", retryable: true },
  META_UNAVAILABLE: { status: 503, source: "meta", message: "WhatsApp (Meta) is temporarily unavailable. Please try again shortly.", retryable: true },

  // WhatsApp channel connection
  WHATSAPP_NOT_CONNECTED: { status: 422, source: "whatsapp", message: "No WhatsApp channel is connected. Please connect your WhatsApp account first." },
  WHATSAPP_CHANNEL_NOT_FOUND: { status: 404, source: "whatsapp", message: "The selected WhatsApp channel could not be found." },
  WHATSAPP_CHANNEL_DISCONNECTED: { status: 409, source: "whatsapp", message: "This contact's WhatsApp number was disconnected. Reconnect it to see and reply to this conversation." },
  WHATSAPP_CHANNEL_MISCONFIGURED: { status: 422, source: "whatsapp", message: "This WhatsApp channel is not fully set up. Please reconnect it." },
  WHATSAPP_REAUTH_REQUIRED: { status: 422, source: "whatsapp", message: "The WhatsApp connection has expired. Please reconnect your WhatsApp account." },
  WHATSAPP_CONNECT_FAILED: { status: 502, source: "whatsapp", message: "Could not connect your WhatsApp account. Please try again." },
  WHATSAPP_ALREADY_CONNECTED: { status: 409, source: "whatsapp", message: "This WhatsApp account, phone number ID, or phone number is already connected." },

  // Message sending
  MESSAGE_SEND_FAILED: { status: 502, source: "whatsapp", message: "The message could not be sent. Please try again." },
  MESSAGE_WINDOW_EXPIRED: { status: 422, source: "whatsapp", message: "More than 24 hours have passed since the customer last replied. Send an approved template to restart the conversation." },
  MESSAGE_RECIPIENT_INVALID: { status: 422, source: "whatsapp", message: "This phone number can't receive WhatsApp messages. Check the number and try again." },
  MESSAGE_TEMPLATE_INVALID: { status: 422, source: "whatsapp", message: "The WhatsApp template is invalid, paused or not approved." },

  // File upload / media
  FILE_TOO_LARGE: { status: 413, source: "upload", message: "This file is too large to send on WhatsApp." },
  FILE_TYPE_UNSUPPORTED: { status: 415, source: "upload", message: "This file type isn't supported by WhatsApp." },
  FILE_UPLOAD_FAILED: { status: 502, source: "upload", message: "The file could not be uploaded to WhatsApp. Please try again.", retryable: true },
  MEDIA_NOT_FOUND: { status: 404, source: "upload", message: "This media file is no longer available." },

  // Webhooks
  WEBHOOK_VERIFICATION_FAILED: { status: 403, source: "webhook", message: "Webhook verification failed." },
  WEBHOOK_SIGNATURE_INVALID: { status: 401, source: "webhook", message: "Invalid or missing webhook signature." },
  WEBHOOK_MISCONFIGURED: { status: 500, source: "webhook", message: "Webhook is not configured on the server." },
  WEBHOOK_PROCESSING_FAILED: { status: 500, source: "webhook", message: "The webhook event could not be processed." },

  // Shopify
  SHOPIFY_API_ERROR: { status: 502, source: "shopify", message: "Shopify returned an error. Please try again." },
  SHOPIFY_AUTH_FAILED: { status: 422, source: "shopify", message: "The Shopify store connection has expired. Please reconnect your store." },
  SHOPIFY_RATE_LIMITED: { status: 429, source: "shopify", message: "Shopify rate limit reached. Please wait a moment and try again.", retryable: true },
  SHOPIFY_UNAVAILABLE: { status: 503, source: "shopify", message: "Shopify is temporarily unavailable. Please try again shortly.", retryable: true },
  SHOPIFY_NOT_CONNECTED: { status: 422, source: "shopify", message: "No Shopify store is connected. Connect your store first." },
  SHOPIFY_NOT_CONFIGURED: { status: 500, source: "shopify", message: "The Shopify integration is not configured on the server." },
  SHOPIFY_OAUTH_FAILED: { status: 400, source: "shopify", message: "The Shopify authorization could not be verified. Please try connecting again." },
  SHOPIFY_CUSTOMER_ALREADY_LINKED: { status: 409, source: "shopify", message: "This Shopify customer is already linked to another contact." },

  // Database
  DB_UNAVAILABLE: { status: 503, source: "database", message: "The database is temporarily unavailable. Please try again shortly.", retryable: true },
  DB_CONSTRAINT_VIOLATION: { status: 409, source: "database", message: "This record already exists or conflicts with existing data." },
  DB_INVALID_DATA: { status: 400, source: "database", message: "Some of the data is invalid or refers to a record that doesn't exist." },
  DB_QUERY_FAILED: { status: 500, source: "database", message: "A database error occurred. Please try again.", retryable: true },

  // Generic
  RATE_LIMITED: { status: 429, source: "internal", message: "Too many requests. Please wait a moment and try again.", retryable: true },
  UPSTREAM_TIMEOUT: { status: 504, source: "network", message: "An external service took too long to respond. Please try again.", retryable: true },
  NETWORK_ERROR: { status: 0, source: "network", message: "Can't reach the server. Check your internet connection.", retryable: true },
  INTERNAL_ERROR: { status: 500, source: "internal", message: "Something went wrong on our side. Please try again." },
} as const satisfies Record<string, ErrorDefinition>;

export type ErrorCode = keyof typeof ERROR_DEFINITIONS;

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && value in ERROR_DEFINITIONS;
}

export function getErrorDefinition(code: ErrorCode): ErrorDefinition {
  return ERROR_DEFINITIONS[code];
}

/** Best-fit code for a bare HTTP status (used for legacy errors that only carry a status). */
export function errorCodeFromStatus(status: number): ErrorCode {
  if (status === 400 || status === 422) return "VALIDATION_ERROR";
  if (status === 401) return "AUTH_TOKEN_INVALID";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "NOT_FOUND";
  if (status === 409) return "CONFLICT";
  if (status === 413) return "FILE_TOO_LARGE";
  if (status === 415) return "FILE_TYPE_UNSUPPORTED";
  if (status === 429) return "RATE_LIMITED";
  if (status === 504) return "UPSTREAM_TIMEOUT";
  return "INTERNAL_ERROR";
}

/**
 * Shape of every error body returned by the API.
 * `error` stays a plain user-facing string so existing `err.response.data.error` reads keep working.
 */
export interface ApiErrorBody {
  success: false;
  error: string;
  /** Short heading for the error when one is known (e.g. Meta's "24-Hour Messaging Window Expired"). */
  title?: string;
  code: ErrorCode;
  source: ErrorSource;
  status: number;
  requestId: string;
  retryable: boolean;
  details?: Record<string, unknown>;
  /** Development only: where the error was thrown and what the underlying error said. */
  debug?: {
    message: string;
    origin?: string;
    cause?: string;
    stack?: string[];
  };
}
