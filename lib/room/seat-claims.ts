// ════════════════════════════════════════════════════════════════════════════════════════════════
// A CLAIM RENDERS — ON THE ITEM PAGE'S OWN EXCHANGE (W39 — the walk's blocker, Oct 1).
//
// After a "Type it" answer the run drafted the reply, and the seat's words in the room's exchange said
// "the reply is drafted and ready" — while the page (painting a cache older than the draft) showed no
// card at all. The composer's nets (lib/room/self-voice enforceRenderedClaims) guard the OPENING; the
// exchange — narration and answers landing after the reader's first word — had no net. This is that
// net, at render time, against what the page's action seat ACTUALLY holds:
//
//   a system sentence that claims a prepared THING (first person "I've drafted…", a named actor
//   "<Name> drafted the reply…", or the passive "the reply is drafted / ready to review") whose KIND
//   the seat does not render is NOT SHOWN, and the host is told (`dropped`) so it can make ONE fresh
//   read whose landing may fill the EMPTY seat (lib/room/no-mutation.ts mayFillEmptySeat). The moment
//   the card renders, the same sentence renders with it — the claim and its card arrive together.
//
// Removes only; never invents words. A sentence whose object kind cannot be read stands (the opening
// net's rule). PURE and client-safe.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { claimedKindOf, type PrepKind } from '@/lib/room/self-voice';

/** "I've drafted / we prepared / Clara drafted / Sam has put together / I recorded X and staged the
 *  reply" — a past-tense preparation verb anywhere in the sentence, unless it is an offer, a future,
 *  a negation or a condition ("I can draft", "I'll draft it", "I haven't drafted", "once it's drafted"). */
const PREP_VERB = /\b(?:drafted|prepared|written|wrote|put together|pulled together|staged|lined up)\b/gi;
const NOT_A_CLAIM_BEFORE = /(?:\b(?:can|could|will|would|shall|should|may|might|to|not|never|once|when|if|until|after|before)|n['’]t|['’]ll)\s+(?:\S+\s+){0,3}$/i;
function unhedged(s: string, re: RegExp): boolean {
  for (const m of s.matchAll(re)) {
    const before = s.slice(Math.max(0, (m.index ?? 0) - 40), m.index ?? 0);
    if (!NOT_A_CLAIM_BEFORE.test(before)) return true;
  }
  return false;
}
/** "the reply is drafted", "it's ready to review", "the invite is ready" — the passive claim. */
const PASSIVE_CLAIM = /\b(?:is|are|['’]s)\s+(?:all\s+|now\s+|already\s+)?(?:drafted|prepared|staged|ready)\b|\bready to (?:review|send|go)\b/gi;

/** The KINDS a seated action artifact renders (components/thread/item-page.ts artifact kinds). */
export function seatKindsOf(artifact: string | null | undefined): Set<PrepKind> {
  const out = new Set<PrepKind>();
  switch (artifact) {
    case 'reply_draft': case 'nudge_draft': out.add('email'); break;
    case 'invite': out.add('invite'); break;
    case 'forward': out.add('forward'); out.add('email'); break;
    case 'paste_pack': out.add('email'); out.add('document'); break;
    case 'deliverable': case 'document': case 'frame': out.add('document'); break;
    case 'decision': out.add('decision'); out.add('document'); break;
    default: break;
  }
  return out;
}

/** The claimed kind of a sentence, or null when it is not a preparation claim / names no object. */
export function claimedSeatKind(sentence: string): PrepKind | null {
  const s = String(sentence ?? '');
  if (!unhedged(s, PREP_VERB) && !unhedged(s, PASSIVE_CLAIM)) return null;
  // "drafted the send" names a message too (the doc-send lane's own words).
  return claimedKindOf(s) ?? (/\bthe send\b/i.test(s) ? 'email' : null);
}

function sentencesOf(text: string): string[] {
  return String(text).split(/(?<=[.!?])\s+/).filter((s) => s.trim());
}

/** The words the seat may speak, given what the seat renders. Pure. */
export function dropUnseatedClaims(text: string, seated: Set<PrepKind>): { text: string; dropped: string[] } {
  const dropped: string[] = [];
  for (const s of sentencesOf(text)) {
    const kind = claimedSeatKind(s);
    if (kind && !seated.has(kind)) dropped.push(s.trim());
  }
  if (!dropped.length) return { text, dropped };
  // Cut each dropped sentence out IN PLACE — the rest keeps its own lines and markdown.
  let out = String(text);
  for (const d of dropped) out = out.replace(d, '');
  out = out.replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return { text: out, dropped };
}
