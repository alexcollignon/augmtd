// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE THREAD CACHE MERGE — a conversation paints from its last-known turns, and the server's read
// lands BEHIND the paint (W17 · NO WAITING; tier-1 invariant 11 NO MUTATION AFTER PAINT).
//
// PURE and client-safe (no imports): the Home chat and the coworker DM both hydrate a cached TAIL
// of a conversation and then receive the server's FULL, ascending list. The merge is positional,
// because a conversation is an append-only log:
//
//   cache = { total: how many turns the thread held when cached, turns: its last `turns.length` }
//
//   · every PAINTED turn keeps its seat and its object identity (nothing read is rewritten);
//   · turns the server holds PAST the cached total append at the foot (the genuinely new);
//   · turns OLDER than the painted tail fold in ABOVE it (history the tail left out — above the
//     reader, never under them; the pane is pinned to its end);
//   · a server list SHORTER than the cached total (a turn archived elsewhere) changes nothing on
//     this open — the painted truth stands, and the next open paints from the corrected cache.
//
// THE BUG THIS CLOSES (found in W17's measure): the DM merged a 30-turn cached TAIL against the full
// list by index (`[...prev, ...loaded.slice(prev.length)]`), so any thread longer than the tail
// re-appended turns already on screen — duplicates under the reader on every warm reopen.
// ════════════════════════════════════════════════════════════════════════════════════════════════

export type CachedThread<T> = { total: number; turns: T[] };

/** How many turns a cache keeps: a first paint, never an archive. */
export const THREAD_CACHE_TAIL = 40;

/** The cache record for a thread as the server just served it. */
export function threadCacheOf<T>(loaded: T[], tail = THREAD_CACHE_TAIL): CachedThread<T> {
  return { total: loaded.length, turns: loaded.slice(-tail) };
}

/** Read a cache record defensively (a legacy bare array, or junk, is no cache at all). */
export function readThreadCache<T>(raw: unknown): CachedThread<T> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as { total?: unknown; turns?: unknown };
  if (typeof r.total !== 'number' || !Array.isArray(r.turns) || r.turns.length > r.total) return null;
  return { total: r.total, turns: r.turns as T[] };
}

/**
 * The merge. `cache` is the record this open painted from (null = a cold open); `current` is what
 * the reader sees NOW (the cache's tail, possibly already grown by this open's own turns); `loaded`
 * is the server's full list. With nothing painted, the server's list is simply the paint.
 */
export function mergeThreadLanding<T>(cache: CachedThread<T> | null, current: T[], loaded: T[]): T[] {
  if (!cache || !cache.turns.length || !current.length) return loaded;
  if (loaded.length < cache.total) return current; // the painted truth stands on this open
  const older = loaded.slice(0, cache.total - cache.turns.length);
  // The reader already spoke on this open: their own turns are on screen (and may be among the
  // server's newer ones) — append nothing this landing rather than risk a second copy; the next
  // open paints the whole truth from the corrected cache.
  const grewLocally = current.length > cache.turns.length;
  const newer = grewLocally ? [] : loaded.slice(cache.total);
  if (!older.length && !newer.length) return current;
  return [...older, ...current, ...newer];
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE KEYED LIST LANDING — a list surface painted from its cache (All conversations) receives the
// server's fresh listing. Painted rows keep their SEAT (their order), take the server's fresh copy
// where it has one (a rename elsewhere is truth about the same row, in place), and are never pulled
// out from under the reader on this visit; rows the painted list did not hold arrive at the TOP
// (a recency list's new rows are the newest). The next visit paints the server's list whole.
// ════════════════════════════════════════════════════════════════════════════════════════════════
export function mergeKeyedListLanding<T extends { key: string }>(painted: T[] | null, fresh: T[]): T[] {
  if (!painted?.length) return fresh;
  const byKey = new Map(fresh.map((r) => [r.key, r]));
  const seen = new Set(painted.map((r) => r.key));
  const arrived = fresh.filter((r) => !seen.has(r.key));
  return [...arrived, ...painted.map((r) => byKey.get(r.key) ?? r)];
}
