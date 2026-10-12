/**
 * Source locations for logs (development only; pino has no caller detection of its own).
 *
 * `next dev` runs our code from bundled chunks (.next/…/chunks/*.js) and Next.js replaces
 * Error.prepareStackTrace, so raw stack frames point into those chunks. Node's source-map cache
 * (module.findSourceMap, filled by `next dev`) maps each position back to the original src/ file.
 */
import { findSourceMap } from "node:module";

interface Frame {
  fn?: string;
  file: string;
  line: number;
  column: number;
}

const FRAME_RE = /^\s*at\s+(?:async\s+)?(?:(.+?)\s+\()?(.*?):(\d+):(\d+)\)?\s*$/;
const LIBRARY_RE = /node_modules\/|^node:|^internal\/|\/next\/dist\//;
/** Files that log or wrap errors for others: never reported as the place where something happened. */
const INFRA_RE = /^src\/lib\/(logger|errors)\/|^src\/lib\/api\/handler\.ts$|^src\/lib\/meta\/graph-client\.ts$/;
const cwd = process.cwd().replace(/\\/g, "/").toLowerCase();

/** Parse one "at fn (file:line:col)" stack line; returns it only when it points into our own src/ code. */
function appFrame(text: string): Frame | undefined {
  const match = FRAME_RE.exec(text);
  if (!match) return undefined;
  let file = match[2];
  let line = Number(match[3]);
  let column = Number(match[4]);

  if (/[\\/]\.next[\\/]/.test(file)) {
    try {
      const origin = findSourceMap(file)?.findOrigin(line, column);
      if (origin && "fileName" in origin) ({ fileName: file, lineNumber: line, columnNumber: column } = origin);
    } catch {
      // no source map for this chunk
    }
  }

  file = file.replace(/\\/g, "/");
  try {
    file = decodeURIComponent(file);
  } catch {
    // keep the encoded path
  }
  file = file.replace(/^(file|turbopack):\/\/\/?/, "").replace(/\?.*$/, "");
  if (LIBRARY_RE.test(file)) return undefined;
  if (file.toLowerCase().startsWith(`${cwd}/`)) file = file.slice(cwd.length + 1);
  file = file.replace(/^\[project\]\//, "");
  if (!file.startsWith("src/")) file = /(?:^|\/)(src\/.+)$/.exec(file)?.[1] ?? "";
  if (!file) return undefined;

  const fn = match[1]?.replace(/^(?:Object|Module)\./, "").replace(/ \[as [^\]]+\]$/, "");
  return { fn: fn && fn !== "<anonymous>" ? fn : undefined, file, line, column };
}

/** "src/lib/x.ts:12 fn()" for the first frame of a stack that is our code and not logging/error plumbing. */
function firstAppLocation(stack: string | undefined): string | undefined {
  for (const text of (stack ?? "").split("\n")) {
    const frame = appFrame(text);
    if (frame && !INFRA_RE.test(frame.file)) return `${frame.file}:${frame.line}${frame.fn ? ` ${frame.fn}()` : ""}`;
  }
  return undefined;
}

/** The code that called the logger. */
export function callerLocation(): string | undefined {
  return firstAppLocation(new Error().stack);
}

/** Where an error really happened: the first line of our code in the deepest error of its cause chain. */
export function errorOrigin(err: unknown): string | undefined {
  const chain: Error[] = [];
  for (let e = err; e instanceof Error && chain.length < 6; e = (e as Error).cause) chain.unshift(e);
  for (const e of chain) {
    const origin = firstAppLocation(e.stack);
    if (origin) return origin;
  }
  return undefined;
}

/**
 * The same stack with bundle positions mapped to src/ files. Library frames are left out, and so are
 * logging/error plumbing frames unless the stack has nothing else of ours (a bug in the plumbing itself).
 */
export function appStack(stack: string): string {
  const lines = stack.split("\n").map((text) => ({ text, frame: appFrame(text) }));
  const hasOwnCode = lines.some(({ frame }) => frame && !INFRA_RE.test(frame.file));
  return lines
    .flatMap(({ text, frame }) => {
      if (!/^\s*at\s/.test(text)) return [text]; // "AppError: …" and "caused by: …" lines
      if (!frame || (hasOwnCode && INFRA_RE.test(frame.file))) return [];
      const position = `${frame.file}:${frame.line}:${frame.column}`;
      return [`    at ${frame.fn ? `${frame.fn} (${position})` : position}`];
    })
    .join("\n");
}
