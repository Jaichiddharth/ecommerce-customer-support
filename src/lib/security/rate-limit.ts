/**
 * Rate limiting shared by every server instance: fixed one-minute windows counted in Postgres
 * (table rate_limit_hits, migration 0016). One upsert per check; old windows are pruned now and then.
 *
 * Fails open: if the database can't be reached the request is allowed (and logged), so a database
 * hiccup never takes the chat widget down. The AI service applies its own per-conversation limit too.
 */
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { createLogger } from "@/lib/logger";

const log = createLogger("RateLimit");

const WINDOW_SECONDS = 60;
let lastPrune = 0;

/** Counts one hit for `key` and returns whether it is within `limit` hits per minute. */
export async function consumeRateLimit(key: string, limit: number): Promise<boolean> {
  const k = key.slice(0, 200);
  try {
    const rows = await db.execute(sql`
      INSERT INTO rate_limit_hits ("key", window_start, "count")
      VALUES (${k}, to_timestamp(floor(extract(epoch from now()) / ${WINDOW_SECONDS}) * ${WINDOW_SECONDS}), 1)
      ON CONFLICT ("key", window_start) DO UPDATE SET "count" = rate_limit_hits."count" + 1
      RETURNING "count"`);
    const count = Number((rows as unknown as { count: number }[])[0]?.count ?? 0);
    if (Date.now() - lastPrune > 5 * 60_000) {
      lastPrune = Date.now();
      void db.execute(sql`DELETE FROM rate_limit_hits WHERE window_start < now() - interval '5 minutes'`).catch(() => undefined);
    }
    return count <= limit;
  } catch (err) {
    log.warn("rate limit check failed; allowing the request", { key: k.split("|")[0], error: err instanceof Error ? err.message : String(err) });
    return true;
  }
}
