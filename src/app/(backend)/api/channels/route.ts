import { NextResponse } from "next/server";
import { channels } from "@/lib/services";
import { withAuth, AuthenticatedRequest } from "@/lib/security/auth";

export const GET = withAuth(async (req: AuthenticatedRequest) => {
  const { searchParams } = new URL(req.url);
  const orgId = req.user.organizationId;
  const type = searchParams.get("type") || undefined;

  const list = await channels.list(orgId, type);

  const formatted = list.map((c) => ({
    id: c.id,
    organizationId: c.organizationId,
    type: c.type,
    verified_name: c.name,
    phoneNumber: c.phoneNumber,
    metaPhoneNumberId: c.metaPhoneNumberId,
    wabaId: c.wabaId,
    isActive: c.isActive,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  }));

  return NextResponse.json({
    success: true,
    channels: formatted,
    count: formatted.length,
  });
});
