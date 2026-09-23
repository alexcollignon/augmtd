// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE FALLBACK OPENING — ONE PURE LADDER (stabilization W8.4 THE ROOM SPEAKS TRUE AND FAST, Sep 23).
//
// When no composed brief speaks (a cold room; a refused or failed composition with no last-good; a
// provider 503), the item door's pinned seat says ONE thing. The owner's walk found it lying and
// robotic:
//   · "This isn't tied to a bigger body of work yet — I'll keep it standalone." — painted on an item
//     whose header chip said "connects to <project> · Track". A membership claim made from ABSENCE
//     (no link served yet — recognize-on-open may be writing one this second) that other served
//     facts contradict. The claim is gone, whatever the connection: the header's one connection line
//     is the ONLY place membership is spoken (lib/room/door.ts connectionLineFor).
//   · "This needs you to share updated report." — the title poured into a template. The item's own
//     ask stays, in words a colleague would use, or nothing is said at all (the quiet seat).
//
// THE RULE: a fallback makes NO claim another served fact can contradict — no membership, no
// preparedness it cannot see (the reply clause rides only while its card is mounted), no obligation
// the item's own ask does not carry. Pure, client-safe (the rail is a client component); the gate
// (scripts/smoke-room-voice.ts) holds fixtures against it.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** OUR disposition, not their request — the verbs the judge uses to say what the reader must do with
 *  what arrived. A counterparty asks for a thing; they do not ask you to "decide". */
const MACHINE_FRAMED = /^(decide|choose|determine|assess|evaluate|weigh|consider|review|triage|judge)\b/;

export type FallbackFacts = {
  /** The counterparty as the page names them (spoken form), or null. */
  who: string | null;
  /** The item's own verb-first ask (understanding / the commitment's words), or null. */
  ask: string | null;
  /** "I drafted a reply below" — ONLY when the reply card is mounted in this stream; else null. */
  preparedClause?: string | null;
};

/** The ask as a clause: first letter lowered, trailing stops dropped. */
function clauseOf(ask: string | null | undefined): string | null {
  const a = String(ask ?? '').trim().replace(/\s+/g, ' ').replace(/\.+$/, '');
  return a ? a.charAt(0).toLowerCase() + a.slice(1) : null;
}

/**
 * The one fallback line, or null (the quiet seat). Never a membership claim; never a template that
 * reads the title back as an order.
 *   who + their ask         → "<who> is asking you to <ask>."
 *   who + our framing       → "From <who> — <ask>."          (their seat and our frame, never fused)
 *   ask alone               → "Still open: <ask>."
 *   only a mounted draft    → "<I drafted a reply below>."
 *   nothing                 → null
 */
export function fallbackOpeningLine(f: FallbackFacts): string | null {
  const ask = clauseOf(f.ask);
  const who = f.who?.trim() || null;
  const prep = f.preparedClause?.trim() || null;
  const tail = prep ? ` — ${prep}` : '';
  if (who && ask) {
    return MACHINE_FRAMED.test(ask) ? `From ${who} — ${ask}${tail}.` : `${who} is asking you to ${ask}${tail}.`;
  }
  if (ask) return `Still open: ${ask}${tail}.`;
  if (prep) return `${prep.charAt(0).toUpperCase()}${prep.slice(1)}.`;
  return null;
}

/** Words the fallback may never say — membership is the header's one connection line, and a
 *  standalone/untied claim made from absence is contradicted the moment a link is served. */
export const FALLBACK_FORBIDDEN = /\b(standalone|isn['’]t tied|not tied|no bigger body of work|not part of any)\b/i;

// ── THE PREPARE-NOW ANSWER, IN HOUSE WORDS (W8.4 · no internal text) ─────────────────────────────
// POST /api/items/prepare-now returns `{ did: 'none', reason }` where `reason` can carry the JUDGE's
// own reasoning ("resolved by the verdict (…): <verdict.reason>") and engine phrasing ("automated
// notice — nothing to prepare"). The rail used to print it verbatim as the colleague's reply. The
// reason is a log line; the room speaks one of these instead.
export function prepareNoneLine(reason: string | null | undefined): string {
  const r = String(reason ?? '').toLowerCase();
  if (/already (?:prepared|on it)|fresh draft is already/.test(r)) return 'There is already a fresh draft on this — nothing new to prepare.';
  if (/input|from you/.test(r)) return 'I need something from you before I can prepare this — I have asked for it in this room.';
  if (/coworker/.test(r)) return 'This needs a coworker who is not set up yet.';
  if (/could not|couldn't|failed|retry|try again/.test(r)) return "I couldn't prepare that just now — I'll try again.";
  if (/no longer open/.test(r)) return 'This is no longer open.';
  if (/resolved|settled/.test(r)) return 'This looks settled already — nothing to prepare.';
  if (/automated|notice|noise|no reply expected|reach no one|newsletter|bulk/.test(r)) return 'Nothing to prepare here — this one does not need a reply.';
  return 'Nothing for me to prepare here — this one needs you.';
}
