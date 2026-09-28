// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE OBLIGATION ANCHOR (stabilization W20.C · invariant 7 EVIDENCE SETTLES + invariant 14 TIME TRUTH;
// owner walk Sep 28).
//
// THE FINDING: an item about an Oct 12 call read "You met on Sep 21 · Mark done". The item was BORN on
// Sep 16 (an earlier "catch up" ask on the thread), later RE-POINTED to a Sep 27 message that asked for
// the Oct 12 call. The machine's held-booking rung anchored "after the obligation arose" on the row's
// `created_at` (Sep 16), so a Sep 21 meeting with the same counterparty counted as the deed — although
// it happened BEFORE the current ask existed, and three weeks before the date the ask names. Five
// sites answered "when did this obligation arise?" with four different field orders
// (created_at ?? received_at · last_activity_at ?? received_at · last_activity_at ?? created_at).
//
// THE LAW — ONE ANCHOR: "after the obligation" means after the moment the CURRENT ask arose, read
// through `obligationAnchorOf` and nowhere else (scripts/smoke-obligation-anchor.ts holds every
// anchoring site in lib/work · lib/evidence · lib/room to this helper).
//   · inbox item — the LATEST of `source_data.received_at` (the message the item currently carries —
//     it moves when the item is re-pointed) and `last_activity_at` (the newest inbound on the thread,
//     bumped by the sync on every arrival that re-surfaces it). `created_at` is only the FALLBACK when
//     neither clock parses: it is the INGEST clock, not the ask's — a backfilled item is created days
//     after its message, and anchoring on it would hide the user's real reply in between.
//   · commitment — `created_at` (the commitment row IS the ask; it carries no message clock of its own).
//
// THE HELD-MEETING RULE (`heldMeetingSettles`) — a held meeting is evidence that a MEETING-SHAPED ask
// was done only when it (a) starts at/after the anchor and (b) — when the ask names a FUTURE date (a
// stated date on/after the anchor's day that is not a "by/before" bound) — starts on or after that
// date: an ask to meet on Oct 12 is not settled by a Sep 21 meeting. (The counterparty test (c) is the
// matcher's key — lib/work/scheduled.ts counterpartyInEvent / the evidence person key.) Both the
// machine's read-time held-booking rung and the settle door's looks-done record pass through
// lib/evidence/looks-done.ts `looksDoneScopeOf`, which applies this rule: one gate, no side door.
//
// PRECEDENCE: TIME TRUTH outranks the looks-done convenience — when the date is ambiguous the rung
// stays DOWN (the item stays open, the fulfillment judge still reads the meeting as evidence and may
// close it). A missed "looks done" makes the page vague; a false one makes it wrong.
//
// Pure, zero imports, client-safe.
// ════════════════════════════════════════════════════════════════════════════════════════════════

export type AnchorRow = {
  created_at?: unknown;
  last_activity_at?: unknown;
  source_data?: unknown;
};

const ms = (v: unknown): number => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) return NaN;
  return Date.parse(s);
};

/**
 * THE ONE ANCHOR — the moment the obligation's CURRENT ask arose, as an ISO string (the winning
 * field's own value, so string comparison with other stored ISO stamps keeps working), or '' when the
 * row carries no parseable clock (an undated origin cannot bound "later"). Pure.
 */
export function obligationAnchorOf(kind: 'inbox' | 'commitment', row: AnchorRow | null | undefined): string {
  if (!row) return '';
  if (kind === 'commitment') return Number.isFinite(ms(row.created_at)) ? String(row.created_at).trim() : '';
  const sd = (row.source_data ?? {}) as { received_at?: unknown };
  let best = '';
  let bestMs = -Infinity;
  for (const v of [sd.received_at, row.last_activity_at]) {
    const t = ms(v);
    if (Number.isFinite(t) && t > bestMs) { bestMs = t; best = String(v).trim(); }
  }
  if (best) return best;
  return Number.isFinite(ms(row.created_at)) ? String(row.created_at).trim() : '';
}

/** "by Friday" / "before the 12th" / "avant vendredi" / "bis Freitag" / "até sexta" — a stated date
 *  that BOUNDS the deed rather than naming when it happens (the four corpus languages). */
const BOUND_WORDS = /(?<![\p{L}\p{N}])(by|before|until|no later than|latest|avant|au plus tard|d'ici|bis|vor|spätestens|até|antes de|antes do|antes da)(?![\p{L}\p{N}])/iu;

/** Does the ask phrase its date as a bound ("by …", "before …")? Pure. */
export function askStatesBound(text: string | null | undefined): boolean {
  return BOUND_WORDS.test(String(text ?? ''));
}

/**
 * The obligation's own FUTURE meeting date (YYYY-MM-DD) — the stated date when it is on/after the
 * anchor's day (it was ahead when the ask arose) and the ask does not phrase it as a bound. null
 * otherwise (no date · a stale date before the ask · "by Friday"). Pure.
 */
export function statedMeetingDateOf(
  statedDate: string | null | undefined, anchorISO: string | null | undefined, askText?: string | null,
): string | null {
  const d = String(statedDate ?? '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  const anchorDay = String(anchorISO ?? '').trim().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(anchorDay) && d < anchorDay) return null;
  if (askStatesBound(askText)) return null;
  return d;
}

/** A calendar day in any zone starts at most 14h before its UTC midnight (UTC+14). */
const DAY_ZONE_GRACE_MS = 14 * 3_600_000;

/**
 * THE HELD-MEETING RULE — pure. May a held meeting that STARTED at `startISO` be the deed of the
 * obligation anchored at `anchorISO` whose ask names `meetingDate` (from `statedMeetingDateOf`)?
 *   (a) it starts at/after the anchor (an absent/unparseable anchor bounds nothing — legacy behaviour);
 *   (b) with a named future date, it starts on/after that day (zone-graced to UTC+14).
 */
export function heldMeetingSettles(startISO: string | null | undefined, anchorISO: string | null | undefined, meetingDate?: string | null): boolean {
  const s = ms(startISO);
  if (!Number.isFinite(s)) return false;
  const a = ms(anchorISO);
  if (Number.isFinite(a) && s < a) return false;
  const d = String(meetingDate ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
    const dayStart = Date.parse(`${d}T00:00:00Z`) - DAY_ZONE_GRACE_MS;
    if (s < dayStart) return false;
  }
  return true;
}
