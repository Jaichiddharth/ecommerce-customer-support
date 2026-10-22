import { NextResponse } from "next/server";
import { channels } from "@/lib/services";
import { channelRepository } from "@/lib/db/repositories/channel.repository";
import { withAuth, AuthenticatedRequest } from "@/lib/security/auth";
import { AppError } from "@/lib/errors";
import { ChannelStatus } from "@/lib/db/schema";
import { publish } from "@/lib/realtime";

// DELETE /api/channels/:id — disconnect a channel at the provider and soft-delete it locally.
// The row is kept so its conversations stay readable; it is hidden everywhere else.
export const DELETE = withAuth(async (req: AuthenticatedRequest, context?: { params: Promise<{ id: string }> }) => {
  const { id } = await context!.params;
  const channelId = parseInt(id, 10);

  if (isNaN(channelId)) {
    throw AppError.validation("Invalid channel ID", "id");
  }

  const channel = await channels.getById(channelId, req.user.organizationId);
  if (!channel || channel.status === ChannelStatus.DISCONNECTED) {
    throw AppError.notFound("Channel not found.");
  }

  let meta: { metaUnsubscribed: boolean; metaSkippedReason?: string } = { metaUnsubscribed: false };
  if (channel.type === "whatsapp") {
    meta = await channels.whatsapp.disconnect(channel);
  } else {
    await channelRepository.markDisconnected(channel.id, channel.organizationId);
    publish(channel.organizationId, { type: "channel.updated", channelId: channel.id });
  }

  return NextResponse.json({
    success: true,
    message: "Channel disconnected successfully",
    ...meta,
  });
});
