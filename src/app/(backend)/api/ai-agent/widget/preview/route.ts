import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest, assertPagePermission } from "@/lib/security/auth";
import { readJson } from "@/lib/api/handler";
import { aiWidgetService } from "@/lib/services";

/** POST /api/ai-agent/widget/preview { settings, sessionId, messages }: the dashboard preview's chat (unsaved settings) */
export const POST = withAuth(async (req: AuthenticatedRequest) => {
  assertPagePermission(req.user, "ai", "read");
  return NextResponse.json({ success: true, ...(await aiWidgetService.previewChat(req.user, await readJson(req))) });
});
