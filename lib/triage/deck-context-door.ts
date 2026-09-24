// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE DECK CONTEXT DOOR, READ ONCE (W3.6) — the ONE client-side reader of POST /api/home/deck-context.
//
// THE BATCH: every ask made in the same tick (the parent's warm for the whole handed set AND each
// card's own ask — React runs a child's effect before its parent's) is COALESCED into one request.
// A card never issues its own query while its siblings issue theirs: no N+1, by construction.
//
// THE STAMPED CACHE: a per-session memo, plus the localStorage copy through `saveLS` (stamped) read
// back only when it is fresh (`maxAgeMs` — an action surface never paints from a cache too old to
// trust). A failure is silence: the card keeps what it already has.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { DeckContext } from '@/lib/triage/deck-context';
import { loadLS, saveLS } from '@/lib/utils/local-cache';

// v2 (W16.4): the context carries the item page's source shape — a v1 blob (the thread's newest line)
// is never read back.
const LS_KEY = 'aug-deck-context-v2';
/** The deck is an action surface: 15 minutes, the deck/horizon freshness demand. */
export const DECK_CONTEXT_MAX_AGE_MS = 15 * 60 * 1000;

const _cache = new Map<string, DeckContext | null>();
/** Each entry's OWN read time — a re-save never launders an old entry into a fresh stamp. */
const _at = new Map<string, number>();
const _flight = new Map<string, Promise<DeckContext | null>>();
let _pending: Map<string, (c: DeckContext | null) => void> | null = null;
let _hydrated = false;

function hydrate() {
  if (_hydrated) return;
  _hydrated = true;
  try {
    const warm = loadLS<Record<string, { at: number; c: DeckContext }>>(LS_KEY, { maxAgeMs: DECK_CONTEXT_MAX_AGE_MS });
    const now = Date.now();
    if (warm) for (const [id, e] of Object.entries(warm)) {
      if (e && typeof e === 'object' && e.c && typeof e.at === 'number' && now - e.at <= DECK_CONTEXT_MAX_AGE_MS) {
        _cache.set(id, e.c); _at.set(id, e.at);
      }
    }
  } catch { /* storage may be unavailable — the fetch is the truth */ }
}

function persist() {
  try {
    const obj: Record<string, { at: number; c: DeckContext }> = {};
    for (const [id, c] of _cache) if (c) obj[id] = { at: _at.get(id) ?? Date.now(), c };
    saveLS(LS_KEY, obj);
  } catch { /* best-effort */ }
}

/** A held entry, only while it is fresh — a long session never serves an old read as current. */
function fresh(id: string): DeckContext | null {
  const c = _cache.get(id);
  if (!c) return null;
  if (Date.now() - (_at.get(id) ?? 0) > DECK_CONTEXT_MAX_AGE_MS) { _cache.delete(id); _at.delete(id); return null; }
  return c;
}

/** What this session already holds for a commitment, or null. */
export function peekDeckContext(id: string): DeckContext | null {
  hydrate();
  return fresh(id);
}

async function flush(batch: Map<string, (c: DeckContext | null) => void>) {
  const ids = [...batch.keys()];
  let got: Record<string, DeckContext> = {};
  try {
    const res = await fetch('/api/home/deck-context', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }),
    });
    if (res.ok) got = ((await res.json()) as { contexts?: Record<string, DeckContext> }).contexts ?? {};
  } catch { /* silence */ }
  for (const [id, resolve] of batch) {
    const c = got[id] ?? null;
    if (c) { _cache.set(id, c); _at.set(id, Date.now()); }
    _flight.delete(id);
    resolve(c);
  }
  persist();
}

/** One commitment's context — coalesced with every other ask made this tick. */
export function loadDeckContext(id: string): Promise<DeckContext | null> {
  hydrate();
  const hit = fresh(id);
  if (hit) return Promise.resolve(hit);
  const inFlight = _flight.get(id);
  if (inFlight) return inFlight;
  const p = new Promise<DeckContext | null>((resolve) => {
    if (!_pending) {
      _pending = new Map();
      setTimeout(() => { const b = _pending!; _pending = null; void flush(b); }, 0);
    }
    _pending.set(id, resolve);
  });
  _flight.set(id, p);
  return p;
}

/** Warm the whole handed set in one request (the parent's call; cards share it). */
export function warmDeckContexts(ids: string[]): void {
  for (const id of ids) void loadDeckContext(id);
}
