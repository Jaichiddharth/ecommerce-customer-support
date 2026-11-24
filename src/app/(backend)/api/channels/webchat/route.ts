import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest, assertPagePermission } from "@/lib/security/auth";
import { readJson } from "@/lib/api/handler";
import { aiWidgetService } from "@/lib/services";

/** GET /api/channels/webchat: the Website chat channel's widget settings, public key, stores and WhatsApp numbers */
export const GET = withAuth(async (req: AuthenticatedRequest) => {
  assertPagePermission(req.user, "inbox", "read");
  return NextResponse.json({ success: true, widget: await aiWidgetService.getWidget(req.user) });
});

/** POST /api/channels/webchat: adds the Website chat channel (or reconnects it) */
export const POST = withAuth(async (req: AuthenticatedRequest) => {
  assertPagePermission(req.user, "inbox", "create");
  return NextResponse.json({ success: true, widget: await aiWidgetService.connectChannel(req.user) }, { status: 201 });
});

/** PUT /api/channels/webchat { enabled, settings }: saves the widget */
export const PUT = withAuth(async (req: AuthenticatedRequest) => {
  assertPagePermission(req.user, "inbox", "update");
  return NextResponse.json({ success: true, widget: await aiWidgetService.saveWidget(req.user, await readJson(req)) });
});
