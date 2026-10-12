/**
 * Next.js instrumentation: last-resort capture for errors that never reach `apiHandler`
 * (server component render errors, module-load failures such as a missing DATABASE_URL, …).
 * API route errors are already logged by apiHandler, so they don't show up here twice.
 */

export async function register() {}

export async function onRequestError(
  err: unknown,
  request: { path: string; method: string },
  context: { routePath: string; routeType: string; renderSource?: string }
) {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const [{ createLogger }, { redactUrl }] = await Promise.all([import("./lib/logger"), import("./lib/logger/redact")]);
  createLogger("next").error(`Unhandled ${context.routeType} error`, {
    err,
    where: `${request.method} ${redactUrl(request.path)}`,
    routePath: context.routePath,
    ...(context.renderSource ? { renderSource: context.renderSource } : {}),
  });
}
