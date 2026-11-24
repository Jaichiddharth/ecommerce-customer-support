import { gooeyToast } from '@/components/ui/goey-toaster';
import type { ErrorSource } from '@/lib/errors/codes';
import { ApiError, toApiError } from './api-error';
import { clientLogger } from '../client-logger';

const TITLE_BY_SOURCE: Record<ErrorSource, string> = {
  validation: 'Please check your input',
  auth: 'Session problem',
  firebase: 'Sign-in problem',
  meta: 'WhatsApp (Meta) error',
  whatsapp: 'WhatsApp error',
  webhook: 'Webhook error',
  upload: 'File upload failed',
  shopify: 'Shopify error',
  woocommerce: 'WooCommerce error',
  database: 'Server problem',
  ai: 'AI agent error',
  network: 'Connection problem',
  internal: 'Something went wrong',
};

/** Toast title for an error, based on where it came from. */
export function errorTitle(err: ApiError): string {
  return TITLE_BY_SOURCE[err.source] ?? 'Something went wrong';
}

/** "Message · Ref req_…" — the reference lets support find the exact server log line. */
export function errorDescription(err: ApiError): string {
  return err.requestId ? `${err.message}  ·  Ref ${err.requestId}` : err.message;
}

/**
 * Show a user-friendly toast for any caught error and make sure it is logged once.
 *
 *   catch (err) { notifyError(err, { where: 'InboxView.handleSend', title: 'Message not sent' }); }
 *
 * Returns the normalised ApiError so callers can branch on `code` / `retryable`.
 */
export function notifyError(
  err: unknown,
  options: {
    where?: string;
    /** Used when the server didn't send a specific title. */
    title?: string;
    action?: { label: string; onClick: () => void };
  } = {}
): ApiError {
  const apiError = toApiError(err);
  if (apiError.isCancelled) return apiError;

  if (!apiError.logged) {
    clientLogger.error(options.where ?? 'ui', apiError.message, { ...apiError.toLogObject(), cause: apiError.cause });
    apiError.logged = true;
  }

  // A specific server-provided heading (e.g. "24-Hour Messaging Window Expired") beats the generic one
  gooeyToast.error(apiError.title ?? options.title ?? errorTitle(apiError), {
    description: errorDescription(apiError),
    ...(options.action ? { action: options.action } : {}),
  });
  return apiError;
}

/** Non-blocking warning toast (e.g. "delivered but not saved", "reaction not delivered"). */
export function notifyWarning(title: string, description?: string) {
  gooeyToast.warning(title, description ? { description } : undefined);
}
