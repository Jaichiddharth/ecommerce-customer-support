import { NextResponse } from "next/server";
import { channels } from "@/lib/services";
import { withAuth, AuthenticatedRequest } from "@/lib/security/auth";
import { AppError } from "@/lib/errors";
import { readJson } from "@/lib/api/handler";

export const POST = withAuth(async (req: AuthenticatedRequest) => {
  const body = await readJson(req);
  const { code, wabaId, phoneNumberId } = body ?? {};

  if (!code) {
    throw AppError.validation("Meta authorization code is required. Please complete the WhatsApp sign-up popup.", "code");
  }

  const orgId = req.user.organizationId;

  const result = await channels.whatsapp.connect({
    code,
    wabaId,
    phoneNumberId,
    organizationId: orgId,
  });

  return NextResponse.json({
    success: true,
    message: "WhatsApp channel connected and stored successfully.",
    connection: {
      id: result.channel.id,
      organizationId: result.channel.organizationId,
      type: result.channel.type,
      name: result.channel.name,
      phoneNumber: result.channel.phoneNumber,
      metaPhoneNumberId: result.channel.metaPhoneNumberId,
      isActive: result.channel.isActive,
      createdAt: result.channel.createdAt,
    },
    wabaId: result.wabaId,
    phoneNumberId: result.phoneNumberId,
    phoneData: result.phoneData,
  });
});
