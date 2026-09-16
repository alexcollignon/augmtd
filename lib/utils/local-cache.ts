// Tiny localStorage cache — the "instant on reload" layer. A page hydrates its last-known data from here
// immediately (no skeleton flash), then refreshes in the background and writes the fresh result back. All
// best-effort: SSR (no window), quota, or a bad blob never throw. Bump the version suffix in a key to
// invalidate an old shape.
//
// STAMPED (July 30 — the resolved-work flicker): every save carries `__at`, and a reader may demand
// freshness (`maxAgeMs`). THE LAW: an ACTION surface (the deck, anything that says "this needs you")
// must never paint from a cache too old to trust — already-handled work flashing up and retracting is
// a show-then-retract violation, not instant-load. Ambient surfaces can keep hydrating ageless.
// A legacy unstamped blob has an unknowable age — when the caller demands freshness it is REJECTED
// (never a claim we can't back); it self-heals on the next save.

type Envelope = { __at: number; __v: unknown };
const isEnvelope = (x: unknown): x is Envelope =>
  !!x && typeof x === 'object' && !Array.isArray(x) && '__at' in (x as Record<string, unknown>) && '__v' in (x as Record<string, unknown>);

export function loadLS<T>(key: string, opts?: { maxAgeMs?: number }): T | null {
  try {
    if (typeof window === 'undefined') return null;
    const s = window.localStorage.getItem(key);
    if (!s) return null;
    const parsed: unknown = JSON.parse(s);
    if (isEnvelope(parsed)) {
      if (opts?.maxAgeMs && Date.now() - parsed.__at > opts.maxAgeMs) return null;
      return parsed.__v as T;
    }
    return opts?.maxAgeMs ? null : (parsed as T);
  } catch {
    return null;
  }
}

// ── THE QUOTA EVICTION (found live, Sep 7 — the walk) ──────────────────────────────────────────
// localStorage hit its ~5MB quota and every save on the origin failed SILENTLY for two days: the
// instant-load layer kept serving increasingly stale paint (a stale-empty portfolio, a 2-day-old
// brief, a dead sidebar badge) while looking perfectly healthy. The layer must SELF-HEAL: on
// quota, evict the OLDEST of our own stamped envelopes and retry once. Scope is strictly `aug-`
// keys with the envelope shape — a dev origin (localhost:3000) is shared with other apps' storage,
// which is never ours to delete.
function evictOldestAugEnvelopes(sparedKey: string, maxEvictions = 12): number {
  let evicted = 0;
  try {
    const candidates: Array<{ key: string; at: number }> = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (!k || !k.startsWith('aug-') || k === sparedKey) continue;
      try {
        const parsed: unknown = JSON.parse(window.localStorage.getItem(k) ?? '');
        if (isEnvelope(parsed)) candidates.push({ key: k, at: parsed.__at });
      } catch { /* not ours to judge */ }
    }
    candidates.sort((a, b) => a.at - b.at);
    for (const c of candidates.slice(0, maxEvictions)) {
      window.localStorage.removeItem(c.key);
      evicted++;
    }
  } catch { /* best-effort */ }
  return evicted;
}

export function saveLS(key: string, value: unknown): void {
  try {
    if (typeof window === 'undefined') return;
    const blob = JSON.stringify({ __at: Date.now(), __v: value } satisfies Envelope);
    try {
      window.localStorage.setItem(key, blob);
    } catch {
      // Quota: evict our oldest stamped caches and retry ONCE. A cache is a convenience — the
      // oldest ones are the least likely to ever be read again, and a failed save that leaves a
      // STALE blob standing is worse than a missing one.
      if (evictOldestAugEnvelopes(key) > 0) window.localStorage.setItem(key, blob);
    }
  } catch {
    /* quota after eviction / serialization — non-fatal */
  }
}
