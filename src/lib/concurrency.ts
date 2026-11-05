/**
 * In-process concurrency helpers (no external queue): bounded parallel map and a keyed token bucket.
 */

/** Runs `fn` over `items` with at most `limit` in flight; results keep the input order. Never rejects. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = { status: "fulfilled", value: await fn(items[i], i) };
      } catch (reason) {
        results[i] = { status: "rejected", reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

interface Bucket {
  tokens: number;
  updatedAt: number;
  /** Callers waiting for a token, served in arrival order. */
  waiters: number;
}

/**
 * Token bucket per key (e.g. per WhatsApp phone number id). `acquire` waits for a token instead of
 * letting a burst hit the provider's throughput limit; it gives up after `maxWaitMs` and returns false.
 */
export class KeyedRateLimiter {
  private buckets = new Map<string, Bucket>();

  constructor(
    private readonly ratePerSecond: number,
    private readonly burst: number = ratePerSecond
  ) {}

  async acquire(key: string, maxWaitMs: number): Promise<boolean> {
    const deadline = Date.now() + maxWaitMs;
    const bucket = this.bucket(key);
    bucket.waiters++;
    try {
      for (;;) {
        this.refill(bucket);
        if (bucket.tokens >= 1) {
          bucket.tokens -= 1;
          return true;
        }
        // Time until enough tokens exist for everyone queued ahead of us
        const waitMs = Math.ceil(((bucket.waiters - bucket.tokens) / this.ratePerSecond) * 1000);
        if (Date.now() + Math.min(waitMs, 50) > deadline) return false;
        await sleep(Math.max(5, Math.min(waitMs, 250)));
      }
    } finally {
      bucket.waiters--;
      this.prune();
    }
  }

  private bucket(key: string): Bucket {
    let b = this.buckets.get(key);
    if (!b) {
      b = { tokens: this.burst, updatedAt: Date.now(), waiters: 0 };
      this.buckets.set(key, b);
    }
    return b;
  }

  private refill(b: Bucket) {
    const now = Date.now();
    b.tokens = Math.min(this.burst, b.tokens + ((now - b.updatedAt) / 1000) * this.ratePerSecond);
    b.updatedAt = now;
  }

  /** Full, idle buckets carry no state worth keeping. */
  private prune() {
    if (this.buckets.size < 1000) return;
    for (const [key, b] of this.buckets) {
      this.refill(b);
      if (b.waiters === 0 && b.tokens >= this.burst) this.buckets.delete(key);
    }
  }
}
