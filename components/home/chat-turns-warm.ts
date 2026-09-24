'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE CHAT OPENS FROM ITS LAST PAINT (W17 · NO WAITING) — the Home chat's cache + warm, one module.
//
// The coworker DM has painted from its cache since Sep 7; the chief chat did not: every reopen of a
// past conversation (sidebar Recent, All conversations, ?chat=) sat on the thread skeleton until
// /api/room/turns landed. Now:
//   · the conversation's last-served turns are cached per room key (the RAW served turns — cards are
//     POINTERS in them, re-read through their own doors, so a cached card can never show a stale
//     state), in the stamped house cache (lib/utils/local-cache), read ageless (a conversation is an
//     ambient surface; the fresh read lands a beat later under the no-mutation merge);
//   · a row's hover/focus/press warms that cache with `?peek=1` — A HOVER IS NOT A VISIT: the peek
//     stamps no read marker (the route's own law), so the "since you were here" delta survives it;
//   · the OPEN always makes its own (marker-stamping) read and merges it behind the paint
//     (lib/home/thread-cache — painted turns keep their seat; only the genuinely new append).
// Only `chat:` rooms: a coworker DM (`worker:`) has its own cache in home-ask.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { loadLS, saveLS } from '@/lib/utils/local-cache';
import { readThreadCache, threadCacheOf, type CachedThread } from '@/lib/home/thread-cache';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RawChatTurn = Record<string, any>;

/** THE ONE CACHE KEY a chat room paints from. */
export const chatTurnsKey = (roomKey: string) => `aug-chat-turns-v1-${roomKey}`;

/** A peek warm skips a room whose cache is younger than this (the hover re-warms nothing fresh). */
const PEEK_TTL_MS = 60_000;

export function peekChatTurns(roomKey: string): CachedThread<RawChatTurn> | null {
  return readThreadCache<RawChatTurn>(loadLS(chatTurnsKey(roomKey)));
}

export function saveChatTurns(roomKey: string, turns: RawChatTurn[]): void {
  try { saveLS(chatTurnsKey(roomKey), threadCacheOf(turns)); } catch { /* private mode */ }
}

const _flight = new Map<string, Promise<RawChatTurn[] | null>>();

/** GET the room's turns; `peek` = a warm (no marker stamp). Writes the cache on every landing. */
export function fetchChatTurns(roomKey: string, opts: { peek?: boolean } = {}): Promise<RawChatTurn[] | null> {
  const fk = `${opts.peek ? 'peek' : 'open'}:${roomKey}`;
  const flying = _flight.get(fk);
  if (flying) return flying;
  const p = fetch(`/api/room/turns?key=${encodeURIComponent(roomKey)}${opts.peek ? '&peek=1' : ''}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((d: { turns?: unknown } | null) => {
      if (!d || !Array.isArray(d.turns)) return null;
      saveChatTurns(roomKey, d.turns as RawChatTurn[]);
      return d.turns as RawChatTurn[];
    })
    .catch(() => null)
    .finally(() => { _flight.delete(fk); });
  _flight.set(fk, p);
  return p;
}

const _timers = new Map<string, ReturnType<typeof setTimeout>>();

/** Hover/focus intent on a conversation row → warm its turns. `immediate` (a press) skips the wait. */
export function prefetchChatTurns(roomKey: string | null | undefined, opts: { immediate?: boolean } = {}): void {
  if (!roomKey || !roomKey.startsWith('chat:')) return;
  if (_flight.has(`peek:${roomKey}`) || _flight.has(`open:${roomKey}`) || _timers.has(roomKey)) return;
  if (loadLS(chatTurnsKey(roomKey), { maxAgeMs: PEEK_TTL_MS }) != null) return; // still fresh
  if (opts.immediate) { void fetchChatTurns(roomKey, { peek: true }); return; }
  _timers.set(roomKey, setTimeout(() => {
    _timers.delete(roomKey);
    void fetchChatTurns(roomKey, { peek: true });
  }, 150));
}
