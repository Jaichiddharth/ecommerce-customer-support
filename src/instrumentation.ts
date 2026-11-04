/**
 * Next.js instrumentation: last-resort capture for errors that never reach `apiHandler`
 * (server component render errors, module-load failures such as a missing DATABASE_URL, …).
 * API route errors are already logged by apiHandler, so they don't show up here twice.
 */

export async function register() {
  // In-process automation scheduler (delays, retries, Flow timeouts, crash recovery). Node runtime only,
  // never during `next build`; AUTOMATION_SCHEDULER=off disables it (e.g. when an external cron is used).
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (process.env.AUTOMATION_SCHEDULER === "off" || !process.env.DATABASE_URL) return;
  const { startAutomationScheduler } = await import("./lib/automation/scheduler");
  startAutomationScheduler();
}

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
