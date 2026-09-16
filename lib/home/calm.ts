// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE CALM HOME — the pick, the words, the receipts (docs/threads-plan.md, "The Home thread's
// seat — THE CALM HOME"; the frozen board docs/design/threads/HomeCalm.dc.html).
//
// Home = one speaker, everything else whispering. This module is the JUDGMENT-FREE half of that
// form: given the SERVED deck (the same `DoItem`s the deck renders, in the same judged order) it
// picks the ≤5 lines and words each one. It reasons about NOTHING — the judge, the machine and the
// agenda spine already decided what needs the user and in what order; this only decides how quietly
// to say it.
//
// OWNER CALL, Sep 13 ("in home, this feels too much, remove"): THE CoS SENTENCE IS RETIRED from the
// Home. The whole sentence path — the CalmFacts derivation, the deterministic builder, the
// briefing-lead ladder and its acknowledges-the-fires check — died with it rather than standing as
// a corpse; the Home had the only consumer. The law it existed to enforce did NOT die: a fire still
// leads, and it leads WHERE THE READER LOOKS — `pickWhispers` seats every overdue row first, in
// every lane. The seating IS the acknowledgement now; no prose has to claim it.
//
// The laws it carries:
//   • THE DENSITY LAW — greeting · at most FIVE rows · one composer · the door. CALM_MAX_WHISPERS
//     is the cap and it is enforced HERE, so no surface can quietly widen the fold.
//   • THE RECEIPT GRAMMAR — every line carries a DONE-NESS word, and that word is MAPPED from the
//     row's real served state (prepared-by + the machine's own word), never authored per row.
//     A row with nothing prepared gets its honest state word instead; urgency is a WORD, never
//     chrome (the caller renders receipts indigo and everything else grey — no red anywhere).
//   • A NAMED FIRE IS A SEATED FIRE — an overdue row takes a seat before anything else.
//
// PURE + client-safe: no React, no fetch, no Date.now beyond the injectable `today`.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { DoItem } from '@/lib/home/agenda';

/** THE DENSITY LAW's number. Above the fold the Home holds at most this many rows. */
export const CALM_MAX_WHISPERS = 5;

export type Whisper = {
  item: DoItem;
  /** The whole line, built from the row's own fields — who + what, one sentence. */
  sentence: string;
  /** The quiet urgency word (grey). Never a colour, never a badge. */
  urgency: string | null;
  /** THE RECEIPT — the done-ness word (indigo) a system that already worked can print. */
  receipt: string | null;
  /** The honest state word for a row with nothing prepared (grey) — the machine's own vocabulary. */
  note: string | null;
};

// ── THE PICK ────────────────────────────────────────────────────────────────────────────────────
// A NAMED FIRE IS A SEATED FIRE (owner walk, Sep 8 — the lead said "Four things are overdue" and
// the five whispers showed NONE of the four; all four sat behind the door). The sentence counts the
// whole pool; the fold showed a band. Two derivations of the same fact, and the surface lost.
//
// So the pick's FIRST key is the fire: an overdue row takes a seat before anything else, in EVERY
// lane, and the chore cap YIELDS to it (an overdue payment notice is a fire, not a chore — the
// Sep 7 band law still holds for everything that is not on fire). Only when more than
// CALM_MAX_WHISPERS rows are overdue can a fire fail to seat — and past that cap the door holds
// them, in the door's own stated order (fires first; sortDoorRows below).
//
// OVERDUE-NESS IS NOT IMPORTANCE **AMONG THE CALM** (owner walk, Sep 7 — "the items are not so
// priority ranked"): below the fire line, people-facing work leads and chores sink, so two
// automated payment-method notices can never outrank a person waiting on a confirmation.
//
// THE DISCRIMINATOR IS STRUCTURAL, never a keyword read on a title — it is the deck's OWN LANE.
// `source: 'notice'` is the action-notice lane (the brief route builds it from understanding
// `relevance === 'action'`: a payment failed, a key expires, a portal wants a form) — an obligation
// whose counterpart is a SYSTEM. Every other lane has a human on the other end: `reply` (someone
// wrote to you), `commitment` (you owe a counterparty), `deal` (a project full of people).

/** Is this row's counterpart a person? THE ONE DISCRIMINATOR — read off the served lane. */
export const isPeopleFacing = (item: DoItem): boolean => item.source !== 'notice';

/** At most ONE CALM chore may whisper. The rest are honest — they count toward the door's N.
 *  An OVERDUE chore is a fire and is never capped (the seated-fire law above). */
export const CALM_MAX_CHORE_WHISPERS = 1;

/** The top slice of the SERVED deck: (a) every fire, in the deck's own judged order, then (b) the
 *  calm — people-facing rows first, chores after and capped. A stable sort — nothing is re-judged,
 *  only ordered. */
