// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE TRIAGE DECK'S WORDS (docs/attention-plan.md PART III — Q9 · THE TRIAGE DECK, RESHAPED BY
// Q9v2: "hard to follow, empty real estate; this [reference] seemed more simple").
//
// PURE, CLIENT-SAFE, ZERO-AI, ZERO-IO — the receipt sentence, the LATER whens, the verb table, the
// keyboard map and the thread tail's own clipping, composed from counts, a date and text handed in.
// They live apart from the component for the reason the deed's words and the ledger's sentences do:
// a CLI gate can import this file and cannot import a component, and "every word is served or
// deterministic" is only a law while something can check it.
//
// NOTHING HERE MAY REACH A MODEL, A FETCH OR A CLOCK OF ITS OWN. The receipt is composed from the
// session's own tally; the whens are composed from a day the caller hands in. A sentence that
// invents its own "today" is how a deck built at 23:58 offers "tomorrow" for yesterday.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import { clipForPrompt } from '@/lib/utils/clip-for-prompt';
import { topMessageOf } from '@/lib/inbox/top-message';

// ── THE VERBS (Q9v2 · owner's own mapping) ──────────────────────────────────────────────────────
// The v1 set (→ done · ← later · ↑ now · ↓ never) asked the reader to hold four directions and two
// promotions in their head at speed. The owner's walk replaced it with a BULK PAIR and two quiet
// companions: dismiss and done are the two deeds that clear, keep is the explicit form of a skip,
// open is a door rather than a verdict, and the dated park — the only verb that needs a second
// question answered — is demoted to a key and a chip. `never` is RETIRED as an arrow: an "always?"
// is a property of A dismissal, not a fifth direction, so the posture tail now rides ← DISMISS
// contextually, offered only where the same eligibility table says a standing version is keepable.
export type TriageVerb = 'dismiss' | 'done' | 'keep' | 'open' | 'later';

/** THE ONE KEYBOARD MAP. The component reads its bindings from here rather than typing arrow
 *  strings into a switch, so Q9v2's row (← dismiss · → done · ↑ keep · ⏎ open · L later ·
 *  space keep · Z undo · esc close) is ONE thing a gate can assert. */
export const TRIAGE_KEYS: Record<string, TriageVerb | 'undo' | 'exit'> = {
  ArrowLeft: 'dismiss',
  ArrowRight: 'done',
  ArrowUp: 'keep',
  Enter: 'open',
  ' ': 'keep',      // space is a synonym of keep — the same deed, the cheapest key on the board
  l: 'later',
  L: 'later',
  z: 'undo',
  Z: 'undo',
  Escape: 'exit',
};

/** WHERE EACH VERB SITS IN THE FRAME. The frame owns the verbs (Q9v2 · 1) and it reads their rank
 *  from this table rather than deciding it in markup: `primary` are the two big pills, `quiet` the
 *  two companions beside them, `chip` the demoted secondary. */
export type TriageRank = 'primary' | 'quiet' | 'chip';

/** The word on each verb's pill, the hint that says where the item GOES, and the key-cap it wears.
 *  Nothing here promises more than the verb's own door does. */
export const TRIAGE_VERBS: Array<{ verb: TriageVerb; label: string; hint: string; key: string; rank: TriageRank }> = [
  { verb: 'dismiss', label: 'Dismiss', hint: 'archived — and where it is a kind of mail, I can keep doing it', key: '←', rank: 'primary' },
  { verb: 'done', label: 'Done', hint: 'handled — only a new reply brings it back', key: '→', rank: 'primary' },
  { verb: 'keep', label: 'Keep', hint: 'stays waiting, undated — the deck moves on', key: '↑', rank: 'quiet' },
  { verb: 'open', label: 'Open', hint: 'the whole room', key: '⏎', rank: 'quiet' },
  { verb: 'later', label: 'Later', hint: 'comes back on the day you pick', key: 'L', rank: 'chip' },
];

export const verbsOfRank = (rank: TriageRank) => TRIAGE_VERBS.filter((v) => v.rank === rank);

