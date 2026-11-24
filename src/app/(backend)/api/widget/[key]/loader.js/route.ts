import { aiWidgetService } from "@/lib/services";
import { widgetLoaderJs } from "@/lib/ai-agent/widget-assets";
import { appOrigin } from "@/lib/ai-agent/widget-origin";

type Ctx = { params: Promise<{ key: string }> };

/** GET /api/widget/<key>/loader.js: the script a business pastes on its site (public, cached briefly) */
export async function GET(req: Request, context: Ctx) {
  const { key } = await context.params;
  const live = await aiWidgetService.liveWidget(key).catch(() => null);
  const js = widgetLoaderJs(appOrigin(req), key, live ? aiWidgetService.publicConfig(live.settings) : null);
  return new Response(js, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