export function pickWhispers(items: DoItem[], max: number = CALM_MAX_WHISPERS): DoItem[] {
  const ordered = items
    .map((it, i) => ({ it, i }))
    .sort((a, b) =>
      (Number(!a.it.overdue) - Number(!b.it.overdue))
      || (Number(!isPeopleFacing(a.it)) - Number(!isPeopleFacing(b.it)))
      // THE DERIVED-SPEECH FLOOR's sort key (census fix #9): within a band, a row the machine can
      // actually speak about leads one that only has a subject line to quote.
      || (speechRank(a.it) - speechRank(b.it))
      || (a.i - b.i));
  const out: DoItem[] = [];
  let chores = 0;
  for (const { it } of ordered) {
    if (out.length >= Math.max(0, max)) break;
    // The cap governs the CALM chores only — a fire always seats.
    if (!isPeopleFacing(it) && !it.overdue) {
      if (chores >= CALM_MAX_CHORE_WHISPERS) continue;
      chores += 1;
    }
    out.push(it);
  }
  return out;
}

// ── THE DOOR'S ORDER ────────────────────────────────────────────────────────────────────────────
// "Everything else · N →" EXPANDS IN PLACE, in the whisper grammar (owner, Sep 8 — the old legacy
// deck below the fold is retired). What it expands into is SORTED, and the order is stated here,
// deterministically, once: the same reading a chief of staff would give the rest of the pile.
//
//   0 · fires the fold could not seat (only possible past CALM_MAX_WHISPERS overdue rows)
//   1 · the machine is waiting on YOU (an ask: input needed, a decision laid out)
//   2 · due today
//   3 · dated and ahead — nearest first
//   4 · undated — the deck's own served order (the judge's ranking), untouched
//
// Within a rank: the nearer due date first, then the deck's own order. Stable, pure, no re-judging.

/** The ask states, read off THE MACHINE'S OWN WORD (lib/work/machine.ts STATE_WORDS) — never a
 *  keyword read on a title. A row wearing one of these words is blocked ON THE USER. */
const ASK_STATE_WORDS = new Set(['needs one thing from you', 'decision laid out']);

export function doorRank(item: DoItem, todayISO: string): number {
  if (item.overdue) return 0;
  if (ASK_STATE_WORDS.has((item.stateWord ?? '').trim())) return 1;
  if (item.dueToday || item.dueDate === todayISO) return 2;
  if (item.dueDate) return 3;
  return 4;
}

/** Sort the door's remainder into the stated order. Generic over the caller's row wrapper so the
 *  Home's FlatRow (which carries a deal key beside its item) keeps riding along. */
