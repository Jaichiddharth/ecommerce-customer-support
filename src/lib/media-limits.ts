/**
 * WhatsApp Cloud API media limits (shared by the inbox UI and the send route).
 * https://developers.facebook.com/docs/whatsapp/cloud-api/reference/media#supported-media-types
 */

export type WhatsAppMediaKind = "image" | "video" | "audio" | "document";

const MB = 1024 * 1024;

export const WHATSAPP_MEDIA_RULES: Record<WhatsAppMediaKind, { label: string; maxBytes: number; mimeTypes: string[] }> = {
  image: { label: "Images", maxBytes: 5 * MB, mimeTypes: ["image/jpeg", "image/png"] },
  video: { label: "Videos", maxBytes: 16 * MB, mimeTypes: ["video/mp4", "video/3gpp"] },
  audio: { label: "Audio files", maxBytes: 16 * MB, mimeTypes: ["audio/aac", "audio/amr", "audio/mpeg", "audio/mp4", "audio/ogg"] },
  document: {
    label: "Documents",
    maxBytes: 100 * MB,
    mimeTypes: [
      "application/pdf",
      "text/plain",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-powerpoint",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ],
  },
};

/** Accept attribute for <input type="file"> limited to what WhatsApp can deliver. */
export const WHATSAPP_ACCEPT_ATTRIBUTE = Object.values(WHATSAPP_MEDIA_RULES)
  .flatMap((r) => r.mimeTypes)
  .join(",");

export function mediaKindFromMime(mimeType?: string): WhatsAppMediaKind {
  const mime = (mimeType || "").toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "document";
}

export function formatBytes(bytes: number): string {
  if (bytes >= MB) return `${(bytes / MB).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} bytes`;
}

export type MediaValidationResult =
  | { ok: true; kind: WhatsAppMediaKind; mimeType: string }
  | { ok: false; code: "FILE_TOO_LARGE" | "FILE_TYPE_UNSUPPORTED"; message: string; kind: WhatsAppMediaKind };

export function validateWhatsAppMedia(file: { size: number; type?: string; name?: string }): MediaValidationResult {
  // Strip parameters such as "audio/ogg; codecs=opus"
  const mimeType = (file.type || "").split(";")[0].trim().toLowerCase();
  const kind = mediaKindFromMime(mimeType);
  const rule = WHATSAPP_MEDIA_RULES[kind];

  if (!mimeType || !rule.mimeTypes.includes(mimeType)) {
    const allowed = rule.mimeTypes.map((m) => m.split("/")[1].replace("vnd.openxmlformats-officedocument.", "")).join(", ");
    return {
      ok: false,
      code: "FILE_TYPE_UNSUPPORTED",
      kind,
      message: `${file.name ? `"${file.name}" ` : "This file "}(${mimeType || "unknown type"}) can't be sent on WhatsApp. Supported ${rule.label.toLowerCase()}: ${allowed}.`,
    };
  }

  if (file.size > rule.maxBytes) {
    return {
      ok: false,
      code: "FILE_TOO_LARGE",
      kind,
      message: `${file.name ? `"${file.name}"` : "This file"} is ${formatBytes(file.size)}. WhatsApp allows ${rule.label.toLowerCase()} up to ${formatBytes(rule.maxBytes)}.`,
    };
  }

  return { ok: true, kind, mimeType };
}
