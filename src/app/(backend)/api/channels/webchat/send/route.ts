import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest, assertPagePermission } from "@/lib/security/auth";
import { readJson } from "@/lib/api/handler";
import { webchatService } from "@/lib/services/channels/webchat.service";

/** POST /api/channels/webchat/send { channelId, customerId, text, repliedToId? }: a teammate's reply to a website visitor */
export const POST = withAuth(async (req: AuthenticatedRequest) => {
  assertPagePermission(req.user, "inbox", "update");
  const body = await readJson(req);
  const message = await webchatService.sendAgentMessage(req.user, body);
  return NextResponse.json({ success: true, message }, { status: 201 });
});
