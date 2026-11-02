import { NextResponse } from "next/server";
import { channels } from "@/lib/services";
import { withAuth, AuthenticatedRequest } from "@/lib/security/auth";
import { AppError } from "@/lib/errors";
import { readFormData } from "@/lib/api/handler";
import { TEMPLATE_MEDIA_RULES, isMediaHeader } from "@/types/templates";

/**
 * POST /api/channels/whatsapp/templates/media (multipart: file, format=IMAGE|VIDEO|DOCUMENT, phoneNumberId?)
 * Uploads a sample header file to Meta and returns the handle for `example.header_handle`
 */
export const POST = withAuth(async (req: AuthenticatedRequest) => {
  const formData = await readFormData(req);
  const format = String(formData.get("format") || "");
  const phoneNumberId = formData.get("phoneNumberId") ? String(formData.get("phoneNumberId")) : undefined;
  const file = formData.get("file");

  if (!isMediaHeader(format)) {
    throw AppError.validation("Header format must be IMAGE, VIDEO or DOCUMENT", "format");
  }
  if (!file || typeof file === "string") {
    throw AppError.validation("Choose a file to upload", "file");
  }

  const rules = TEMPLATE_MEDIA_RULES[format];
  if (!rules.accept.includes(file.type)) {
    throw new AppError("FILE_TYPE_UNSUPPORTED", {
      message: `A ${format.toLowerCase()} header must be ${rules.label}.`,
      expected: true,
    });
  }
  if (file.size > rules.maxBytes) {
    throw new AppError("FILE_TOO_LARGE", { message: `A ${format.toLowerCase()} header must be ${rules.label}.`, expected: true });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const handle = await channels.whatsapp.uploadTemplateMedia(req.user.organizationId, buffer, file.type, phoneNumberId);

  return NextResponse.json({ success: true, data: { handle } });
});
