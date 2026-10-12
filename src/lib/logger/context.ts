import { AsyncLocalStorage } from "node:async_hooks";

/** Per-request data that every log line inside the request picks up automatically. */
export interface RequestContext {
  requestId: string;
  method: string;
  path: string;
  userId?: number;
  orgId?: number;
}

// globalThis keeps ONE store across Next.js hot reloads and separately bundled route modules
const g = globalThis as unknown as { __requestContext?: AsyncLocalStorage<RequestContext> };
const storage = g.__requestContext ?? (g.__requestContext = new AsyncLocalStorage<RequestContext>());

export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

/** Add fields (e.g. userId/orgId after authentication) to the current request's context. */
export function setRequestContext(patch: Partial<RequestContext>): void {
  const store = storage.getStore();
  if (store) Object.assign(store, patch);
}

export function generateRequestId(): string {
  return `req_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}
