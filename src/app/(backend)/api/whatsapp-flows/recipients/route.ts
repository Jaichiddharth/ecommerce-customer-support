import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest } from "@/lib/security/auth";
import { customerRepository } from "@/lib/db/repositories";

// GET /api/whatsapp-flows/recipients?q= — WhatsApp contacts to send a Flow to (read-only search)
export const GET = withAuth(async (req: AuthenticatedRequest) => {
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return NextResponse.json({ success: true, recipients: [] });
  const rows = await customerRepository.searchVisible(req.user.organizationId, q, 20);
  const recipients = rows
    .filter((c) => c.phone && (!c.channel || c.channel.type === "whatsapp"))
    .map((c) => ({ id: c.id, name: c.name, phone: c.phone, channelName: c.channel?.name ?? null }));
  return NextResponse.json({ success: true, recipients });
});
