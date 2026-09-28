// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE CHAT SURFACE (stabilization W23.A — owner walk Sep 28, "compare ChatGPT").
//
// The pure half of four behaviours every chat surface shares (the Home chat, the coworker DM, the
// item/project room):
//   · FOLLOW THE STREAM — the view stays pinned to the newest words while the reader is at (or
//     within FOLLOW_THRESHOLD_PX of) the bottom; the moment they scroll up it lets go, and a
//     jump-to-latest button stands above the composer until they come back.
//   · "WORKED FOR 8s ›" — an answer that took tool steps (the stream's progress labels) or longer
//     than WORKED_MIN_MS says so in one quiet collapsible line; an instant answer says nothing.
//   · THE ACTIVITY CONTRACT — the `done` payload may carry `activity` / `durationMs` (the core's own
//     record); absent, the client's own recording stands in, live-only.
//
// Pure, zero IO, client-safe (no React, no DOM).
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** Within this many pixels of the bottom the reader counts as "at the bottom" — the view follows. */
export const FOLLOW_THRESHOLD_PX = 80;

export type ScrollMetrics = { scrollTop: number; clientHeight: number; scrollHeight: number };

/** How far the viewport's bottom edge is from the content's end (never negative). */
export const distanceFromBottom = (m: ScrollMetrics): number =>
  Math.max(0, m.scrollHeight - m.clientHeight - m.scrollTop);

export const isNearBottom = (m: ScrollMetrics, threshold = FOLLOW_THRESHOLD_PX): boolean =>
  distanceFromBottom(m) <= threshold;

/**
 * THE FOLLOW DECISION, over one scroll event. `prevTop` is the scroll position before this event;
 * `settling` is true while a jump-to-latest glides down (its intermediate positions are not the
 * reader letting go).
 *
 *   · at the very bottom (≤ 2px — a clamp after the content shrank lands here too) → follow;
 *   · moved UP (the reader's own gesture — any amount) → stop following;
 *   · moved down / stayed, while a jump glides → keep what we had;
 *   · otherwise → follow exactly when within the threshold.
 */
export function nextFollowing(prev: boolean, ev: { metrics: ScrollMetrics; prevTop: number; settling?: boolean }): boolean {
  const dist = distanceFromBottom(ev.metrics);
  if (dist <= 2) return true;
  if (ev.metrics.scrollTop < ev.prevTop) return false;
  if (ev.settling) return prev;
  return prev ? true : dist <= FOLLOW_THRESHOLD_PX;
}

/** The jump-to-latest button stands only when the reader has let go AND there is real distance to go. */
export const showJumpButton = (following: boolean, m: ScrollMetrics): boolean =>
  !following && distanceFromBottom(m) > FOLLOW_THRESHOLD_PX;

// ── "WORKED FOR Xs ›" ────────────────────────────────────────────────────────────────────────────

/** One progress step the stream reported: its words and when (ms since the ask left). */
export type ActivityStep = { label: string; atMs: number };

/** Below this, an answer with no tool steps is "instant" — no line. */
export const WORKED_MIN_MS = 3000;

/** Append a step (trimmed); an empty label or a repeat of the last one records nothing. */
export function recordStep(steps: ActivityStep[], label: unknown, atMs: number): ActivityStep[] {
  const l = typeof label === 'string' ? label.trim() : '';
  if (!l) return steps;
  if (steps.length && steps[steps.length - 1].label === l) return steps;
  return [...steps, { label: l, atMs: Math.max(0, Math.round(atMs)) }];
}

/** THE CONTRACT'S `activity`, validated — a malformed entry is dropped, never half-rendered. */
export function activityOf(v: unknown): ActivityStep[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((s): s is ActivityStep =>
    !!s && typeof s === 'object' && typeof (s as ActivityStep).label === 'string' && !!(s as ActivityStep).label.trim()
    && typeof (s as ActivityStep).atMs === 'number' && Number.isFinite((s as ActivityStep).atMs));
  return out.length ? out.map((s) => ({ label: s.label.trim(), atMs: s.atMs })) : undefined;
}

/** THE CONTRACT'S `durationMs`, validated. */
export const durationOf = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined;

/** "8s" · "1m 12s" · "2m" — never "0s" (a second is the floor of anything worth saying). */
export function formatDuration(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r ? `${m}m ${r}s` : `${m}m`;
}

/**
 * The line's words, or null when there is nothing to say (an instant answer with no steps). The
 * duration is the core's own when it sent one, else the client's measure; with neither, the last
 * step's moment stands in.
 */
export function workedForLine(activity?: ActivityStep[], durationMs?: number): string | null {
  const steps = activity?.length ?? 0;
  const offs = steps ? stepOffsets(activity!) : [];
  const ms = durationMs ?? (offs.length ? offs[offs.length - 1].offsetMs : undefined);
  if (!steps && !(ms !== undefined && ms > WORKED_MIN_MS)) return null;
  return ms !== undefined && ms >= 500 ? `Worked for ${formatDuration(ms)}` : 'Worked';
}

/** Steps with their offset from the first moment — `atMs` may be relative (the client's) or epoch (a
 *  server clock); either way the reader sees "+2s" from the start. */
export function stepOffsets(activity: ActivityStep[]): Array<ActivityStep & { offsetMs: number }> {
  const base = activity.length && activity[0].atMs > 1e11 ? activity[0].atMs : 0;
  return activity.map((s) => ({ ...s, offsetMs: Math.max(0, s.atMs - base) }));
}