/** THE WAY OUT IS NOT A VERB (owner walk, Sep 18): the exit read "Done for now" beside a DONE verb
 *  pointing the other way — one word, two meanings, opposite arrows. The exit CLOSES the deck; it
 *  decides nothing about the card. */
export const TRIAGE_EXIT_LABEL = 'Close';
export const TRIAGE_HINTS = 'L later · space keep · Z undo · esc close';
/** The undo pill's word — it appears only when there is something to undo (the frame's own test). */
export const TRIAGE_UNDO_LABEL = 'Undo';

/** THE ROW'S OWN KIND, in one plain word. A card says WHAT it is looking at — a mail, an obligation
 *  the reader made, a deal going quiet — because the verbs mean slightly different things for each
 *  and the reader is deciding at speed. Mapped from the row's own `DoItem.source`; an unmapped
 *  source says nothing rather than guessing a noun. */
export const TRIAGE_SOURCE_WORD: Record<string, string> = {
  reply: 'mail', notice: 'mail', commitment: 'commitment', deal: 'deal', meeting: 'meeting action',
};

/** WHICH ROWS HAVE A THREAD AT ALL. Only an inbox row has one (the ledger's pool is pending mail),
 *  so only an inbox row's card reaches for the thread door — a commitment card shows the founding
 *  context it was already handed and asks nothing of the network. */
export const TRIAGE_THREADED: readonly string[] = ['reply', 'notice'];

/** THE ITEM'S OWN CONVERSATION DOOR takes the item KIND, not the deck's lane token. A source with
 *  no honest mapping gets NO reply slot rather than a slot that would post to the wrong room.
 *
 *  ⚠️ PARKED (owner call, Sep 21 — "remove 'Ask or tell Clara about this…' from the cards for
 *  now"): the deck mounts no reply slot at present, so nothing reads this table today. It stays
 *  because it is the reinstatement's ONE table — the map that keeps a card from posting to the
 *  wrong room — and because a source that gains an honest kind should gain it here, once. */
export const TRIAGE_STEER_KIND: Record<string, 'email' | 'commitment' | 'meeting'> = {
  reply: 'email', notice: 'email', commitment: 'commitment', meeting: 'meeting',
};

// ── THE CARD'S OWN CONTENT (Q9v2 · 3 — "the card is the thing itself") ──────────────────────────
// The thread tail is the substance a person triages on, and it arrives from the EXISTING thread
// door. What it must never do is lie about its own length: the excerpt-honesty law is the same on a
// card as in a prompt, so the clip ends at a boundary and SAYS it was ours.

/** ~4–6 lines of a message, measured the way the law's own clipper measures. */
export const TRIAGE_MESSAGE_CHARS = 420;
/** The last 1–2 messages. The tail is what moved; the founding message is the room's job. */
export const TRIAGE_TAIL_MESSAGES = 2;

/** The raw shape `/api/inbox/[id]/thread` serves, narrowed to the fields a card reads. */
export type ThreadDoorMessage = {
  id?: string | null; from?: string | null; fromName?: string | null;
  receivedAt?: string | null; body?: string | null; snippet?: string | null;
  isFromUser?: boolean | null;
};
export type TriageMessage = { id: string; author: string; at: string | null; body: string; fromUser: boolean };

/** THE TAIL, PURE. Last ≤2 messages, oldest→newest as served, each one's OWN words (the quoted
 *  reply-chain beneath it belongs to the messages above it — `topMessageOf`, the same structural
 *  parser every judge reads through) and each clipped by THE ONE CLIPPER. A message with no body
 *  falls back to the door's own snippet; one with neither is dropped rather than rendered empty. */
export function threadTail(messages: ThreadDoorMessage[] | null | undefined): TriageMessage[] {
  const rows = Array.isArray(messages) ? messages : [];
  return rows
    .slice(-TRIAGE_TAIL_MESSAGES)
    .map((m, i) => {
      const raw = (typeof m.body === 'string' && m.body.trim()) ? topMessageOf(m.body) : (m.snippet ?? '');
      const body = clipForPrompt(String(raw ?? '').replace(/\n{3,}/g, '\n\n').trim(), TRIAGE_MESSAGE_CHARS);
      return {
        id: String(m.id ?? `m${i}`),
        author: m.isFromUser ? 'You' : (m.fromName?.trim() || m.from?.trim() || 'Them'),
        at: m.receivedAt ?? null,
        body,
        fromUser: !!m.isFromUser,
      };
    })
    .filter((m) => !!m.body);
}

