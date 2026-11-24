/**
 * Server-side client for the Python AI service (ai-service/). Never import this from client
 * components: it reads the service token.
 *
 * Env: UNOCX_AI_URL (e.g. http://localhost:8000) and UNOCX_AI_TOKEN (= SERVICE_TOKEN of the service).
 */
import { AppError } from "@/lib/errors";
import { createLogger } from "@/lib/logger";

const log = createLogger("ai-service");

type Query = Record<string, string | number | boolean | undefined | null>;

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  query?: Query;
  body?: unknown;
  form?: FormData;
  timeoutMs?: number;
}

function config() {
  const url = process.env.UNOCX_AI_URL?.replace(/\/+$/, "");
  const token = process.env.UNOCX_AI_TOKEN;
  if (!url || !token) {
    throw new AppError("AI_SERVICE_NOT_CONFIGURED", {
      expected: true,
      details: { hint: "Set UNOCX_AI_URL and UNOCX_AI_TOKEN in the Next.js environment." },
    });
  }
  return { url, token };
}

/** Workspace id used by the AI service for an organisation. */
export const workspaceIdFor = (organizationId: number) => `org_${organizationId}`;

export async function aiRequest<T = any>(path: string, options: RequestOptions = {}): Promise<T> {
  const { url, token } = config();
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(options.query ?? {})) {
    if (v !== undefined && v !== null) qs.set(k, String(v));
  }
  const target = `${url}${path}${qs.size ? `?${qs}` : ""}`;
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  let body: BodyInit | undefined;
  if (options.form) {
    body = options.form;
  } else if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }

  let res: Response;
  try {
    res = await fetch(target, {
      method: options.method ?? (body ? "POST" : "GET"),
      headers,
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(options.timeoutMs ?? 20_000),
    });
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    throw new AppError(timedOut ? "UPSTREAM_TIMEOUT" : "AI_SERVICE_UNAVAILABLE", {
      cause: err,
      source: "ai",
      message: timedOut ? "The AI agent took too long to respond. Please try again." : undefined,
    });
  }

  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!res.ok) {
    const detail = typeof data?.detail === "string" ? data.detail : Array.isArray(data?.detail) ? data.detail[0]?.msg : undefined;
    log.warn(`${res.status} from AI service`, { where: path, detail });
    if (res.status === 404) throw AppError.notFound(capitalise(detail) || "Not found.");
    if (res.status === 409) throw new AppError("CONFLICT", { message: capitalise(detail), expected: true });
    if (res.status === 413) throw new AppError("FILE_TOO_LARGE", { message: capitalise(detail), expected: true });
    if (res.status === 422 || res.status === 400) throw AppError.validation(capitalise(detail) || "Invalid request.");
    if (res.status === 401) throw new AppError("AI_SERVICE_NOT_CONFIGURED", { message: "The AI agent service rejected the server's token (check UNOCX_AI_TOKEN)." });
    throw new AppError(res.status >= 500 && res.status !== 501 ? "AI_SERVICE_UNAVAILABLE" : "AI_SERVICE_ERROR", {
      details: detail ? { detail } : undefined,
    });
  }
  return data as T;
}

function capitalise(s?: string) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) + (/[.!?]$/.test(s) ? "" : ".") : undefined;
}
