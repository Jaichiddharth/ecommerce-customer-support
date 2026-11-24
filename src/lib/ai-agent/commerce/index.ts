import { createLogger } from "@/lib/logger";
import { shopifyCommerceProvider } from "./shopify";
import type { AgentCommerceContext, AgentStoreOrders, CommerceProvider, CommerceStoreRef, CommerceSubject } from "./types";

export type { AgentCommerceContext, AgentOrder, AgentStoreOrders, CommerceSubject } from "./types";

const log = createLogger("AgentCommerce");

/** Store platforms the AI agent can read orders from. Register new platforms here. */
const PROVIDERS: CommerceProvider<any>[] = [shopifyCommerceProvider];

/** Stores read for one conversation turn; more than this would slow every reply down */
const MAX_STORES = 5;
/** Per store. A slow store answers "can't check orders right now" (→ team) rather than holding the reply. */
const STORE_TIMEOUT_MS = 6_000;
/** Recent results are reused for the next messages of the same chat, sparing Shopify's rate limits */
const TTL_FOUND_MS = 60_000;
const TTL_NO_CUSTOMER_MS = 5 * 60_000;
const CACHE_MAX = 2_000;

type Picked = { provider: CommerceProvider<any>; store: CommerceStoreRef };
const cache = new Map<string, { until: number; value: AgentStoreOrders }>();

/**
 * Order data for one AI agent turn, from the stores that apply to the conversation:
 *  - the store the conversation's channel (WhatsApp number) is connected to;
 *  - a channel with no store: the stores where the contact is already linked to a customer
 *    (linked by a teammate or matched earlier), so nothing is guessed across stores;
 *  - dashboard test chats: every store, looked up read-only by the "test as" phone / email.
 * Returns undefined when the workspace has no store at all, so the AI service falls back to its demo data.
 * Never throws: a store that can't be read is sent as "unavailable" and the agent hands order questions over.
 */
export async function buildCommerceContext(input: {
  organizationId: number;
  channelId?: number | null;
  subject: CommerceSubject;
}): Promise<AgentCommerceContext | undefined> {
  const { organizationId, subject } = input;
  let all: Picked[];
  try {
    all = (
      await Promise.all(PROVIDERS.map(async (provider) => (await provider.listStores(organizationId)).map((store) => ({ provider, store }))))
    ).flat();
  } catch (err) {
    log.warn("Could not list stores for the AI agent", { err, organizationId });
    return undefined;
  }
  if (all.length === 0) return undefined;

  const picked = await pickStores(organizationId, all, input.channelId ?? null, subject);
  if (picked.length === 0) return { status: "no_store", stores: [] };

  const stores = await Promise.all(picked.slice(0, MAX_STORES).map((p) => readStore(organizationId, p, subject)));
  return { status: "ok", stores };
}

async function pickStores(organizationId: number, all: Picked[], channelId: number | null, subject: CommerceSubject): Promise<Picked[]> {
  if (subject.kind === "test") return all;
  if (channelId !== null) {
    for (const provider of PROVIDERS) {
      const store = await provider.storeForChannel(organizationId, channelId);
      if (store) return [{ provider, store }];
    }
  }
  const linked = await Promise.all(all.map(async (p) => ((await p.provider.isLinked(organizationId, p.store, subject.profileId)) ? p : null)));
  return linked.filter((p): p is Picked => p !== null);
}

async function readStore(organizationId: number, { provider, store }: Picked, subject: CommerceSubject): Promise<AgentStoreOrders> {
  const base = { ref: `${provider.platform}:${store.id}`, platform: provider.platform, name: store.name };
  const unavailable: AgentStoreOrders = { ...base, status: "unavailable", customer_ref: null, customer_name: null, orders: [] };
  if (store.needsReauth) return unavailable;

  const key = `${organizationId}|${base.ref}|${subject.kind === "contact" ? `p${subject.profileId}` : `t${subject.phone ?? ""}|${subject.email ?? ""}`}`;
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.value;

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      provider.customerOrders(organizationId, store, subject),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Store didn't answer within ${STORE_TIMEOUT_MS} ms`)), STORE_TIMEOUT_MS);
      }),
    ]);
    const value: AgentStoreOrders = {
      ...base,
      status: "ok",
      customer_ref: result.customerRef,
      customer_name: result.customerName,
      orders: result.orders,
    };
    remember(key, value, result.customerRef ? TTL_FOUND_MS : TTL_NO_CUSTOMER_MS);
    return value;
  } catch (err) {
    log.warn("AI agent could not read orders from a store", { err, organizationId, store: base.ref });
    return unavailable;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function remember(key: string, value: AgentStoreOrders, ttl: number) {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(key, { until: Date.now() + ttl, value });
}

/** Drop cached order data of a store (or a whole workspace), e.g. when Shopify reports an order change */
export function forgetStoreOrders(organizationId: number, storeRef?: string) {
  const prefix = storeRef ? `${organizationId}|${storeRef}|` : `${organizationId}|`;
  for (const key of cache.keys()) if (key.startsWith(prefix)) cache.delete(key);
}
