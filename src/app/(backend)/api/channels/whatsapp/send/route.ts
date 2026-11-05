import { NextResponse } from "next/server";
import { channels } from "@/lib/services";
import { withAuth, AuthenticatedRequest, assertPagePermission, hasPermission } from "@/lib/security/auth";
import { organizationRepository } from "@/lib/db/repositories";
import { AppError } from "@/lib/errors";
import { readFormData, readJson } from "@/lib/api/handler";

export const POST = withAuth(async (req: AuthenticatedRequest) => {
  assertPagePermission(req.user, "inbox", "update");
  const orgId = req.user.organizationId;

  const contentType = req.headers.get("content-type") || "";

  let to: string = "";
  let text: string | undefined = undefined;
  let channelId: string | number | undefined = undefined;
  let customerId: string | number | undefined = undefined;
  let repliedToId: string | number | undefined = undefined;
  let phoneNumberId: string | undefined = undefined;
  let type: string | undefined = undefined;
  let mediaType: string | undefined = undefined;
  let templateName: string | undefined = undefined;
  let languageCode: string | undefined = undefined;
  let components: any = undefined;
  let mediaFile: Buffer | undefined = undefined;
  let mimeType: string | undefined = undefined;
  let filename: string | undefined = undefined;

  if (contentType.includes("multipart/form-data")) {
    const formData = await readFormData(req);
    to = String(formData.get("to") || "");
    text = formData.get("text") ? String(formData.get("text")) : undefined;
    channelId = formData.get("channelId") ? Number(formData.get("channelId")) : undefined;
    customerId = formData.get("customerId") ? Number(formData.get("customerId")) : undefined;
    repliedToId = formData.get("repliedToId") ? Number(formData.get("repliedToId")) : undefined;
    phoneNumberId = formData.get("phoneNumberId") ? String(formData.get("phoneNumberId")) : undefined;
    type = formData.get("type") ? String(formData.get("type")) : undefined;
    mediaType = formData.get("mediaType") ? String(formData.get("mediaType")) : undefined;
    templateName = formData.get("templateName") ? String(formData.get("templateName")) : undefined;
    languageCode = formData.get("languageCode") ? String(formData.get("languageCode")) : undefined;

    const fileField = formData.get("file");
    if (fileField && typeof fileField === "object" && "arrayBuffer" in fileField) {
      const file = fileField as File;
      const arrayBuffer = await file.arrayBuffer();
      mediaFile = Buffer.from(arrayBuffer);
      mimeType = file.type || "application/octet-stream";
      filename = file.name || "attachment";
    }
  } else {
    const body = (await readJson(req)) ?? {};
    to = body.to;
    text = body.text;
    channelId = body.channelId;
    customerId = body.customerId;
    repliedToId = body.repliedToId;
    phoneNumberId = body.phoneNumberId;
    type = body.type;
    mediaType = body.mediaType;
    templateName = body.templateName;
    languageCode = body.languageCode;
    components = body.components;
    mimeType = body.mimeType;
    filename = body.filename;
  }

  if (!to) {
    throw AppError.validation("Recipient phone number ('to') is required.", "to");
  }

  if (!text && !templateName && !mediaFile) {
    throw AppError.validation("Type a message, choose a template, or attach a file.", "text");
  }

  if (templateName) {
    const org = await organizationRepository.findById(orgId);
    if (!hasPermission(req.user.role, "send_templates_outside_24h", org?.rolePermissions as any)) {
      throw new AppError("FORBIDDEN", {
        message: "Your role does not have permission to send templates outside the 24-hour window.",
        expected: true,
      });
    }
  }

  const result = await channels.whatsapp.sendMessage({
    organizationId: orgId,
    channelId: channelId ? Number(channelId) : undefined,
    phoneNumberId: phoneNumberId ? String(phoneNumberId) : undefined,
    senderId: req.user.id,
    senderName: req.user.name,
    customerId: customerId ? Number(customerId) : undefined,
    repliedToId: repliedToId ? Number(repliedToId) : undefined,
    to: String(to),
    text: text ? String(text) : undefined,
    type: (type as any) || (mediaFile ? undefined : 'text'),
    mediaType: mediaType as any,
    mediaFile,
    mimeType,
    filename,
    templateName,
    languageCode,
    components,
  });

  return NextResponse.json({
    success: true,
    message: "WhatsApp message sent successfully via Meta Cloud API.",
    // false = delivered by WhatsApp but not saved to history (UI shows `warning`)
    persisted: result.persisted,
    warning: "warning" in result ? result.warning : undefined,
    data: result,
  });
});
