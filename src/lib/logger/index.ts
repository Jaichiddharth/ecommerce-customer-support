import pino from "pino";
import { prettyFactory } from "pino-pretty";
import { toAppError } from "../errors/normalize";
import { getRequestContext } from "./context";
import { REDACT_PATHS, redactUrl } from "./redact";
import { appStack, callerLocation } from "./stack";

/**
 * Server logger: pino (https://getpino.io), printed with pino-pretty.
 *
 *   const log = createLogger("WhatsAppService");
 *   log.info("Message sent", { messageId: 12 });
 *   log.error("Failed to send message", { err, customerId: 7 });
 *
 * createLogger() returns a pino child logger, set up only through pino's own options:
 *  - mixin            request id, route, user and organisation on every line of a request (context.ts)
 *  - hooks.logMethod  accepts log.info("message", { context }) (pino's own order is the reverse) and,
 *                     in development, adds the calling file:line as `where` (stack.ts)
 *  - redact           hides secret fields (redact.ts)
 *  - serializers.err  pino's standard error serializer, applied after converting the error to an AppError
 *
 * Env:
 *   LOG_LEVEL  = error | warn | info | http | debug   (default: debug in development, http in production)
 *   LOG_FORMAT = pretty | json                        (default: pretty)
 */

type LogLevel = "error" | "warn" | "info" | "http" | "debug";

/** Our call style, log.info("message", { context }), next to pino's own log.info({ context }, "message"). */
type LogCall = ((message: string, context?: unknown) => void) & pino.LogFn;

/** What createLogger() returns: a pino logger that also accepts our call style. */
export type Logger = Omit<pino.Logger<"http">, LogLevel | "child"> &
  Record<LogLevel, LogCall> & { child(bindings: pino.Bindings): Logger };

const LOG_LEVELS: readonly LogLevel[] = ["error", "warn", "info", "http", "debug"];
const isProduction = process.env.NODE_ENV === "production";
const envLevel = process.env.LOG_LEVEL?.toLowerCase() as LogLevel | undefined;
const level: LogLevel = envLevel && LOG_LEVELS.includes(envLevel) ? envLevel : isProduction ? "http" : "debug";
const jsonFormat = process.env.LOG_FORMAT?.toLowerCase() === "json";

/* Readable output ------------------------------------------------------ */

// Colours only on a terminal: pino-pretty's own check always says yes on Windows, even when writing to a file
const forceColor = Boolean(process.env.FORCE_COLOR) && process.env.FORCE_COLOR !== "0";
const colorize = process.env.NO_COLOR === undefined && (forceColor || Boolean(process.stdout?.isTTY));

const prettify = prettyFactory({
  colorize,
  translateTime: "SYS:yyyy-mm-dd HH:MM:ss.l",
  messageFormat: "{if requestId}[{requestId}] {end}[{scope}] {if where}{where} {end}› {msg}",
  ignore: "pid,hostname,scope,where,requestId,route,userId,orgId",
  singleLine: true,
  customLevels: "http:25",
  customColors: "http:magenta,message:reset",
  useOnlyCustomProps: false,
});

/**
 * Pretty lines are printed with console.log / warn / error rather than straight to stdout: they are
 * written immediately, stay in order with Next.js' own output, and `next dev` also records them in
 * .next/dev/logs/next-development.log.
 */
const prettyConsole = {
  write(line: string) {
    const entry = JSON.parse(line);
    const text = prettify(entry).trimEnd();
    if (entry.level >= 50) console.error(text);
    else if (entry.level >= 40) console.warn(text);
    else console.log(text);
  },
};

/* Errors --------------------------------------------------------------- */

function serializeError(value: Error) {
  // Axios / Postgres / Firebase errors become AppErrors first, so code, provider and details are logged
  const error = toAppError(value);
  // An AppError made here would only list the logger's own frames; the original stack follows as "caused by"
  if (error !== value) error.stack = `${error.name}: ${error.message}`;
  const serialized = pino.stdSerializers.err(error);
  // Class names are minified in production builds, and pino treats any object with a `message` as an
  // error, so the type name and the plain `details` / `provider` objects are set directly
  Object.assign(serialized, {
    type: error.name,
    name: undefined,
    details: error.details,
    provider: error.provider && { ...error.provider, url: redactUrl(error.provider.url) },
  });
  // Drizzle's error message lists the query's values, which can be customer data: hide them
  for (let e: unknown = value, depth = 0; e instanceof Error && depth < 6; e = (e as Error).cause, depth++) {
    const params = (e as { params?: unknown }).params;
    if (Array.isArray(params) && params.length) {
      const values = `\nparams: ${params}`;
      serialized.message = serialized.message.replaceAll(values, "\nparams: [hidden]");
      serialized.stack = serialized.stack.replaceAll(values, "\nparams: [hidden]");
    }
  }
  // `next dev` stacks point into bundled chunks: show our src/ files instead
  if (!isProduction) serialized.stack = appStack(serialized.stack);
  return serialized;
}

/* Logger --------------------------------------------------------------- */

/** The context object of a log call; log.error("…", err) logs the error as `err`. */
function toContext(meta: unknown): Record<string, unknown> {
  if (meta === undefined || meta === null) return {};
  if (meta instanceof Error) return { err: meta };
  if (typeof meta === "object") return meta as Record<string, unknown>;
  return { value: meta };
}

const rootLogger = pino<"http">(
  {
    level,
    // between debug (20) and info (30): request summary lines are hidden at LOG_LEVEL=info
    customLevels: { http: 25 },
    timestamp: pino.stdTimeFunctions.isoTime,
    // JSON gets level names ("info"); pino-pretty needs pino's level numbers
    formatters: jsonFormat ? { level: (label) => ({ level: label }) } : {},
    mixin() {
      const request = getRequestContext();
      if (!request) return {};
      const { requestId, method, path, userId, orgId } = request;
      return { requestId, route: `${method} ${path}`, userId, orgId };
    },
    redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
    serializers: { err: (value: unknown) => (value instanceof Error ? serializeError(value) : value) },
    hooks: {
      logMethod(args, method) {
        const [first, second, ...rest] = args as unknown[];
        const [message, meta] = typeof first === "string" ? [first, second] : [second, first];
        const context = toContext(meta);
        const where = context.where ?? (isProduction ? undefined : callerLocation());
        const text = message ?? (meta instanceof Error ? meta.message : undefined);
        method.apply(this, [{ ...context, where }, text, ...rest] as unknown as Parameters<pino.LogFn>);
      },
    },
  },
  jsonFormat ? pino.destination({ sync: true }) : prettyConsole
);

/** Logger for one module; the scope name appears on every line, e.g. createLogger("WhatsAppService"). */
export function createLogger(scope: string): Logger {
  return rootLogger.child({ scope }) as unknown as Logger;
}

export { errorOrigin } from "./stack";
export { generateRequestId, getRequestContext, runWithRequestContext, setRequestContext } from "./context";
