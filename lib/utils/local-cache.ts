// Tiny localStorage cache — the "instant on reload" layer. A page hydrates its last-known data from here
// immediately (no skeleton flash), then refreshes in the background and writes the fresh result back. All
// best-effort: SSR (no window), quota, or a bad blob never throw. Bump the version suffix in a key to
// invalidate an old shape.
export function loadLS<T>(key: string): T | null {
  try {
    if (typeof window === 'undefined') return null;
    const s = window.localStorage.getItem(key);
    return s ? (JSON.parse(s) as T) : null;
  } catch {
    return null;
  }
}

export function saveLS(key: string, value: unknown): void {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota / serialization — non-fatal */
  }
}
