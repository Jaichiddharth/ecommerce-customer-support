import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { aiWidgetService } from "@/lib/services";

type Ctx = { params: Promise<{ key: string }> };

/** GET /api/widget/<key>/messages?visitor=<id>&after=<message id>: new lines of the visitor's chat (public; polled) */
export const GET = apiHandler<Ctx>(async (req, context) => {
  const key = (await context?.params)?.key ?? "";
  const url = new URL(req.url);
  const after = Number(url.searchParams.get("after") ?? 0);
  const thread = await aiWidgetService.visitorMessages(key, url.searchParams.get("visitor"), Number.isFinite(after) ? after : 0);
  return NextResponse.json({ success: true, ...thread }, { headers: { "Cache-Control": "no-store" } });
});
