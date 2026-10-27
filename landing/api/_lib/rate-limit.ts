/**
 * Fixed-window rate limiting (pure logic + a shared in-memory store).
 *
 * SCOPE: this is best-effort protection against casual abuse of
 * /api/checkout, /api/verify and /api/download. Serverless instances each
 * hold their own Map, so the effective limit is per warm instance, not a
 * global guarantee. A hard global limit would need Redis or similar — noted
 * in docs/02-commerce-architecture.md as a future consideration, not a
 * blocker for review.
 *
 * The clock and the store are injected so tests can exercise expiry,
 * exhaustion and pruning deterministically.
 */

export interface RateLimitRule {
  limit: number;
  windowMs: number;
}

export interface RateLimitEntry {
  count: number;
  resetAt: number;
}

export type RateLimitBuckets = Map<string, RateLimitEntry>;

export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/** Store shared by all requests handled by one function instance. */
export const sharedBuckets: RateLimitBuckets = new Map();

const PRUNE_THRESHOLD = 5000;

export function checkRateLimit(
  buckets: RateLimitBuckets,
  key: string,
  rule: RateLimitRule,
  nowMs: number,
): RateLimitDecision {
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= nowMs) {
    if (buckets.size >= PRUNE_THRESHOLD) {
      for (const [entryKey, entry] of buckets) {
        if (entry.resetAt <= nowMs) buckets.delete(entryKey);
      }
    }
    buckets.set(key, {count: 1, resetAt: nowMs + rule.windowMs});
    return {allowed: true, remaining: Math.max(0, rule.limit - 1), retryAfterSeconds: 0};
  }

  if (existing.count >= rule.limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - nowMs) / 1000)),
    };
  }

  existing.count += 1;
  return {
    allowed: true,
    remaining: Math.max(0, rule.limit - existing.count),
    retryAfterSeconds: 0,
  };
}
