import { NextResponse } from "next/server";
import { channels } from "@/lib/services";
import { withAuth, AuthenticatedRequest } from "@/lib/security/auth";
import { AppError } from "@/lib/errors";
import { ChannelStatus } from "@/lib/db/schema";
import { readJson } from "@/lib/api/handler";

type Context = { params: Promise<{ id: string }> };

/** A live WhatsApp channel of the caller's organization */
async function requireWhatsAppChannel(req: AuthenticatedRequest, context?: Context) {
  const { id } = await context!.params;
  const channelId = parseInt(id, 10);
  if (isNaN(channelId)) throw AppError.validation("Invalid channel ID", "id");

  const channel = await channels.getById(channelId, req.user.organizationId);
  if (!channel || channel.type !== "whatsapp" || channel.status === ChannelStatus.DISCONNECTED) {
    throw AppError.notFound("WhatsApp number not found.");
  }
  return channel;
}

// GET /api/channels/:id/whatsapp-profile — live number health and business profile from Meta
export const GET = withAuth(async (req: AuthenticatedRequest, context?: Context) => {
  const channel = await requireWhatsAppChannel(req, context);
  const { phone, profile } = await channels.whatsapp.getNumberSettings(channel);
  return NextResponse.json({ success: true, phone, profile });
});

// PATCH /api/channels/:id/whatsapp-profile  { about?, address?, description?, email?, vertical?, websites? }
export const PATCH = withAuth(async (req: AuthenticatedRequest, context?: Context) => {
  const channel = await requireWhatsAppChannel(req, context);
  const body = (await readJson(req)) ?? {};
  if (typeof body !== "object" || Array.isArray(body)) throw AppError.validation("Invalid profile.");

  const profile = await channels.whatsapp.updateBusinessProfile(channel, body);
  return NextResponse.json({ success: true, profile });
});
