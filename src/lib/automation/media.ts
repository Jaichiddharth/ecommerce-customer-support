import type { WhatsAppMediaKind } from "@/lib/media-limits";

/**
 * File attached to a Send Message step. The file lives in S3 under the organization's prefix and is
 * read back on every run, then uploaded to Meta by `sendMessage` like an inbox attachment — so the
 * conversation stores Meta's media id, never the S3 key.
 */
export interface AutomationMedia {
  /** S3 object key: organizations/{orgId}/automations/send-message/{uuid}.{ext} */
  key: string;
  filename: string;
  mimeType: string;
  kind: WhatsAppMediaKind;
  size: number;
}

export const automationMediaPrefix = (organizationId: number) => `organizations/${organizationId}/automations/send-message/`;

/** The step's attachment, if it has a well-formed one. */
export function automationMediaOf(d: Record<string, unknown>): AutomationMedia | null {
  const m = d.media as Partial<AutomationMedia> | null | undefined;
  if (!m || typeof m !== "object" || typeof m.key !== "string" || !m.key || typeof m.mimeType !== "string") return null;
  return m as AutomationMedia;
}
