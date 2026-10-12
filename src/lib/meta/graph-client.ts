import axios from "axios";
import { AppError, fromAxiosError, fromMetaErrorBody } from "../errors";
import { createLogger } from "../logger";
import { redactUrl } from "../logger/redact";

/**
 * Transport for every Meta Graph API call.
 * - logs each call once (operation, method, path, status, duration, Meta error code, fbtrace_id)
 * - converts failures into AppErrors (META_*, MESSAGE_*, WHATSAPP_*, FILE_UPLOAD_FAILED…)
 * This file is treated as infrastructure by the logger, so error origins point at the caller.
 */

export const GRAPH_BASE_URL = "https://graph.facebook.com";
export const GRAPH_VERSION = process.env.GRAPH_VERSION || process.env.META_GRAPH_VERSION || "v21.0";

const log = createLogger("MetaApi");

declare module "axios" {
  interface AxiosRequestConfig {
    /** Graph operation name shown in logs, e.g. "whatsapp.send_text". */
    operation?: string;
    /** performance.now() at request start (set by the interceptor). */
    startedAt?: number;
  }
}

const elapsed = (startedAt?: number) => (startedAt ? Math.round(performance.now() - startedAt) : undefined);

export const graphHttp = axios.create({
  baseURL: `${GRAPH_BASE_URL}/${GRAPH_VERSION}`,
  timeout: 30_000,
});

graphHttp.interceptors.request.use((config) => {
  config.startedAt = performance.now();
  return config;
});

graphHttp.interceptors.response.use(
  (response) => {
    const { config } = response;
    const wamid = response.data?.messages?.[0]?.id;
    log.http(`${config.method?.toUpperCase()} ${redactUrl(config.url)} → ${response.status} · ${elapsed(config.startedAt)}ms`, {
      where: `meta:${config.operation ?? "request"}`,
      ...(wamid ? { wamid } : {}),
    });
    return response;
  },
  (error: unknown) => {
    if (!axios.isAxiosError(error)) throw error;
    const appError = fromAxiosError(error);
    logFailure(appError, error.config?.operation, redactUrl(error.config?.url));
    throw appError;
  }
);

function logFailure(appError: AppError, operation: string | undefined, path: string | undefined) {
  const p = appError.provider;
  log.warn(`${p?.method ?? ""} ${path ?? ""} → ${p?.httpStatus ?? p?.code ?? "no response"} · ${p?.durationMs ?? "?"}ms`.trim(), {
    where: `meta:${operation ?? "request"}`,
    code: appError.code,
    ...(p?.code !== undefined ? { metaCode: p.code } : {}),
    ...(p?.traceId ? { fbtrace: p.traceId } : {}),
    ...(p?.message ? { metaMessage: p.message } : {}),
  });
}

/** multipart/form-data POST (media upload) via fetch, with the same logging and error mapping as graphHttp. */
export async function graphUpload<T = any>(operation: string, path: string, form: FormData, accessToken: string): Promise<T> {
  const url = `${GRAPH_BASE_URL}/${GRAPH_VERSION}${path}`;
  const startedAt = performance.now();

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
      body: form,
      signal: AbortSignal.timeout(120_000),
    });
  } catch (err) {
    const timedOut = (err as Error)?.name === "TimeoutError";
    const appError = new AppError("META_UNAVAILABLE", {
      message: timedOut ? "WhatsApp (Meta) did not respond in time. Please try again." : undefined,
      provider: { name: "meta", method: "POST", url, operation, durationMs: elapsed(startedAt), message: (err as Error)?.message },
      cause: err,
    });
    logFailure(appError, operation, path);
    throw appError;
  }

  const data = await response.json().catch(() => null);
  if (!response.ok || data?.error) {
    const appError = fromMetaErrorBody(response.status, data, { method: "POST", url, operation, durationMs: elapsed(startedAt) });
    logFailure(appError, operation, path);
    throw appError;
  }

  log.http(`POST ${path} → ${response.status} · ${elapsed(startedAt)}ms`, { where: `meta:${operation}` });
  return data as T;
}

/** Authenticated GET of a binary from Meta's CDN; returns the streaming Response. */
export async function graphDownload(operation: string, downloadUrl: string, accessToken: string): Promise<Response> {
  const startedAt = performance.now();
  const safeUrl = redactUrl(downloadUrl);

  let response: Response;
  try {
    response = await fetch(downloadUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
  } catch (err) {
    const appError = new AppError("META_UNAVAILABLE", {
      provider: { name: "meta", method: "GET", url: safeUrl, operation, durationMs: elapsed(startedAt), message: (err as Error)?.message },
      cause: err,
    });
    logFailure(appError, operation, safeUrl);
    throw appError;
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const appError =
      response.status === 404
        ? new AppError("MEDIA_NOT_FOUND", { provider: { name: "meta", httpStatus: 404, method: "GET", url: safeUrl, operation }, expected: true })
        : fromMetaErrorBody(response.status, body, { method: "GET", url: safeUrl, operation, durationMs: elapsed(startedAt) });
    logFailure(appError, operation, safeUrl);
    throw appError;
  }

  log.http(`GET media → ${response.status} · ${elapsed(startedAt)}ms`, { where: `meta:${operation}` });
  return response;
}
