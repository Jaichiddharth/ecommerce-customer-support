import { NextResponse } from "next/server";
import { channels } from "@/lib/services";
import { withAuth, AuthenticatedRequest } from "@/lib/security/auth";
import { AppError } from "@/lib/errors";
import { readJson } from "@/lib/api/handler";

/**
 * POST /api/channels/whatsapp/templates/header-media { channelId, templateId }
 * Re-uploads a template's approved header sample to the sending number and returns its WhatsApp media id.
 */
export const POST = withAuth(async (req: AuthenticatedRequest) => {
  const orgId = req.user.organizationId;
  const body = (await readJson(req)) ?? {};
  const channelId = Number(body.channelId);
  if (!channelId) throw AppError.validation("Channel id is required.", "channelId");
  if (!body.templateId || typeof body.templateId !== "string") {
    throw AppError.validation("Template id is required.", "templateId");
  }

  const result = await channels.whatsapp.prepareTemplateHeaderMedia(orgId, channelId, body.templateId);
  return NextResponse.json({ success: true, data: result });
});