/** The initial on a card's avatar — the counterparty's own first letter, never an invented one. */
export function initialOf(who: string | null | undefined): string {
  const t = (who ?? '').trim();
  const ch = t.match(/[\p{L}\p{N}]/u)?.[0] ?? '';
  return ch ? ch.toUpperCase() : '·';
}

// ── ← LATER · THE WHENS ─────────────────────────────────────────────────────────────────────────
// Two keystroke-cheap days and one real date. Every one of them is A DATE, computed from the day
// the caller hands in — "later" is never stored as a vague word (the park record has no shape for
// one, which is the point: a thing that comes back must know when).

/** UTC-safe day arithmetic on a plain ISO day — no Date-string timezone drift, no local clock. */
export function addDays(todayISO: string, days: number): string {
  const d = new Date(`${todayISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export type LaterOption = { id: 'tomorrow' | 'next_week'; label: string; after: string };

/** Tomorrow, and the coming Monday (a week out to the day when today IS Monday — "next week" that
 *  lands today would be a park that never parks). */
export function laterOptions(todayISO: string): LaterOption[] {
  const dow = new Date(`${todayISO}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  const toMonday = ((8 - dow) % 7) || 7;
  return [
    { id: 'tomorrow', label: 'Tomorrow', after: addDays(todayISO, 1) },
    { id: 'next_week', label: 'Next week', after: addDays(todayISO, toMonday) },
  ];
}

/** The day a park comes back, in the page's own quiet voice. */
export function whenWords(after: string): string {
  const d = new Date(`${after}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? after
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

// ── THE RECEIPT ─────────────────────────────────────────────────────────────────────────────────
// "session end speaks the tally". PURE-COMPOSED from the session's own counts — never a claim the
// numbers do not back, never a round-up, and SILENT when nothing was actually decided (a receipt
// for an empty session is a congratulation nobody earned).

export type TriageTally = {
  done: number; dismiss: number; later: number; postures: number;
  /** Wall-clock milliseconds the session was open — the only non-count input. */
  elapsedMs: number;
};

/** KEEP CLEARS NOTHING, so it counts as nothing: the row is exactly where it was. */
export const triageCleared = (t: TriageTally): number => t.done + t.dismiss + t.later;

/** "Cleared 20 in 4 minutes — 14 done, 5 dismissed, 3 postures taught".
 *  Every clause appears ONLY when its own count is real; an empty tally returns ''. */
export function triageReceipt(t: TriageTally): string {
  const cleared = triageCleared(t);
  if (cleared === 0 && t.postures === 0) return '';
  const mins = Math.round(t.elapsedMs / 60_000);
  const secs = Math.max(1, Math.round(t.elapsedMs / 1000));
  const span = mins >= 1 ? `${mins} minute${mins === 1 ? '' : 's'}` : `${secs} second${secs === 1 ? '' : 's'}`;
  const parts = [
    t.done ? `${t.done} done` : '',
    t.dismiss ? `${t.dismiss} dismissed` : '',
    t.later ? `${t.later} set aside` : '',
    t.postures ? `${t.postures} posture${t.postures === 1 ? '' : 's'} taught` : '',
  ].filter(Boolean);
  const head = cleared > 0 ? `Cleared ${cleared} in ${span}` : `${span} in the deck`;
  return parts.length ? `${head} — ${parts.join(', ')}.` : `${head}.`;
}

/** The line the deck shows when the stack runs out — the same tally, framed as an ending. */
export function triageEnd(t: TriageTally): string {
  const r = triageReceipt(t);
  return r ? `That is the band. ${r}` : 'That is the band — nothing left waiting.';
}
