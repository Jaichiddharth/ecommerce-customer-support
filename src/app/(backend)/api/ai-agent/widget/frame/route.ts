import { randomBytes } from "node:crypto";
import { withAuth, AuthenticatedRequest, assertPagePermission } from "@/lib/security/auth";
import { widgetFrameHtml } from "@/lib/ai-agent/widget-assets";
import { DEFAULT_WIDGET, publicWidgetConfig } from "@/lib/ai-agent/widget";

/** GET /api/ai-agent/widget/frame: the widget chat for the dashboard preview (settings arrive by postMessage) */
export const GET = withAuth(async (req: AuthenticatedRequest) => {
  assertPagePermission(req.user, "ai", "read");
  const nonce = randomBytes(16).toString("base64");
  const html = widgetFrameHtml({ config: publicWidgetConfig(DEFAULT_WIDGET), key: null, preview: true, nonce });
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src https: data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'`,
      "X-Content-Type-Options": "nosniff",
    },
  });
});
