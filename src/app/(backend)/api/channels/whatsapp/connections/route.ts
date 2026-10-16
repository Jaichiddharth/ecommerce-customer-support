import { NextResponse } from "next/server";
import { channels } from "@/lib/services";
import { withAuth, AuthenticatedRequest } from "@/lib/security/auth";

export const GET = withAuth(async (req: AuthenticatedRequest) => {
  const orgId = req.user.organizationId;

  const waConnections = await channels.whatsapp.getConnections(orgId);

  const formatted = waConnections.map((c) => ({
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
    hasConnection: formatted.length > 0,
    connections: formatted,
    count: formatted.length,
  });
});
