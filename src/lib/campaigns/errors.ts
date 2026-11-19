import { toAppError } from "@/lib/errors";

/**
 * What a failed send means for the contact. The campaign itself never stops on a single error: it stops only
 * after 20 failures in a row (engine.ts, FAILURE_THRESHOLD), and the owner checks and resumes it. Whether an
 * outcome counts toward those 20 is `counts`.
 *
 * Meta error codes: https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes
 */
export type SendVerdict =
  /** Failed for this contact (any Meta or channel error, template/account problems included). Counts. */
  | { kind: "failed"; metaCode: number | null; message: string }
  /** Meta held the marketing message back (131049, healthy-ecosystem limit). Normal for marketing; doesn't count. */
  | { kind: "held"; metaCode: number | null; message: string }
  /** Not sent on purpose (opted out): skipped, sending continues. Doesn't count. */
  | { kind: "skip"; metaCode: number | null; message: string }
  /** Temporary Meta error (5xx): this contact is retried later; counts only once its retries are used up. */
  | { kind: "retry"; metaCode: number | null; message: string }
  /** Sending too fast: contact goes back in the queue for 30 s. Doesn't count (nothing is wrong). */
  | { kind: "throttle"; metaCode: number | null; message: string }
  /** No response from Meta: the message may have been sent, so it's never retried. Counts. */
  | { kind: "unknown"; metaCode: number | null; message: string };

/** Throughput (130429), too many messages to this user (131056), app/WABA rate limits (4, 80007) */
const THROTTLE_CODES = new Set([4, 80007, 130429, 131056]);
const META_HELD_BACK = 131049;

export function classifySendError(err: unknown): SendVerdict {
  const error = toAppError(err);
  const raw = error.provider?.name === "meta" ? Number(error.provider.code) : NaN;
  const metaCode = Number.isFinite(raw) ? raw : null;
  const message = error.message;

  if (error.code === "CONTACT_OPTED_OUT") return { kind: "skip", metaCode, message: "Contact opted out of messages" };
  if (metaCode === META_HELD_BACK) return { kind: "held", metaCode, message };
  if ((metaCode !== null && THROTTLE_CODES.has(metaCode)) || error.code === "RATE_LIMITED" || error.code === "META_RATE_LIMITED") {
    return { kind: "throttle", metaCode, message };
  }

  // No HTTP response from Meta (timeout, connection reset): the message may have been sent
  if (!error.provider?.httpStatus && (error.code === "UPSTREAM_TIMEOUT" || error.source === "network")) {
    return { kind: "unknown", metaCode, message };
  }

  // Meta answered with a temporary error (5xx, "service unavailable"): nothing was sent, safe to retry
  if (error.retryable) return { kind: "retry", metaCode, message };

  // Everything else fails this contact: invalid number, template paused/disabled, token expired, account
  // blocked, number disconnected, payment problem…
  return { kind: "failed", metaCode, message };
}

/** Outcomes that count toward the "20 failures in a row" stop */
export const countsAsFailure = (kind: SendVerdict["kind"]) => kind === "failed" || kind === "unknown" || kind === "retry";
