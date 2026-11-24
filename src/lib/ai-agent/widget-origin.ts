/** Public origin of the app, for the widget's embed snippet and loader (behind proxies/tunnels too) */
export function appOrigin(req?: Request): string {
  const env = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL;
  if (env) return env.replace(/\/+$/, "");
  if (req) {
    const proto = req.headers.get("x-forwarded-proto")?.split(",")[0].trim();
    const host = req.headers.get("x-forwarded-host")?.split(",")[0].trim() || req.headers.get("host");
    if (host) return `${proto || new URL(req.url).protocol.replace(":", "")}://${host}`;
    return new URL(req.url).origin;
  }
  return "";
}
