// Simple in-process sliding-window rate limiter.
// Per-key (userId or IP). Not globally exact on multi-instance deployments —
// each Vercel function instance maintains its own counter.

const store = new Map<string, number[]>();

export function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number,
): { allowed: boolean; retryAfterMs: number } {
  const now = Date.now();
  const hits = (store.get(key) ?? []).filter(t => now - t < windowMs);
  if (hits.length >= maxRequests) {
    return { allowed: false, retryAfterMs: windowMs - (now - hits[0]) };
  }
  hits.push(now);
  store.set(key, hits);
  return { allowed: true, retryAfterMs: 0 };
}
