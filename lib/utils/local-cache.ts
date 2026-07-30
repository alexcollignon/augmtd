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

export function saveLS(key: string, value: unknown): void {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(key, JSON.stringify({ __at: Date.now(), __v: value } satisfies Envelope));
  } catch {
    /* quota / serialization — non-fatal */
  }
}
