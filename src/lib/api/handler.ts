import { NextRequest, NextResponse } from "next/server";
import { AppError, toAppError, type ApiErrorBody } from "@/lib/errors";
import {
  createLogger,
  errorOrigin,
  generateRequestId,
  getRequestContext,
  runWithRequestContext,
} from "@/lib/logger";

const log = createLogger("api");
const isProduction = process.env.NODE_ENV === "production";

export type RouteHandler<C> = (req: NextRequest, context: C) => Promise<Response> | Response;

/**
 * Wraps every API route: one place that
 *  1. assigns a request id (echoed back in the `x-request-id` header and in error bodies),
 *  2. catches anything thrown below it and converts it with `toAppError`,
 *  3. logs the failure once, with route, status, code, origin and cause chain,
 *  4. returns the standard error body (`ApiErrorBody`),
 *  5. writes an access log line for successful requests.
 * Routes just `throw` — no try/catch needed.
 */
export function apiHandler<C = any>(handler: RouteHandler<C>) {
  return async (req: NextRequest, context: C): Promise<Response> => {
    const incomingId = req.headers.get("x-request-id");
    const requestId = incomingId && /^[\w.-]{6,64}$/.test(incomingId) ? incomingId : generateRequestId();
    const route = `${req.method} ${req.nextUrl.pathname}`;
    const startedAt = performance.now();

    return runWithRequestContext({ requestId, method: req.method, path: req.nextUrl.pathname }, async () => {
      let response: Response;
      let failure: AppError | undefined;

      try {
        response = await handler(req, context);
      } catch (err) {
        failure = toAppError(err);
        response = errorResponse(failure, requestId);
      }

      const durationMs = Math.round(performance.now() - startedAt);
      try {
        response.headers.set("x-request-id", requestId);
      } catch {
        // Some Response objects have immutable headers — the id is still in the logs
      }

      if (failure) {
        const level = failure.expected || failure.status < 500 ? "warn" : "error";
        log[level](`${failure.status} ${failure.code} · ${durationMs}ms`, { where: route, err: failure });
      } else {
        log.http(`${response.status} · ${durationMs}ms`, { where: route });
      }
      return response;
    });
  };
}

/** Build the standard JSON error response for an AppError. */
export function errorResponse(error: AppError, requestId = getRequestContext()?.requestId ?? generateRequestId()) {
  const body: ApiErrorBody = {
    success: false,
    error: error.message,
    ...(error.title ? { title: error.title } : {}),
    code: error.code,
    source: error.source,
    status: error.status,
    requestId,
    retryable: error.retryable,
    ...(error.details ? { details: error.details } : {}),
  };

  // In development, tell the UI where it failed and what the underlying error said
  if (!isProduction) {
    const causes: Error[] = [];
    for (let e = error.cause; e instanceof Error && causes.length < 5; e = (e as Error).cause) causes.push(e);
    // First line only: Drizzle puts the query's values on the next lines
    const firstLine = (e: Error) => e.message.split("\n")[0];
    body.debug = {
      message: error.provider?.message ?? (causes[0] ? firstLine(causes[0]) : error.message),
      origin: errorOrigin(error),
      cause: causes.map((e) => `${e.name}: ${firstLine(e)}`).join(" ← ") || undefined,
    };
  }

  return NextResponse.json(body, { status: error.status, headers: { "x-request-id": requestId } });
}

/** `req.json()` that fails with a clean 400 INVALID_JSON instead of a 500. */
export async function readJson<T = any>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch (err) {
    throw new AppError("INVALID_JSON", { cause: err, expected: true });
  }
}

/** `req.formData()` that fails with a clean 400 instead of a 500. */
export async function readFormData(req: Request): Promise<FormData> {
  try {
    return await req.formData();
  } catch (err) {
    throw new AppError("VALIDATION_ERROR", { message: "The upload could not be read. Please try again.", cause: err, expected: true });
  }
}