export function sortDoorRows<T>(rows: T[], itemOf: (r: T) => DoItem, today: Date = new Date()): T[] {
  const todayISO = new Date(today.getTime() - today.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
  return rows
    .map((r, i) => ({ r, i, item: itemOf(r) }))
    .sort((a, b) =>
      (doorRank(a.item, todayISO) - doorRank(b.item, todayISO))
      || ((a.item.dueDate ?? '9999-12-31').localeCompare(b.item.dueDate ?? '9999-12-31'))
      // Same key, same band, one law: derived speech leads a quoted subject in the door too.
      || (speechRank(a.item) - speechRank(b.item))
      || (a.i - b.i))
    .map((x) => x.r);
}

// ── THE RECEIPT GRAMMAR ─────────────────────────────────────────────────────────────────────────
/** MAPPED, never authored: the row's served preparation decides the word.
 *  `prepared` is the deck's own token — 'draft' (in-house) or a coworker's name. */
export function receiptOf(item: DoItem): string | null {
  if (!item.prepared) return null;
  if (item.source === 'reply') return 'reply ready';
  return item.prepared === 'draft' ? 'drafted' : 'ready to send';
}

/** The honest state word for a row with nothing prepared — THE MACHINE'S ONE WORD (STATE_WORDS,
 *  served on the row). Grey, never a receipt: a system that has not worked prints no receipt. */
export function stateNoteOf(item: DoItem): string | null {
  const w = (item.stateWord ?? '').trim();
  return w || null;
}

const WEEKDAY = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long' });

/** Urgency as a WORD (grey) — "overdue since Tuesday" / "due today" / "due Thursday". */
export function urgencyOf(item: DoItem, today: Date = new Date()): string | null {
  const todayISO = new Date(today.getTime() - today.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
  const days = item.dueDate ? Math.round((Date.parse(item.dueDate) - Date.parse(todayISO)) / 86_400_000) : null;
  if (item.overdue) {
    // A weekday only reads as "recent" inside the last week; older is just overdue.
    if (days != null && days < 0 && days >= -6) return `overdue since ${WEEKDAY(item.dueDate!)}`;
    return 'overdue';
  }
  if (item.dueToday || days === 0) return 'due today';
  if (days === 1) return 'due tomorrow';
  if (days != null && days > 1 && days <= 6) return `due ${WEEKDAY(item.dueDate!)}`;
  return null;
}

// ── THE DERIVED-SPEECH FLOOR ────────────────────────────────────────────────────────────────────
// A WHISPER SPEAKS DERIVED SPEECH OR THE ROW DOESN'T WHISPER (census fix #9, Sep 13).
//
// Found live: the Home served, as the machine's own sentence, "📣 New for you! Exploring Sherry —
// Lisbon 🎫". `whisperSentence` falls back to the row's raw subject when `understanding.ask` is
// null, so a marketer's copy was published in the harness's voice. The receipt grammar was won at
// the template layer and lost at the source: every other word on that line is DERIVED (the judged
// ask, the machine's own state word, a mapped receipt) and this one was quoted.
//
// THE LAW: the whisper's sentence is derived speech. A row with nothing derived to say may still
// SEAT — hiding a real row costs more than a plain one — but it speaks a NEUTRAL TITLE, stripped of
// the chrome that was written to sell, and it never outranks a row that has real speech within its
// own band (the sort key below, stated once, applied in both the fold and the door).
//
// AGNOSTIC + DETERMINISTIC (never AI on the serve path): the test is a SHAPE, not a vocabulary —
// pictographic decoration and shouted punctuation are marketing chrome in every language, and the
// machine's own derivations (an ask, a work title, a state word) never contain them. No vendor, no
// token, no language list.
// ©®™ are deliberately EXEMPT: they are part of a name as written, not chrome bolted onto a
// sentence, and stripping them would edit the name itself ("GHOST®" → "GHOST").
const DECORATION = /(?![\u{00A9}\u{00AE}\u{2122}])[\p{Extended_Pictographic}\u{FE0F}\u{FE0E}\u{200D}\u{20E3}]/gu;
const SHOUT = /!{2,}|\?{2,}/;
// THE EDGE STRIP IS A SEPARATOR STRIP, NOT A PUNCTUATION STRIP (found in the fidelity walk: a
// blanket leading-punctuation trim turned "-40% em Roupa" into "40% em Roupa" — the neutralizer
// inverted a fact while removing chrome). Only characters that can ONLY be decoration are taken:
// never a sign, a currency mark or anything that could carry meaning.
const EDGE_SEPARATOR = /^[\s|·•*~>»«]+|[\s|·•*~>»«\-–—]+$/gu;

/** Is this sentence body the machine's own speech, or a quoted subject wearing sales chrome? */
export function isDerivedSpeech(body: string | null | undefined): boolean {
  const s = String(body ?? '');
  if (!s.trim()) return false;
  DECORATION.lastIndex = 0;
  return !DECORATION.test(s) && !SHOUT.test(s);
}

/** The neutral title form: the same words, with the decoration taken off. Never a new claim —
 *  nothing is added, only chrome removed (and an emptied line falls back to the caller's ladder). */
export function neutralizeChrome(body: string | null | undefined): string {
  return String(body ?? '')
    .replace(DECORATION, ' ')
    .replace(/!{2,}/g, '!').replace(/\?{2,}/g, '?')
    .replace(/\s+/g, ' ')
    // Edges left bare by the strip ("· Exploring Sherry —") are chrome too.
    .replace(EDGE_SEPARATOR, '')
    .trim();
}

/** THE SORT KEY, stated once: a row with real derived speech leads a row that only has a subject.
 *  0 = derived speech, 1 = a neutralized title. Never re-judges — only orders. */
export function speechRank(item: DoItem): number {
  return isDerivedSpeech(rawWhisperBody(item)) ? 0 : 1;
}

/** The row's own words before the floor — the ask, else the deck's second line. */
function rawWhisperBody(item: DoItem): string {
  return (item.ask ?? '').trim() || (item.second ?? '').split(' · ')[0].trim();
}

/** One sentence from the row's OWN fields — who + what. Never a new claim. */
export function whisperSentence(item: DoItem): string {
  const raw = rawWhisperBody(item);
  // THE FLOOR: derived speech passes through verbatim; anything else serves as a neutral title.
  const body = isDerivedSpeech(raw) ? raw : neutralizeChrome(raw);
  const who = (item.primary ?? '').trim();
  if (who && body) return `${who} — ${body}`;
  return body || who || 'Open this';
}

export function toWhisper(item: DoItem, today?: Date): Whisper {
  const receipt = receiptOf(item);
  return {
    item,
    sentence: whisperSentence(item),
    urgency: urgencyOf(item, today),
    receipt,
    // ONE CLAIM: a receipt outranks the state word (the prepared thing IS the state).
    note: receipt ? null : stateNoteOf(item),
  };
}

// ── THE CoS SENTENCE — RETIRED (owner call, Sep 13) ─────────────────────────────────────────────
// "in home, this feels too much, remove." Everything that lived here — CalmFacts, calmFactsFrom,
// subjectOf, deriveCalmSentence, stripRefTags/clipToOpening, leadAcknowledgesFires and the
// cosSentence source ladder — served exactly ONE consumer (the Home's CalmGreeting), so it is
// deleted rather than left standing as dead code. The law it carried is re-seated, not orphaned:
// earned calm's inverse now lives in `pickWhispers`, which seats every fire before anything else,
// so the fire is acknowledged BY THE FOLD ITSELF instead of by a sentence about it.
