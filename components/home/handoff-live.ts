// ════════════════════════════════════════════════════════════════════════════════════════════════
// W25 · THE HAND-OFF LANDS LIVE — the Home chat's watch over a background hand-off (pure, client-safe).
//
// Found live (Sep 29): "hand this to Max: …" → Clara answered "Handed to Max — I'll post here when it's
// ready." and Max's result appeared only after a reload; the open chat never updated. The hand-off
// (W22) posts its result into the asking room under the dedupe key `handoff:<id>` (a failure under
// `handoff:<id>:failed`); the done payload names the id. The chat now:
//   · shows ONE quiet working line under the hand-off while it is pending ("Max is working on it…");
//   · re-reads the room on the app's one polling primitive (components/workflows/use-live-refresh —
//     HANDOFF_BEAT: every 4 s, stopping by itself after ~5 min, skipped while the tab is hidden) ONLY
//     while a hand-off in THIS room is pending;
//   · APPENDS the landed turn at the foot (NO MUTATION AFTER PAINT — painted turns keep their seat and
//     identity; a turn already on screen is never appended twice);
//   · says so, with Retry, when the hand-off failed or did not land within HANDOFF_TIMEOUT_MS.
// The pending record lives in this tab's own storage (a per-viewer convenience — a reload of the same
// room still shows the line and keeps watching); the result itself is the room's own served truth.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { handOffResultKey, handOffFailedKey } from '@/lib/converse/handoff-keys';
export { handOffResultKey, handOffFailedKey };

export type HandOffStatus = 'pending' | 'failed' | 'timeout';

export type PendingHandOff = {
  id: string;
  roomKey: string;
  agentId: string | null;
  agentName: string;
  /** epoch ms the hand-off was accepted */
  startedAt: number;
  status: HandOffStatus;
  /** the user's words, re-sent by Retry */
  ask: string;
};

/** How long a hand-off may take before the chat stops watching and says so. */
export const HANDOFF_TIMEOUT_MS = 5 * 60_000;
/** The live beat's cadence and cap (≈ HANDOFF_TIMEOUT_MS, plus one beat so the timeout tick fires). */
export const HANDOFF_BEAT = { everyMs: 4_000, maxTicks: Math.ceil(HANDOFF_TIMEOUT_MS / 4_000) + 1 } as const;

/** The done payload's `delegated` → a pending record (only a BACKGROUND hand-off posting into a room). */
export function handOffOf(
  delegated: { agentName?: string; agentId?: string; background?: boolean; handoffId?: string } | null | undefined,
  roomKey: string | null, ask: string, now: number,
): PendingHandOff | null {
  if (!delegated?.background || !delegated.handoffId || !roomKey) return null;
  return {
    id: String(delegated.handoffId), roomKey,
    agentId: delegated.agentId ? String(delegated.agentId) : null,
    agentName: String(delegated.agentName ?? 'Your coworker'),
    startedAt: now, status: 'pending', ask,
  };
}

type Keyed = { key?: string | null; id?: string | null };

/**
 * One beat's verdict over the room's served turns. `landed` = the served turns this beat appends (the
 * result, or the failure line); `pending` = the records still standing (pending/failed/timeout).
 * A hand-off whose RESULT landed leaves the list; a failed one stays (its line carries Retry).
 */
export function settleHandOffs<T extends Keyed>(
  pending: PendingHandOff[], served: T[], now: number, timeoutMs = HANDOFF_TIMEOUT_MS,
): { pending: PendingHandOff[]; landed: T[] } {
  const landed: T[] = [];
  const next: PendingHandOff[] = [];
  for (const h of pending) {
    if (h.status !== 'pending') { next.push(h); continue; }
    const result = served.find((t) => t.key === handOffResultKey(h.id));
    if (result) { landed.push(result); continue; }
    const failed = served.find((t) => t.key === handOffFailedKey(h.id));
    if (failed) { landed.push(failed); next.push({ ...h, status: 'failed' }); continue; }
    next.push(now - h.startedAt > timeoutMs ? { ...h, status: 'timeout' } : h);
  }
  return { pending: next, landed };
}

/**
 * THE LIVE MERGE — append-only. Painted turns keep their seat and identity; an incoming turn already on
 * screen (same row id) is skipped; the rest append at the foot in served order. Never a reshuffle.
 */
export function appendLiveTurns<T extends { rowId?: string }>(current: T[], incoming: T[]): T[] {
  const seen = new Set(current.map((t) => t.rowId).filter(Boolean) as string[]);
  const add = incoming.filter((t) => !t.rowId || !seen.has(t.rowId));
  return add.length ? [...current, ...add] : current;
}

/** Is any hand-off in this room still being watched? (the live beat's `live`) */
export function watching(pending: PendingHandOff[], roomKey: string | null): boolean {
  return !!roomKey && pending.some((h) => h.roomKey === roomKey && h.status === 'pending');
}

/** The in-thread line for a standing record. */
export function handOffLine(h: PendingHandOff): { kind: 'working' | 'failed'; text: string } {
  const first = h.agentName.split(' ')[0];
  if (h.status === 'pending') return { kind: 'working', text: `${first} is working on it…` };
  if (h.status === 'failed') return { kind: 'failed', text: `${first}'s hand-off didn't go through.` };
  return { kind: 'failed', text: `${first} hasn't posted back yet — it may still land here.` };
}

// ── The tab's own record (per-viewer convenience; never the truth of the result). ──────────────
export const HANDOFF_LS = 'aug-handoffs-v1';

/** Read the stored records defensively; drop anything older than a day. */
export function readHandOffs(raw: unknown, now: number): PendingHandOff[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((h): h is PendingHandOff =>
    !!h && typeof h === 'object' && typeof (h as PendingHandOff).id === 'string'
    && typeof (h as PendingHandOff).roomKey === 'string' && typeof (h as PendingHandOff).startedAt === 'number'
    && now - (h as PendingHandOff).startedAt < 24 * 3600_000)
    .slice(-20);
}
