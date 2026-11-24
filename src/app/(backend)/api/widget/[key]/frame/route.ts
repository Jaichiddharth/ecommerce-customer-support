import { randomBytes } from "node:crypto";
import { aiWidgetService } from "@/lib/services";
import { frameAncestors, widgetFrameHtml } from "@/lib/ai-agent/widget-assets";

type Ctx = { params: Promise<{ key: string }> };

/** GET /api/widget/<key>/frame: the chat inside the widget's iframe; only embeddable on the allowed sites */
export async function GET(_req: Request, context: Ctx) {
  const { key } = await context.params;
  const live = await aiWidgetService.liveWidget(key).catch(() => null);
  if (!live) {
    return new Response("This chat isn't available.", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
  const nonce = randomBytes(16).toString("base64");
  const html = widgetFrameHtml({ config: aiWidgetService.publicConfig(live.settings), key, preview: false, nonce });
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": [
        "default-src 'none'",
        `script-src 'nonce-${nonce}'`,
        "style-src 'unsafe-inline'",
        "img-src https: data:",
        "connect-src 'self'",
        "base-uri 'none'",
        "form-action 'none'",
        `frame-ancestors ${frameAncestors(live.settings.allowedDomains)}`,
      ].join("; "),
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
