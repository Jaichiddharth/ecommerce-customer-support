/**
 * Browser-side logger: same idea as the server logger, readable in DevTools.
 *
 *   clientLogger.error("InboxView.handleSend", "Message could not be sent", apiError);
 *
 * Prints: time · level · where · message, followed by the structured data (expandable in DevTools).
 * Browser stack traces point at bundled chunks, so the "where" label is passed explicitly.
 */

type ClientLogLevel = "error" | "warn" | "info" | "debug";

const isDev = process.env.NODE_ENV !== "production";

const LEVEL_STYLE: Record<ClientLogLevel, string> = {
  error: "background:#dc2626;color:#fff;font-weight:bold;padding:1px 6px;border-radius:3px",
  warn: "background:#d97706;color:#fff;font-weight:bold;padding:1px 6px;border-radius:3px",
  info: "background:#16a34a;color:#fff;font-weight:bold;padding:1px 6px;border-radius:3px",
  debug: "background:#2563eb;color:#fff;font-weight:bold;padding:1px 6px;border-radius:3px",
};

function time(): string {
  const d = new Date();
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

function print(level: ClientLogLevel, where: string, message: string, data?: unknown) {
  if (typeof window === "undefined") return;
  if (level === "debug" && !isDev) return;

  const sink = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  const header = `%c${level.toUpperCase()}%c ${time()} %c[${where}]%c ${message}`;
  const styles = [LEVEL_STYLE[level], "color:#64748b", "color:#0891b2;font-weight:bold", "color:inherit"];

  if (data === undefined) {
    sink(header, ...styles);
  } else {
    sink(header, ...styles, "\n", data);
  }
}

export const clientLogger = {
  error: (where: string, message: string, data?: unknown) => print("error", where, message, data),
  warn: (where: string, message: string, data?: unknown) => print("warn", where, message, data),
  info: (where: string, message: string, data?: unknown) => print("info", where, message, data),
  debug: (where: string, message: string, data?: unknown) => print("debug", where, message, data),
};
