import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest, assertPagePermission } from "@/lib/security/auth";
import { canUser } from "@/lib/security/permissions";
import { AppError } from "@/lib/errors";
import { readFormData } from "@/lib/api/handler";
import { validateWhatsAppMedia } from "@/lib/media-limits";
import { putObject } from "@/lib/storage/s3";
import { automationMediaPrefix, type AutomationMedia } from "@/lib/automation/media";
import { createLogger } from "@/lib/logger";

const log = createLogger("api.automations.media");

/** Extension for the S3 key, from the file name when it has a plain one. */
const extensionOf = (filename: string) => {
  const ext = filename.includes(".") ? filename.split(".").pop()!.toLowerCase() : "";
  return /^[a-z0-9]{1,8}$/.test(ext) ? `.${ext}` : "";
};

/**
 * POST /api/automations/media (multipart: file)
 * Stores a Send Message step's attachment in S3 and returns what the step saves as `media`.
 * Each run reads the file back and uploads it to Meta, so the step keeps working past Meta's 30-day media expiry.
 */
export const POST = withAuth(async (req: AuthenticatedRequest) => {
  // Attaching happens while building a new automation or editing an existing one
  if (!canUser(req.user, "flows", "create")) assertPagePermission(req.user, "flows", "update");

  const formData = await readFormData(req);
  const file = formData.get("file");
  if (!file || typeof file === "string") throw AppError.validation("Choose a file to attach.", "file");

  const check = validateWhatsAppMedia(file);
  if (!check.ok) throw new AppError(check.code, { message: check.message, expected: true });

  const organizationId = req.user.organizationId;
  const key = `${automationMediaPrefix(organizationId)}${crypto.randomUUID()}${extensionOf(file.name)}`;
  await putObject(key, Buffer.from(await file.arrayBuffer()), check.mimeType);
  log.info("Automation media stored", { organizationId, key, mimeType: check.mimeType, bytes: file.size });

  const media: AutomationMedia = { key, filename: file.name || "file", mimeType: check.mimeType, kind: check.kind, size: file.size };
  return NextResponse.json({ success: true, data: media });
});
