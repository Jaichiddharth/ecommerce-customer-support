import { NextResponse } from "next/server";
import { channels } from "@/lib/services";
import { withAuth, AuthenticatedRequest } from "@/lib/security/auth";

export const GET = withAuth(async (req: AuthenticatedRequest) => {
  const { searchParams } = new URL(req.url);
  const phoneNumberId = searchParams.get("phoneNumberId") || undefined;
  const orgId = req.user.organizationId;

  const details = await channels.whatsapp.getMetaDetails(phoneNumberId, orgId);

  return NextResponse.json({
    success: true,
    ...details,
  });
});
