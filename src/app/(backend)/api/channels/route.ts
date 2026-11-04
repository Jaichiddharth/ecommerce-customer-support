import { NextResponse } from "next/server";
import { channels, customerService } from "@/lib/services";
import { withAuth, AuthenticatedRequest } from "@/lib/security/auth";
import { ChannelStatus } from "@/lib/db/schema";

export const GET = withAuth(async (req: AuthenticatedRequest) => {
  const { searchParams } = new URL(req.url);
  const orgId = req.user.organizationId;
  const type = searchParams.get("type") || undefined;

  const includeDisconnected = searchParams.get("includeDisconnected") !== "false";
  const [list, contactCounts] = await Promise.all([
    channels.list(orgId, type, { includeDisconnected }),
    customerService.contactCountsByChannel(orgId),
  ]);

  const formatted = list.map((c) => ({
    id: c.id,
    organizationId: c.organizationId,
    type: c.type,
    verified_name: c.name,
    handle: c.handle,
    phoneNumber: c.phoneNumber,
    metaPhoneNumberId: c.metaPhoneNumberId,
    wabaId: c.wabaId,
    // Disconnected channel stays disconnected; an expired token needs reconnect even if no webhook has flagged it
    status:
      c.status === ChannelStatus.DISCONNECTED
        ? ChannelStatus.DISCONNECTED
        : c.tokenExpiresAt && c.tokenExpiresAt.getTime() < Date.now()
        ? ChannelStatus.TOKEN_EXPIRED
        : c.status,
    tokenExpiresAt: c.tokenExpiresAt,
    lastError: c.lastError,
    isActive: c.isActive,
    // Contacts on the channel and how many opted out; disconnected channels' contacts are hidden, so 0
    contactCount: contactCounts.get(c.id)?.total ?? 0,
    optedOutCount: contactCounts.get(c.id)?.optedOut ?? 0,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  }));

  return NextResponse.json({
    success: true,
    channels: formatted,
    count: formatted.length,
  });
});
