import { NextResponse } from "next/server";
import { apiHandler, readJson } from "@/lib/api/handler";
import { aiWidgetService } from "@/lib/services";

type Ctx = { params: Promise<{ key: string }> };

/** POST /api/widget/<key>/chat { visitorId, text, page? }: a visitor's message, saved to the inbox (public, rate limited) */
export const POST = apiHandler<Ctx>(async (req, context) => {
  const key = (await context?.params)?.key ?? "";
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
  const thread = await aiWidgetService.visitorChat(key, await readJson(req), ip);
  return NextResponse.json({ success: true, ...thread }, { headers: { "Cache-Control": "no-store" } });
});
