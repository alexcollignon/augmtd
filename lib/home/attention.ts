// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ATTENTION LAYER — laws A1 (why-now) · A2 (the budget) · A3 (the held-quiet ledger classes)
// of docs/attention-plan.md.
//
// THE SENTENCE THIS MODULE SERVES: "ingest everything, hold ~95% with receipts, rank the remainder
// against current context, and decide when NOT to interrupt." The Home's failure mode before this
// was the notification tragedy of the commons in miniature — fourteen rows all reading "overdue",
// each locally defensible, globally worthless.
//
// THREE PURE FUNCTIONS, one law each:
//   • `whyNowOf`   (A1) — the row's why-now/why-you clause, composed from JUDGED FACTS ONLY. Never
//     the judge's `reason` (that is the brain talking to itself), never a raw subject, never a bare
//     "overdue".
//   • `rankAttention` (A2) — the ≤5 budget, ranked against CURRENT context. Nothing is dropped:
//     what the budget cannot seat is HELD, and held is a posture with receipts.
//   • `classifyHeld` (A3) — every held item lands in EXACTLY ONE class, derived from verdicts and
//     floors that ALREADY EXIST (the echo floor, the notice law, understanding.bulk, the CC-only
//     read, the cached judged-none). ZERO AI at serve time, by construction: every fact is handed
//     in, exactly as `lib/home/deck-floors.ts` takes its facts.
//
// PURE: no fetch, no AI, no clock beyond the caller's `today`. The gates assert the law on this
// module and on the real served payload — never on a re-derivation of either.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { DoSource } from '@/lib/home/agenda';
import type { DeckItem } from '@/lib/home/deck-floors';
import { urgencyOf, receiptWordOf } from '@/lib/home/calm';
import { getUnderstanding } from '@/lib/inbox/item-understanding';
import { isNoMoveNotice, rawMailKindOf, isAutomatedSenderStrong, listMailOf } from '@/lib/inbox/notice-demotion';
import { fromEmailOf } from '@/lib/home/deck-floors';
import { NEEDS_SHAPING_WORD, rowWordOf, LOOKS_DONE_WORD } from '@/lib/work/machine';
// THE EXCERPT-HONESTY LAW, on a surface instead of a prompt (Q9 · the triage card shows the
// message's own first words): the ONE clipper, word-boundary, declaring its own cut.
// W11.3 · a SURFACE clip is a display clip (boundary + "…") — EXCERPT_MARK is prompt-side only.
import { clipForDisplay } from '@/lib/utils/clip-for-prompt';
// THE ONE ENTITY DECODER (W5b): provider snippets arrive HTML-escaped; a plain excerpt never shows
// `&#39;` as text.
import { decodeEntities } from '@/lib/core/text';
// THE ONE PREPARED-WORK READER's pure LIVE verdict — no queries, so the ledger's own pool read is the
// only IO on this path. The deck needs to know a card HAS prepared work before it offers to review it,
// and it may only say so for work the ONE READER calls live (W7.5 — the raw list once chipped a draft
// the reader withdraws as misaddressed).
import { liveFromSourceData } from '@/lib/prepare/read';
import type { UserForms } from '@/lib/commitments/extraction-truth';
// W8.3 · THE KIND FLOOR — the judge's own predicate, read again here for verdicts cached under an
// older law (pure, client-safe; the judge applies the same one before any AI).
import { kindFloor } from '@/lib/work/kind-floor';
// W8.3 · THE ONE SHORT-DATE GRAMMAR — a served sentence never prints a raw ISO date.
import { fmtMonthDay } from '@/lib/utils/format-date';
import { HELD_BAND_ROWS_BOUND } from '@/lib/deeds/held-words-bulk';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ════════════════════════════════════════════════════════════════════════════════════════════════
// A1 · THE WHY-NOW CLAUSE
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** The calendar adjacency fact: an event within the window whose attendees/organiser overlap this
 *  row's counterparty. Derived by the caller from real events — never guessed here. */
export type CalendarAdjacency = {
  /** The event's time in the USER's zone, already formatted ("14:00" / "all day"). */
  localTime: string | null;
  title?: string | null;
  /** THE DAY ANCHOR (Sep 18): WHICH event this row is adjacent to. The fact was always computed —
   *  it simply never carried its own id, so a row whose only reason to be on the deck was "someone
   *  in your 15:30 sent this" had nowhere to live but the floating list. With the id, the row can
   *  sit UNDER its meeting, where its why-now is already stated. */
  eventId?: string | null;
  /** Is that event TODAY (the user's own day)? `undefined` from a caller that has not computed it,
   *  which the rank treats as today — the honest default for a 48h window's near half. */
  today?: boolean;
};

export type WhyNowFacts = {
  /** Q4 · the seat contract's verdict on this row: it earned a seat with nothing staged on it. */
  needsShaping?: boolean;
  /** The deck lane — a judged fact, not a guess: `notice` means the counterpart is a SYSTEM. */
  source: DoSource;
  /** The counterparty as the deck already prints it (sender name / commitment counterparty). */
  who?: string | null;
  dueDate?: string | null;
  overdue?: boolean;
  dueToday?: boolean;
  /** The deck's own prepared token — 'draft' (in-house) or a coworker's name. */
  prepared?: string | null;
  /** WHAT is prepared — THE ONE READER's lead kind (W2.1); the receipt words itself by it. */
  preparedKind?: string | null;
  /** THE MACHINE'S ONE WORD (lib/work/machine.ts STATE_WORDS), as served. */
  stateWord?: string | null;
  /** A1's calendar half — this row's counterparty sits on the near calendar. */
  meeting?: CalendarAdjacency | null;
  /** W11.2 · LOOKS DONE — the evidence line (who · what · when) the machine served with its word. */
  evidenceLine?: string | null;
};

/** One clause, one line: the cap keeps a why-now a clause and not a paragraph. */
export const WHY_NOW_MAX_CHARS = 84;

/** The ask states the machine itself names — a row blocked ON THE USER. Read off the served word,
 *  never a keyword test on a title (the same table `lib/home/calm.ts` reads for its door rank). */
const ASK_STATE_WORDS = new Set(['needs one thing from you', 'decision laid out']);

/** Word-boundary clip — never a mid-word cut (the excerpt-honesty law's smallest form). */
function clipClause(s: string, max = WHY_NOW_MAX_CHARS): string {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const at = cut.lastIndexOf(' ');
  return (at > max * 0.5 ? cut.slice(0, at) : cut).replace(/[\s,;:·–—-]+$/, '') + '…';
}

/** THE RECEIPT HALF, mapped (never authored) — the same mapping `calm.receiptOf` prints. */
function receiptWord(f: WhyNowFacts): string | null {
  return receiptWordOf(f.prepared ?? null, f.preparedKind ?? null, f.source);
}

/** THE WHY-YOU HALF — what this lane means for the person reading it. Honest per lane: a `notice`
 *  has no human on the other end, so it is never made to sound like one. */
function whyYou(f: WhyNowFacts): string {
  // Who-less by law — the row's own first words are the counterparty (the no-restatement rule).
  switch (f.source) {
    case 'reply': return 'waiting on your reply';
    case 'commitment': return 'you committed to this';
    case 'notice': return 'needs an action from you';
    case 'deal': return 'quietly slipping';
    default: return 'this is on your plate';
  }
}

/**
 * THE WHY-NOW CLAUSE (A1). Pure, deterministic, composed from judged facts only.
 *
 * The ladder, stated once:
 *   1. CALENDAR ADJACENCY outranks everything — "Jordan will ask at your 14:00" is the only fact on
 *      the deck that answers *why now* with the day's own shape.
 *   2. Otherwise: a PRIMARY (the receipt the system earned, or the state word it is blocked on, or
 *      the why-you sentence) · and the DUE WORDS beside it, when a date exists.
 *
 * THE BARE-OVERDUE BAN is structural, not a filter: the due words can never be the whole clause
 * because a primary is always composed first. Fourteen rows reading "overdue" carry zero
 * information; fourteen rows reading who is waiting and what is ready carry fourteen.
 */
export function whyNowOf(f: WhyNowFacts, today: Date = new Date()): string {
  // 0 · W11.2 LOOKS DONE — the evidence says it may already be finished: the clause is the machine's
  // word and the evidence (who · what · when); no due words (an "overdue" on done work is false).
  if ((f.stateWord ?? '').trim() === LOOKS_DONE_WORD) {
    const line = (f.evidenceLine ?? '').trim();
    return clipClause(line ? `${LOOKS_DONE_WORD} · ${line}` : LOOKS_DONE_WORD);
  }
  // 1 · CALENDAR ADJACENCY — the strongest why-now the clock can give.
  if (f.meeting) {
    const who = (f.who ?? '').trim();
    const at = (f.meeting.localTime ?? '').trim();
    if (who && at) return clipClause(`${who} will ask at your ${at}`);
    if (at) return clipClause(`this comes up at your ${at}`);
    if (who) return clipClause(`${who} is on your calendar today`);
    return clipClause('this is on your calendar today');
  }
  // 2 · THE PRIMARY — receipt, else the ask the machine is blocked on, else the why-you sentence.
  // THE NO-RESTATEMENT RULE (walk-found, Sep 17): the whisper row ALWAYS leads with the
  // counterparty's name, so the clause never repeats it — "X — task — X, ready to send" read as
  // stutter on the live page. The name appears only where it does NEW work: the calendar-adjacency
  // branch above (who will ask, at what time — possibly a different person than the row names).
  // Q4 · THE SEAT CONTRACT'S WORD sits between the ask states and the lane sentence: a row seated
  // with nothing staged says so HONESTLY, in the machine's own word, rather than borrowing the
  // "waiting on your reply" grammar of a row that actually has a reply waiting.
  // W11.1 · THE ROW'S ONE WORD (lib/work/machine.ts rowWordOf): the machine's blocked-on-user word
  // outranks the receipt — "ready to send · overdue" beside a room saying "needs one thing from you"
  // was one item wearing two states (owner walk, Sep 23).
  const receipt = receiptWord(f);
  const stateWord = (f.stateWord ?? '').trim();
  const primary = (ASK_STATE_WORDS.has(stateWord) ? rowWordOf(receipt, stateWord) : receipt)
    ?? (f.needsShaping ? NEEDS_SHAPING_WORD : whyYou(f));
  // 3 · THE DUE WORDS — beside the primary, never alone (`urgencyOf` is the ONE date vocabulary).
  const due = urgencyOf({ source: f.source, key: '', entityId: '', href: '', ask: '',
    dueDate: f.dueDate ?? null, overdue: !!f.overdue, dueToday: !!f.dueToday } as any, today);
  return clipClause(due ? `${primary} · ${due}` : primary);
}

/** THE BAN, as a predicate the gate can assert: a clause that says only "overdue" says nothing. */
export function isBareOverdue(clause: string | null | undefined): boolean {
  return /^overdue\.?$/i.test(String(clause ?? '').trim());
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// A2 · THE BUDGET
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** THE BUDGET LAW's number. "The 6th-best thing goes to the ledger however good it is." */
export const ATTENTION_BUDGET = 5;

export type AttentionRow = {
  /** The deck's own row key. */
  key: string;
  /** The atom id the rest of the payload is keyed by (item id / commitment id). */
  entityId: string;
  source: DoSource;
  whyNow: string;
  calendarAdjacent?: boolean;
  prepared?: string | null;
  /** WHAT is prepared (W2.1) — rides beside the who-token so the receipt can word itself. */
  preparedKind?: string | null;
  overdue?: boolean;
  dueToday?: boolean;
  dueDate?: string | null;
  // ── Q4 · THE SEAT CONTRACT's three facts, handed in like every other fact this module reads. ──
  /** TEST (a) REAL COUNTERPARTY — the Q1 floor's verdict on this row's sender: our own coworker's
   *  mail is a POINTER to work that already stands, never the work itself. Handed in from
   *  `lib/inbox/self-echo` (itemIsSelfEcho) — never re-derived here. */
  selfAuthored?: boolean;
  /** TEST (b) ALIVE — Q7's proof-of-life verdict. `false` is the ONLY value that unseats a row;
   *  `true`/`null`/absent all mean alive (see `aliveByContract`). */
  provedAlive?: boolean | null;
  // ── THE DAY ANCHOR + THE FRESH SEAT (Sep 18 — the owner's morning: two week-old rows floating
  //    alone, both there only because their people sit in today's 15:30, while the night's real
  //    arrivals waited in the ledger). Two facts, handed in like every other. ─────────────────────
  /** The event this row's seat CAME FROM — set only when the adjacency fact is what put it here.
   *  The Home excludes an anchored row from the floating whispers and the day frame renders it
   *  under its meeting: one fact, one home (the anchor is not a second claim about the row). */
  anchoredToEventId?: string | null;
  /** Is the adjacency meeting TODAY? Only a computed `false` demotes (see `attentionRank`). */
  adjacencyToday?: boolean;
  /** THE FRESH SEAT: this work was FIRST JUDGED within the day — the deck's own "surfaced today"
   *  fact (`machine.judgedFirstAt`), never a second derivation of newness. */
  fresh?: boolean;
  /** W11.2 · LOOKS DONE — the machine's `looks_done` state: user-side evidence the judge did not
   *  close on. Seated only BELOW every row of real work (rank 6). */
  looksDone?: boolean;
};

// ════════════════════════════════════════════════════════════════════════════════════════════════
// Q4 · THE SEAT CONTRACT (docs/attention-plan.md PART III — the owner's Sep 17 walk)
//
// "The needs-you budget is 5 seats for FINISHED PREPARATION, not 5 rankings."
//
// The audit that forced it: 8 of the 40 newest actionable items had ANYTHING staged, the deck's top
// rows were our own coworkers' reminder mail (Q1), and a CTA read "Confirm Sep 14 call status, send
// material, lock call time" — a to-do list wearing a button. A seat is a promise that work was
// done; five rankings are a promise that work was SORTED.
//
// THREE TESTS, and the two kinds of failure are DIFFERENT:
//   (a) REAL COUNTERPARTY — never ourselves. Failing it means the row is not work at all: HELD,
//       and the ledger accounts for it (nothing is deleted, A3).
//   (b) ALIVE — proof of life (Q7). Failing it means the row stopped being true: HELD, same door.
//   (c) PREPARED — an artifact is staged. Failing it does NOT unseat: a real, alive obligation is
//       still the user's to know about. It seats WEARING THE HONEST WORD ("needs shaping", the
//       machine's own vocabulary) and its CTA becomes the CoS's offer to shape it (Q6) — and it
//       yields its seat to any prepared row of equal urgency.
//
// THE COORDINATION CONTRACT (named, so the Q7 lane can land beside this without a rendezvous):
// `provedAlive` is a THREE-VALUED fact — `false` unseats, everything else (true, null, absent)
// means alive. A missing proof-of-life pass therefore changes nothing, which is the only safe
// default: a fact we never computed must never be read as "this went quiet".
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** THE ALIVENESS DEFAULT, stated once: only a computed `false` unseats a row. */
export function aliveByContract(provedAlive?: boolean | null): boolean {
  return provedAlive !== false;
}

export type SeatVerdict = {
  /** May this row occupy one of the day's five at all? */
  seated: boolean;
  /** Why not — the word the ledger and the gates read. */
  refusal: 'self' | 'not_alive' | null;
  /** Seated, but with nothing staged: the honest word rides its why-now and its CTA is an offer. */
  needsShaping: boolean;
};

/** THE SEAT TESTS (pure). One row, three facts, one verdict — every caller reads THIS. */
export function seatVerdict(r: AttentionRow): SeatVerdict {
  if (r.selfAuthored === true) return { seated: false, refusal: 'self', needsShaping: false };
  if (!aliveByContract(r.provedAlive)) return { seated: false, refusal: 'not_alive', needsShaping: false };
  return { seated: true, refusal: null, needsShaping: !r.prepared };
}

/** Does this row wear the seat word? (The surfaces read the served clause; the gates read this.) */
export const rowNeedsShaping = (r: AttentionRow): boolean => seatVerdict(r).needsShaping;

/** The seat word, re-exported from the machine's vocabulary so no surface types the literal. */
export { NEEDS_SHAPING_WORD };

/**
 * THE PROOF-OF-LIFE READER (the named optional field of the coordination contract above).
 *
 * Q7's lane stamps an item it re-grounded with `source_data.proof_of_life` — either the word
 * (`'alive' | 'quiet'`) or `{ alive: boolean }`. NOTHING ELSE IS READ, and an absent/unknown stamp
 * returns `null`, which `aliveByContract` treats as alive. One reader, so the day the lane lands
 * the seat contract consumes it without a second derivation appearing anywhere.
 */
export function provedAliveOf(sourceData: unknown): boolean | null {
  const p = (sourceData as { proof_of_life?: unknown } | null | undefined)?.proof_of_life;
  if (p === 'alive') return true;
  if (p === 'quiet') return false;
  const alive = (p as { alive?: unknown } | null | undefined)?.alive;
  return typeof alive === 'boolean' ? alive : null;
}

/**
 * THE RANK, against CURRENT context (A2): the next calendar event's adjacency outranks age; a
 * consequence today outranks a bigger consequence next week.
 *   0 · calendar-adjacent TODAY — someone will ask you about this before the day is out
 *   1 · FRESH — first judged within the day (see below)
 *   2 · prepared AND overdue — the work is done and the clock has passed; one click clears it
 *   3 · due today
 *   4 · calendar-adjacent LATER (tomorrow's meeting) — a real reason, but not today's shape
 *   5 · everything else, in the order the caller handed it (the judged weight order)
 *
 * THE FRESH SEAT (Sep 18, the owner: "we need to be able to present helpfulness almost instantly…
 * the user can't wait half a day"). His morning Home held two WEEK-OLD rows floating alone — both
 * seated purely because their counterparties sit on the day's calendar — while the night's real
 * arrivals sat in the ledger waiting for a sweep. So: AT EQUAL BAND, A FRESH ARRIVAL OUTRANKS A
 * STALE CALENDAR-ADJACENT ROW, **unless the adjacency meeting is TODAY** — today's meeting still
 * wins, because it is the day's own shape and nothing else on the deck can state a why-now that
 * strong. `adjacencyToday` is three-valued the way `provedAlive` is: only a computed `false`
 * demotes, so a caller that has not computed the day keeps the old behaviour exactly.
 */
export function attentionRank(r: AttentionRow): number {
  // W11.2 · a row that LOOKS DONE is a confirmation, not work — it ranks below everything real.
  if (r.looksDone) return 6;
  if (r.calendarAdjacent && r.adjacencyToday !== false) return 0;
  if (r.fresh) return 1;
  if (r.prepared && r.overdue) return 2;
  if (r.dueToday) return 3;
  if (r.calendarAdjacent) return 4;
  return 5;
}

/**
 * THE ONE CHOKE POINT (A2 × Q4). THE SEAT TESTS FIRST, then the rank, then the cut at the budget.
 * NOTHING IS DROPPED — everything the contract refuses and everything the budget cannot seat is
 * returned as `held`, and the held-quiet ledger accounts for every one of them.
 *
 * Stable: rows of equal rank keep the caller's order, so the judged weight ordering survives the
 * cut. Within one rank, Q4's preference applies — A PREPARED ROW OUTRANKS A NEEDS-SHAPING ROW at
 * equal urgency (finished preparation is what a seat is FOR; the shaping offer can wait a day).
 */
export function rankAttention(
  rows: AttentionRow[], budget: number = ATTENTION_BUDGET,
): {
  served: AttentionRow[]; held: AttentionRow[]; refused: Array<{ row: AttentionRow; refusal: 'self' | 'not_alive' }>;
} {
  const eligible: AttentionRow[] = [];
  const refused: Array<{ row: AttentionRow; refusal: 'self' | 'not_alive' }> = [];
  for (const r of rows) {
    const v = seatVerdict(r);
    if (v.seated) eligible.push(r);
    else refused.push({ row: r, refusal: v.refusal! });
  }
  const ordered = eligible
    .map((r, i) => ({ r, i }))
    .sort((a, b) =>
      (attentionRank(a.r) - attentionRank(b.r))
      || (Number(rowNeedsShaping(a.r)) - Number(rowNeedsShaping(b.r)))
      || (a.i - b.i))
    .map((x) => x.r);
  // W13.4 · ONE ITEM, ONE ROW (owner call, Sep 24 — the W11.2 conversation fold is retired): every
  // eligible row takes its own seat, individually trackable. Grouping related work is what a
  // user-created PROJECT is for; the conversation DELTA (lib/work/conversation-delta.ts) keeps the
  // data itself from hoarding.
  const cap = Math.max(0, budget);
  // A REFUSED ROW IS HELD, NEVER DELETED — it leads the held list so the ledger sees it first.
  return {
    served: ordered.slice(0, cap),
    held: [...refused.map((x) => x.row), ...ordered.slice(cap)],
    refused,
  };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// A3 · THE HELD-QUIET CLASSES
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * THE CLASS UNION — first-match precedence, stated once in `classifyHeld` below.
 *
 * ADDING A CLASS (the coordination contract, Sep 17): a new member of this union needs (a) its seat
 * in the precedence ladder inside `classifyHeld`, (b) a row in `HELD_CLASSES`, (c) a seat in
 * `HELD_CLASS_ORDER`, and (d) NOTHING in `bandOf` unless it is a WATCHED class — every class not
 * named in `WATCHED_CLASSES` lands in `handled` by default, so a later `self_echo` (the user's own
 * coworkers' mail, Q1's seam) slots in without touching the band law at all.
 */
export type HeldClassId =
  | 'brought_forward' | 'own_outreach' | 'judged_quiet' | 'bulk_mail'
  | 'notices' | 'cc_watch' | 'not_judged' | 'quieter_threads';

/** The facts a held item is classified from. EVERY ONE already exists somewhere in the house —
 *  this module derives nothing new and calls nothing. (A3: "zero new AI passes at serve time".) */
export type HeldFacts = {
  item: DeckItem;
  /** THE ECHO FLOOR (`lib/inbox/campaign-echo` isCampaignEcho) — the caller asks it once. */
  isEcho: boolean;
  /** The CACHED judgment said "nothing to do here". */
  judgedNone: boolean;
  /** …and the disposition it named, when it named one ('expired' | 'answered'). */
  judgedResolution?: string | null;
  /** A1's calendar fact, reused: context re-promotes this item. */
  calendarAdjacent?: boolean;
  /** True when the budget (A2), not a floor, is why this item is held. */
  budgetOverflow?: boolean;
  /** Q2's WATCHED half: the judged ownership key says someone ELSE owes the next move (or the item's
   *  own work_state is `waiting`). A state, never a to-do — read off cached facts, never a thread walk. */
  waitingOnOthers?: boolean;
  /** When this item last moved (last_activity_at ?? created_at) — the graduation clock's only input. */
  quietSince?: string | null;
  /** A judged stated deadline that is TODAY OR AHEAD (understanding.deadline, code-compared to the
   *  user's day by the caller). The only fact that can lift machinery into WAITING. */
  deadlineAhead?: boolean;
  /** Q9 · THE PERSON'S OWN PARK — the date on this item's cached verdict when the PERSON set it
   *  (`revisit.by === 'user'`, written by the triage deck's ← LATER through lib/work/judge.ts's
   *  parkItem). Read off the SAME judgments map the judged-none facts come from: no second store,
   *  no extra query. */
  userParkedUntil?: string | null;
  /** …and whether that day has ARRIVED (code-compared to the user's day by the caller — this module
   *  owns no clock). The arrival is what lifts the row back into WAITING and what makes the row's
   *  why-line say the person asked for it. */
  userParkDue?: boolean;
  /** W8.3 · THE LIST SAYS ONLY WHAT WAS JUDGED. `true` = NO cached judgment exists for this item at
   *  all (item_plans kind 'judgment' key `inbox:<id>` absent). Its only "work" evidence is an
   *  understanding — often a July-era one, written before the reasoned kind existed and miscalibrated
   *  (a streaming service's sign-in code read as `you_owe · action`). Such a row may NEVER claim to be
   *  real, alive and held for the budget: it files as `not_judged` and says so. Three-valued like
   *  `provedAlive`: absent = the caller did not compute it (the legacy behaviour holds). */
  neverJudged?: boolean;
  /** W8.3 · the cached verdict is WORK (not none) and was judged under the CURRENT JUDGE_VERSION —
   *  i.e. the judge already applied the kind floor with the thread in view. Absent/false → the kind
   *  floor is re-applied here (a pitch judged `schedule` under the older law is not work). */
  judgedCurrent?: boolean;
};

/**
 * THE PRECEDENCE, stated once and in this order (first match wins; every held item lands in
 * EXACTLY ONE class):
 *
 *   1. brought_forward — CONTEXT RE-PROMOTES IT. A row whose counterparty sits on the near calendar
 *      is held only because the budget was full; it is the first thing the ledger should offer back.
 *      NEVER NOISE (W5b): a row the bulk or notice floors below would file is not alive, so no
 *      calendar adjacency can promote it (a notetaker bot is an attendee of every meeting it records).
 *   2. own_outreach   — the echo floor (LAW 5): the user's own outbound campaign coming back.
 *      Above the notice law deliberately: `isNoMoveNotice` also swallows echoes, and "your own
 *      sequence answered itself" is a far better account than "a notice".
 *   3. judged_quiet   — the brain's own explicit disposition (a judged-none carrying `expired` /
 *      `answered`). The most specific account a held row can carry, so it outranks the structural
 *      floors below.
 *   4. bulk_mail      — understanding.bulk, a newsletter/marketing kind, or the List-Unsubscribe
 *      header. Before `notices` because the notice law counts a newsletter as a no-move notice, and
 *      "a newsletter" is the truer word for it.
 *   5. notices        — the ownership-keyed notice law: automated / no-move mail, payment and
 *      account notices included.
 *   6. cc_watch       — the user is CC-only / one of many and the judged ownership key says nothing
 *      is owed BY THEM. (Engagement is read off that judged key — never a thread walk at serve
 *      time, which is how a ledger read becomes a page load.)
 *   7. quieter_threads — the remainder: real correspondence the budget did not reach.
 */
export function classifyHeld(f: HeldFacts): HeldClassId {
  const it = f.item;
  const sd = (it.source_data ?? {}) as Record<string, unknown>;
  const u = getUnderstanding(it as any);

  // THE CALENDAR-ARTIFACT EXCLUSION (walk-found Sep 17): a calendar invite/RSVP email is BY
  // CONSTRUCTION adjacent to a calendar event — its sender is the meeting's own machinery — so
  // without this floor every "invite/accepted" mail flooded brought_forward and the promoted
  // section became the wall the ledger exists to end. The meeting itself lives in the day frame;
  // its mail is machinery. Kind is the agnostic detector (structural ics headers, any language) —
  // never a subject-word list.
  //
  // AND IT IS A WAITING ROW OR IT IS NOT BROUGHT FORWARD (Q2, Sep 17). A3's own words: a
  // brought-forward row "is held only because the budget was full". Adjacency is a PROMOTION of
  // something already alive — never a promotion of a newsletter whose sender happens to sit on
  // today's calendar. Requiring `budgetOverflow` makes the class a strict subset of the WAITING band,
  // which is what lets the section dissolve into that band instead of standing as its own wall.
  const kindWord = (rawMailKindOf(sd) ?? '').toLowerCase();
  const kind = kindWord;
  // THE NOISE FACTS, read ONCE and BEFORE adjacency (W5b, owner walk Sep 23): a notetaker bot's
  // address sits on the calendar as an ATTENDEE of every recorded meeting, so its "your bot wasn't
  // admitted" notices were calendar-adjacent and LED the waiting band as brought-forward — A3's
  // own words forbid exactly that ("never a promotion of a newsletter whose sender happens to sit
  // on today's calendar"). Adjacency promotes something already ALIVE; bulk mail and no-move
  // notices never are, so they can never be brought forward.
  const bulk = u?.bulk === true || kind === 'newsletter' || sd.has_unsubscribe === true
    || it.rule_type === 'marketing';
  const noMove = isNoMoveNotice({
    u, rawKind: rawMailKindOf(sd), fromEmail: fromEmailOf(sd),
    fromName: (sd.from_name as string) || null,
    subject: (sd.subject as string) || it.work_title || null,
    workState: (it.work_state as string) || null,
    campaignEcho: f.isEcho,
    listMail: listMailOf(sd),
  });
  const autoSender = isAutomatedSenderStrong(fromEmailOf(sd), (sd.from_name as string) || null,
    (sd.subject as string) || it.work_title || null);
  const notice = noMove || autoSender;
  // The echo is NOT noise for adjacency (the precedence below is deliberate: a reply into your own
  // sequence from someone on your calendar is alive) — so the adjacency test asks the notice law
  // WITHOUT the echo input; everything else it swallows is noise.
  const noticeApartFromEcho = autoSender || (f.isEcho ? isNoMoveNotice({
    u, rawKind: rawMailKindOf(sd), fromEmail: fromEmailOf(sd),
    fromName: (sd.from_name as string) || null,
    subject: (sd.subject as string) || it.work_title || null,
    workState: (it.work_state as string) || null,
    campaignEcho: false,
    listMail: listMailOf(sd),
  }) : noMove);
  // W8.3 · THE KIND FLOOR, re-read at serve time (the judge applies it before AI; a verdict cached
  // under an older law — or no verdict at all — did not). A current-law WORK verdict is the judge's
  // own word with the thread in view (the only way an unsolicited kind is work: the user answered).
  // Three-valued like every W8.3 fact: `undefined` = the caller computed no judgment facts (the legacy
  // law holds, the floor stays silent); `true` = the judge's current-law word stands.
  // W11.3 · THE PLATFORM FACET is structural (the sender, not a judgment), so it reaches EVERY
  // verdict — current-law or not: the platform's own mail is never held as the user's work.
  const kf = f.judgedCurrent !== false ? kindFloor({ kind: null, fromEmail: fromEmailOf(sd) })
    : kindFloor({ kind: (sd.kind_override as string) || u?.mailKind || null, ownership: u?.ownership ?? null, fromEmail: fromEmailOf(sd) });
  const floorBulk = kf.refuses && kf.why === 'unsolicited';
  const floorNotice = kf.refuses && (kf.why === 'notice' || kf.why === 'platform');
  // A ROW NOBODY JUDGED IS NEVER BROUGHT FORWARD (W8.3): adjacency promotes something already
  // judged alive — never a row whose only evidence is a stale understanding.
  if (f.calendarAdjacent && f.budgetOverflow === true && f.neverJudged !== true && kindWord !== 'calendar' && !bulk && !noticeApartFromEcho && !kf.refuses) return 'brought_forward';
  if (f.isEcho) return 'own_outreach';
  if (f.judgedNone && f.judgedResolution) return 'judged_quiet';

  if (bulk || floorBulk) return 'bulk_mail';
  if (notice || floorNotice) return 'notices';

  const bystander = sd.is_cc_only === true || u?.role === 'bystander' || u?.role === 'one_of_many';
  const owesNothing = u?.ownership !== 'you_owe';
  if (bystander && owesNothing) return 'cc_watch';

  if (f.judgedNone) return 'judged_quiet';
  // W8.3 · THE LIST SAYS ONLY WHAT WAS JUDGED: a deck-eligible row with no judgment at all is not
  // "real, but it did not make today's five" — nobody has judged it. It says so, in its own class.
  if (f.budgetOverflow === true && f.neverJudged === true) return 'not_judged';
  return 'quieter_threads';
}

/** The ledger's own vocabulary. Label + the CANONICAL consequence-of-waiting sentence + the class's
 *  natural verb (A7's seat — declared here so W2's bulk deed reads from ONE table). */
export const HELD_CLASSES: Record<HeldClassId, { label: string; consequence: string; deed: string }> = {
  brought_forward: {
    label: 'Brought forward',
    consequence: 'these touch something on your calendar — they lead the deck when the day comes',
    deed: 'surface',
  },
  own_outreach: {
    label: 'Your own outreach, answered',
    consequence: 'logged; you’d only slow it down',
    deed: 'archive',
  },
  judged_quiet: {
    label: 'Already settled',
    consequence: 'settled — nothing changes if these wait',
    deed: 'archive',
  },
  bulk_mail: {
    label: 'Newsletters & promotions',
    consequence: 'nothing changes if these wait',
    deed: 'unsubscribe',
  },
  notices: {
    label: 'Notices',
    consequence: 'no one is waiting on you — nothing changes if these wait',
    deed: 'archive',
  },
  cc_watch: {
    label: 'Watched',
    consequence: 'watched — you’ll hear if anyone asks you something',
    deed: 'archive',
  },
  not_judged: {
    label: 'Not yet judged',
    consequence: 'never judged against your work — open one and it is judged; none is claimed as yours to do',
    deed: 'archive',
  },
  quieter_threads: {
    label: 'Quieter threads',
    consequence: 'nothing changes if these wait',
    deed: 'archive',
  },
};

export const HELD_CLASS_ORDER: HeldClassId[] = [
  'brought_forward', 'own_outreach', 'judged_quiet', 'bulk_mail', 'notices', 'cc_watch', 'not_judged', 'quieter_threads',
];

// ════════════════════════════════════════════════════════════════════════════════════════════════
// Q2 · HELD ≠ HANDLED — THE GRADIENT (docs/attention-plan.md PART III)
//
// THE FAILURE THIS ENDS, in the owner's words: "it's 0 to 100, no in-between." One door said
// "Held quiet · 4,939" — a number so large it is not a queue, it is a weather report — and behind it
// every class from a genuinely-alive thread to a six-month-old promotion sat in one undifferentiated
// pile. Held and HANDLED are different postures and the ledger must say which is which.
//
// THREE BANDS, one fact each:
//   • WAITING  — alive, real, and held ONLY by the budget. THE DOOR SPEAKS THIS NUMBER AND NO OTHER.
//                Small by construction (it is the deck's own overflow), and a calendar-adjacent row
//                leads it, worded by its adjacency.
//   • WATCHED  — the user was copied, or somebody else owes the next move. STATE, not a to-do: one
//                line and a count, folded.
//   • HANDLED  — the big number. Filed, with receipts: classes, counts, consequences, verbs. It is
//                reassurance at the bottom of the ledger, never a door on the Home.
//
// THE BAND LAW is a pure function of ONE class + ONE set of already-derived facts; first match wins:
//   1. a WATCHED class, or the waiting-on-others fact → watched
//   2. the budget (not a floor) is why it is held       → waiting
//   3. everything else                                  → handled
// A class absent from `WATCHED_CLASSES` needs no edit here to be handled correctly — see the union's
// own note. A row can therefore be `quieter_threads` in TWO bands (waiting when deck-eligible,
// handled when a floor refused it), which is exactly right: the class says what it IS, the band says
// what the agent DID with it.
// ════════════════════════════════════════════════════════════════════════════════════════════════

export type HeldBandId = 'waiting' | 'watched' | 'handled';
export const HELD_BAND_ORDER: HeldBandId[] = ['waiting', 'watched', 'handled'];

/** The classes that are STATE rather than work, whatever the budget did with them. */
const WATCHED_CLASSES: ReadonlySet<HeldClassId> = new Set<HeldClassId>(['cc_watch']);

export const HELD_BANDS: Record<HeldBandId, { title: string; sentence: string }> = {
  waiting: {
    title: 'Waiting',
    // W8.3: every row in this band carries a WORK judgment (or the person's own park) — the sentence
    // claims exactly that and nothing a stale understanding could have supplied.
    sentence: 'judged yours to do, and held only because today’s five were fuller — bring any of them forward',
  },
  watched: {
    title: 'Watched',
    sentence: 'someone else owes the next move — you’ll hear if anyone asks you something',
  },
  handled: {
    title: 'Handled',
    sentence: 'filed with receipts — nothing changes if these wait, and nothing is deleted',
  },
};

/** THE MACHINERY-STAYS-MACHINERY SET (walk-found Sep 18): an automated notice that is deck-eligible
 *  (the action-worthy-automated refinement) can overflow the budget — but WAITING claims "real,
 *  alive", and a row wearing "no reply is possible" inside that band is a contradiction on one
 *  screen. Noise classes reach WAITING only on a judged stated deadline that is still ahead — and
 *  bulk_mail/own_outreach NEVER do (a sender's own "sale ends today" is not the reader's deadline;
 *  the NO_DEADLINE_CLASSES lesson, again). */
const NOISE_CLASSES: ReadonlySet<HeldClassId> = new Set(['notices', 'bulk_mail', 'own_outreach', 'judged_quiet']);
const DEADLINE_LIFTABLE: ReadonlySet<HeldClassId> = new Set(['notices', 'judged_quiet']);

/** THE BAND LAW (pure, first match wins — see the block comment above). */
export function bandOf(cls: HeldClassId, f: HeldFacts): HeldBandId {
  // Q9 · A DATE THE PERSON SET IS AN APPOINTMENT, AND IT IS KEPT. The triage deck's ← LATER parks an
  // item through the judgment's own `revisit` (lib/work/judge.ts parkItem), which makes it a plain
  // judged-none — and a plain judged-none is `judged_quiet`, which is machinery, which is HANDLED.
  // Without this clause "show me this on Thursday" would file the thing on Thursday instead. So the
  // park's ARRIVAL lifts its row into WAITING ahead of every class rule, and only the arrival does:
  // while the date is still ahead the row stays filed, which is the whole point of parking it.
  if (f.userParkedUntil && f.userParkDue === true) return 'waiting';
  if (WATCHED_CLASSES.has(cls) || f.waitingOnOthers === true) return 'watched';
  // W8.3 · NOTHING UNJUDGED WAITS. The waiting band claims a judgment; a row with none — whatever its
  // class, deadline or adjacency — is filed, with its own honest account (`not_judged`).
  if (f.neverJudged === true || cls === 'not_judged') return 'handled';
  if (f.budgetOverflow === true) {
    if (!NOISE_CLASSES.has(cls)) return 'waiting';
    if (DEADLINE_LIFTABLE.has(cls) && f.deadlineAhead === true) return 'waiting';
    return 'handled';
  }
  return 'handled';
}

// ── Q8 · THE INTERNAL BRIDGE IS NEVER A BRIDGE ──────────────────────────────────────────────────
// The repo's oldest person-bridge lesson, reaching the calendar-adjacency fact: an internal
// colleague attends EVERYTHING, so a recurring internal meeting with five teammates made every
// teammate's mail "calendar-adjacent" and brought_forward became the wall this arc exists to end.
// A bridge must be a real EXTERNAL counterparty.
//
// A FREE-MAIL DOMAIN IS NEVER "the user's corporate domain" (the inverse swallow: a user whose own
// address sits on a public provider would otherwise have every sender there excluded as a teammate).

/** The public mailbox providers — a personal address never denotes an organisation. (Fourth copy in
 *  the repo by design: this module imports NOTHING, which is the property AT2/AT5 gate.) */
export const PUBLIC_MAIL_DOMAINS: ReadonlySet<string> = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'yahoo.com',
  'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com', 'pm.me',
  'gmx.com', 'gmx.de', 'mail.com', 'yandex.com', 'zoho.com', 'web.de',
]);

/** Our own coworkers' sending domain — always internal, on every account. */
export const COWORKER_MAIL_DOMAIN = 'team.augmtd.ai';

const domainOf = (email: string): string => String(email).toLowerCase().split('@')[1]?.trim() ?? '';

/**
 * The user's INTERNAL domains, from their own addresses (connections + profile). Free-mail domains
 * are deliberately excluded: they identify a person, never an organisation.
 */
export function internalDomainsOf(addresses: Array<string | null | undefined>): Set<string> {
  const out = new Set<string>([COWORKER_MAIL_DOMAIN]);
  for (const a of addresses) {
    const d = domainOf(String(a ?? ''));
    if (d && !PUBLIC_MAIL_DOMAINS.has(d)) out.add(d);
  }
  return out;
}

/** Is this address a teammate (same corporate domain / our own coworker) rather than a counterparty? */
export function isInternalBridge(email: string | null | undefined, internal: ReadonlySet<string>): boolean {
  const d = domainOf(String(email ?? ''));
  return !!d && internal.has(d);
}

/** How many held rows one near-calendar day may promote. Past this the adjacency fact is not
 *  information, it is a recurring meeting's attendee list — the overflow keeps its true class. */
export const MAX_ADJACENCY_PROMOTIONS = 3;

const WEEKDAY = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long' });

/**
 * THE CONSEQUENCE SENTENCE (A3), deterministic.
 *
 * A class with a REAL deadline inside it speaks that deadline; a class without speaks its canonical
 * honest sentence. "Real" is deliberately narrow: a code-verifiable stated date (the understanding's
 * own `deadline`) that is TODAY OR LATER. A past date inside a held class is exactly the stale-claim
 * class the served-words law exists to refuse — a ledger that says "one has a real deadline — June"
 * about a finished obligation is the fourteen-overdue-rows failure wearing new clothes.
 *
 * AND THE DATE MUST BE THE USER'S (found in the first live read: the reference account's
 * "Newsletters & promotions" class spoke "one has a real deadline — today" off a promotional
 * sale-ends-today line). A sender's own expiry is not an obligation on the reader, and a bulk class
 * whose whole honest account is "nothing changes if these wait" must not contradict itself one line
 * later. Two classes are structurally exempt — the ones where the counterpart is talking to itself.
 */
// W8.3: `not_judged` joins them — its dates are an unjudged understanding's, never a claim the
// ledger may speak as "a real deadline".
const NO_DEADLINE_CLASSES: ReadonlySet<HeldClassId> = new Set<HeldClassId>(['bulk_mail', 'own_outreach', 'not_judged']);

/** W8.3 · A date in a served sentence is PLAIN WORDS — "today" / "tomorrow" / a weekday inside the
 *  week / else the one short-date grammar ("Oct 14"). Never a raw ISO string. */
export function plainDay(iso: string, todayISO: string): string {
  const days = Math.round((Date.parse(iso) - Date.parse(todayISO)) / 86_400_000);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  if (days > 1 && days <= 6) return WEEKDAY(iso);
  return fmtMonthDay(iso) || iso;
}

export function consequenceOf(cls: HeldClassId, dueDates: Array<string | null | undefined>, todayISO: string): string {
  if (NO_DEADLINE_CLASSES.has(cls)) return HELD_CLASSES[cls].consequence;
  const real = dueDates.filter((d): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= todayISO)
    .sort();
  if (!real.length) return HELD_CLASSES[cls].consequence;
  const nearest = real[0];
  const when = plainDay(nearest, todayISO);
  return real.length === 1
    ? `one has a real deadline — ${when}`
    : `${real.length} have real deadlines — the nearest is ${when}`;
}

/** The per-item line the ledger prints beside a held row — why THIS one is held. Deterministic,
 *  the class's account narrowed by the item's own fact where one exists. */
export function whyHeldOf(cls: HeldClassId, f: HeldFacts, todayISO?: string): string {
  // Q9 · THE PARK SPEAKS FIRST, because the person's own instruction outranks every machine account
  // of why a row is here. "You asked to see this today" is the only why-line on this page authored
  // by the reader rather than about them.
  if (f.userParkedUntil && f.userParkDue === true) return 'you asked to see this today';
  if (cls === 'brought_forward') return 'held for the budget — it touches your calendar';
  if (cls === 'own_outreach') return 'a reply into your own outbound sequence';
  if (cls === 'judged_quiet') {
    return f.judgedResolution === 'answered' ? 'the thread was already answered'
      : f.judgedResolution === 'expired' ? 'the moment it asked about has passed'
        : 'judged: nothing to do here';
  }
  if (cls === 'bulk_mail') {
    // The kind floor's own account for a pitch — it was written to the reader, but it owes them nothing.
    const k = String(rawMailKindOf((f.item.source_data ?? {}) as Record<string, unknown>) ?? '').toLowerCase();
    return k === 'cold_outreach' ? 'unsolicited outreach — nothing is owed until you answer it' : 'list mail — nobody wrote this to you';
  }
  // A notice that EARNED a waiting seat did so on its deadline — the words must say that fact, never
  // "no reply is possible" inside a band that claims alive (the one-screen-contradiction rule).
  if (cls === 'notices') return f.deadlineAhead === true && f.budgetOverflow === true
    ? 'automated, but it names a real deadline'
    : 'an automated notice — no reply is possible';
  if (cls === 'cc_watch') return 'you were copied, not asked';
  if (cls === 'not_judged') return notJudgedWhy(f, todayISO);
  return f.budgetOverflow ? 'judged work — it did not make today’s five' : 'quiet — nothing has moved on it';
}

/** W8.3 · THE STALE UNDERSTANDING, defined once: an understanding with NO reasoned kind (`mailKind`)
 *  predates the M1 schema — every understanding written since carries one — and was calibrated
 *  before the kind/notice laws existed (the July-era read that stamped sign-in codes `you_owe`).
 *  It may still be read as a hint; it never qualifies an item as waiting work on its own. */
export function isStaleUnderstanding(sd: Record<string, unknown> | null | undefined): boolean {
  const u = ((sd ?? {}) as { understanding?: { mailKind?: unknown } | null }).understanding;
  return !!u && typeof u === 'object' && !u.mailKind;
}

/** The not-judged row's own why — plain, and the date (when one passed) in plain words. */
export function notJudgedWhy(f: HeldFacts, today?: string): string {
  const todayISO = today ?? new Date().toISOString().slice(0, 10);
  const due = statedDueOf(f.item);
  if (due && due < todayISO) return `its stated date (${plainDay(due, todayISO)}) has passed — never judged`;
  if (isStaleUnderstanding((f.item.source_data ?? null) as Record<string, unknown> | null)) return 'an early read flagged this — never judged against your work';
  return 'not judged against your work yet';
}

export type HeldMember = {
  itemId: string;
  subject: string;
  why: string;
  dueDate: string | null;
};

export type HeldClassOut = {
  id: HeldClassId;
  label: string;
  consequence: string;
  deed: string;
  count: number;
  members: HeldMember[];
  hasMore: boolean;
};

/** How many members a class carries in one response. Honest: `count` is always the real total. */
export const HELD_MEMBERS_PER_CLASS = 25;

/** The item's code-verifiable stated date — the ONE fact the consequence sentence may speak. */
export function statedDueOf(it: DeckItem): string | null {
  const d = getUnderstanding(it as any)?.deadline;
  return typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : null;
}

const clipSubject = (s: string, max = 120) => (s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`);

/** A row served in the WAITING or WATCHED band: a member, plus the class that explains it.
 *
 *  Q9 · THE CARD'S ESSENTIALS RIDE THE ROW. The triage deck is a SECOND RENDER of this exact band —
 *  same rows, same order, no second derivation and no per-card refetch of the list. A card shows
 *  more than a list line does (who wrote, their first words, whether something is already drafted),
 *  so those three facts are SERVED here, computed from the pool row this ledger already holds:
 *  zero extra IO, zero AI, and nothing the deck could disagree with the ledger about. */
export type HeldBandRow = HeldMember & {
  cls: HeldClassId;
  /** Who it is with — the sender's own name/address as stored. Null when the row has none. */
  from: string | null;
  /** The message's opening words, clipped by THE ONE CLIPPER (boundary + honest marker). */
  excerpt: string | null;
  /** The kind of prepared work standing on this item, when any does — the deck's ↑ NOW mounts the
   *  artifact's OWN renderer (and therefore its own commit door) instead of promising one. */
  prepared: 'reply_draft' | 'nudge_draft' | 'invite' | 'forward' | 'deliverable' | 'paste_pack' | null;
};

/** How much of the message's own text a triage card shows before the honest marker. */
export const HELD_EXCERPT_CHARS = 280;

export type HeldBandsOut = {
  waiting: {
    id: 'waiting'; title: string; sentence: string;
    count: number;
    /** How many of them carry a real deadline TODAY OR EARLIER — the only fact that lets the
     *  ledger's intro say "none urgent" (or refuse to). */
    urgent: number;
    rows: HeldBandRow[]; hasMore: boolean;
  };
  watched: {
    id: 'watched'; title: string; sentence: string;
    count: number; rows: HeldBandRow[]; hasMore: boolean;
  };
  handled: {
    id: 'handled'; title: string; sentence: string;
    count: number; classes: HeldClassOut[];
    /** THE GRADUATION SENTENCE (Q3) — the band header says what happens to these on their own. */
    graduation: string;
  };
};

/** How many rows one band serves in a response. `count` is always the real total.
 *  W8.3 · ONE COUNT: the waiting band is judged work only, small by construction, so it serves
 *  WHOLE up to this declared bound — the header, the deck and the list read the same number. Past the
 *  bound `hasMore` is true and the list's footer says so, naming the bound (never a silent cap). */
export const HELD_ROWS_PER_BAND = HELD_BAND_ROWS_BOUND;

// ════════════════════════════════════════════════════════════════════════════════════════════════
// Q3 · THE GRADUATION LAW — the pure half (the lane that acts on it lives in lib/work/graduation.ts)
//
// "An item in a class whose consequence is 'nothing changes if these wait' files itself after 10
// quiet days." This is RETIREMENT, the half of noise reduction that suppression alone never
// delivers: without it the handled number only ever grows, and a number that only grows is not a
// receipt, it is a monument.
//
// FOUR EXEMPTIONS, all structural rather than promised:
//   • the band — only `handled` graduates. A waiting row is alive; a watched row is somebody else's
//     move and the user asked to be told. Neither is ours to file.
//   • the class — only the four whose canonical consequence is "nothing changes if these wait".
//     `quieter_threads` is deliberately absent: it is REAL CORRESPONDENCE that a floor or the budget
//     did not reach, and filing real correspondence on a timer is how trust dies.
//   • a real deadline that STILL STANDS (today or later) — exempt while it stands.
//   • the clock — ten quiet days, measured from the item's own last movement.
// ════════════════════════════════════════════════════════════════════════════════════════════════

export const GRADUATION_DAYS = 10;

/** The classes whose own account is "nothing changes if these wait". */
export const GRADUATING_CLASSES: ReadonlySet<HeldClassId> =
  new Set<HeldClassId>(['bulk_mail', 'own_outreach', 'notices', 'judged_quiet']);

export type Graduate = { itemId: string; cls: HeldClassId; quietDays: number; quietSince: string };

/**
 * THE SELECTION (pure, zero AI, zero IO). Oldest first — a cap is a budget, and a budget spent on
 * the oldest things is the only spend that makes the standing number trend to zero.
 */
export function selectGraduates(
  facts: HeldFacts[], todayISO: string,
  opts: { cap?: number; days?: number; now?: Date } = {},
): Graduate[] {
  const days = opts.days ?? GRADUATION_DAYS;
  const nowMs = (opts.now ?? new Date(`${todayISO}T23:59:59Z`)).getTime();
  const out: Graduate[] = [];
  for (const f of facts) {
    const cls = classifyHeld(f);
    if (bandOf(cls, f) !== 'handled') continue;
    if (!GRADUATING_CLASSES.has(cls)) continue;
    const due = statedDueOf(f.item);
    if (due && due >= todayISO) continue;           // a deadline that still stands
    const since = f.quietSince;
    if (!since) continue;                           // no clock, no graduation
    const t = Date.parse(since);
    if (!Number.isFinite(t)) continue;
    const quietDays = Math.floor((nowMs - t) / 86_400_000);
    if (quietDays < days) continue;
    out.push({ itemId: String(f.item.id), cls, quietDays, quietSince: since });
  }
  out.sort((a, b) => b.quietDays - a.quietDays || a.itemId.localeCompare(b.itemId));
  return typeof opts.cap === 'number' ? out.slice(0, Math.max(0, opts.cap)) : out;
}

/** Q3, stated on the band that owns it — deterministic, from the lane's own constant. */
export const graduationSentence = (days: number): string =>
  `quiet things file themselves after ${days} days — nothing is deleted, and anything comes back`;

const memberOf = (cls: HeldClassId, m: HeldFacts, user: UserForms | null = null, todayISO?: string): HeldBandRow => {
  const sd = (m.item.source_data ?? {}) as Record<string, unknown>;
  // DECODED ONCE, BEFORE THE CLIP (W5b): the clip measures characters the reader will see, and an
  // escaped snippet ("wasn&#39;t") must never reach a card as literal text.
  const body = decodeEntities(String(sd.body ?? '')).replace(/\s+/g, ' ').trim();
  const from = (sd.from_name as string) || (sd.from_address as string) || null;
  // GROUNDED-OR-ABSENT, per field. A row with no stored body shows no excerpt rather than an empty
  // quotation; a row with no sender shows no name rather than "(unknown)".
  return {
    itemId: String(m.item.id),
    subject: clipSubject(decodeEntities(String((sd as any).subject ?? m.item.work_title ?? '(no subject)'))),
    why: whyHeldOf(cls, m, todayISO),
    dueDate: statedDueOf(m.item),
    cls,
    from: from ? decodeEntities(from) : null,
    excerpt: body ? clipForDisplay(body, HELD_EXCERPT_CHARS) : null,
    // THE SENDER FLOOR REACHES THE RECEIPT (W5b, owner walk Sep 23 — an automated "your bot wasn't
    // admitted" notice wore "draft ready"). Noise never gets drafts; a draft that predates the
    // floor (or slipped past it) is not prepared work the reader should be offered. A row filed in
    // a NOISE class serves no prepared kind, so no surface can chip it. The artifact itself is
    // stripped by the verdict's own consequence module when the item is next judged.
    // ONE READER PER OBJECT (W7.5): the kind comes from the reader's LIVE set — same floors (time ·
    // window · claim · THE ADDRESSEE FLOOR with the user's code-owned forms) the room applies.
    prepared: NOISE_CLASSES.has(cls) ? null
      : (liveFromSourceData(sd, { user, lastActivityAt: (m.item as { last_activity_at?: string | null }).last_activity_at ?? null })[0]?.kind ?? null),
  };
};

/**
 * THE LEDGER (A3 × Q2) — THE THREE BANDS, and within the handled band its classes.
 *
 * Pure: every fact handed in. THE PARTITION IS STRUCTURAL — one pass, one class per item, one band
 * per class+facts — so `waiting + watched + Σ handled classes` can only equal the held total, and no
 * item can appear in two bands.
 *
 * `classes` is returned as the HANDLED band's classes: the class rows are a handled-band surface
 * (they carry bulk verbs), and the deed engine acts on exactly the set the ledger shows.
 */
export function buildHeldLedger(
  facts: HeldFacts[], todayISO: string,
  opts: { membersPerClass?: number; offset?: number; rowsPerBand?: number; graduationDays?: number; /** the user's code-owned forms — THE ADDRESSEE FLOOR on the served `prepared` kind */ user?: UserForms | null } = {},
): { total: number; classes: HeldClassOut[]; bands: HeldBandsOut } {
  const user = opts.user ?? null;
  const perClass = opts.membersPerClass ?? HELD_MEMBERS_PER_CLASS;
  const perBand = opts.rowsPerBand ?? HELD_ROWS_PER_BAND;
  const offset = Math.max(0, opts.offset ?? 0);

  const buckets = new Map<HeldClassId, HeldFacts[]>();
  const waiting: HeldBandRow[] = [];
  const watched: HeldBandRow[] = [];
  let waitingCount = 0, watchedCount = 0, handledCount = 0, urgent = 0;

  for (const f of facts) {
    const cls = classifyHeld(f);
    const band = bandOf(cls, f);
    if (band === 'waiting') {
      waitingCount++;
      const due = statedDueOf(f.item);
      if (due && due <= todayISO) urgent++;
      if (waiting.length < perBand) waiting.push(memberOf(cls, f, user, todayISO));
      continue;
    }
    if (band === 'watched') {
      watchedCount++;
      if (watched.length < perBand) watched.push(memberOf(cls, f, user, todayISO));
      continue;
    }
    handledCount++;
    (buckets.get(cls) ?? buckets.set(cls, []).get(cls)!).push(f);
  }

  // THE ADJACENCY LEADS ITS BAND — a calendar-adjacent row is the one thing on this page that
  // answers "why now" with the day's own shape, so it is the first thing offered back.
  waiting.sort((a, b) => Number(b.cls === 'brought_forward') - Number(a.cls === 'brought_forward'));

  const classes: HeldClassOut[] = [];
  for (const id of HELD_CLASS_ORDER) {
    const members = buckets.get(id) ?? [];
    if (!members.length) continue;
    const dues = members.map((m) => statedDueOf(m.item));
    classes.push({
      id,
      label: HELD_CLASSES[id].label,
      consequence: consequenceOf(id, dues, todayISO),
      deed: HELD_CLASSES[id].deed,
      count: members.length,
      members: members.slice(offset, offset + perClass).map((m) => memberOf(id, m, user, todayISO)),
      hasMore: offset + perClass < members.length,
    });
  }

  return {
    total: facts.length,
    classes,
    bands: {
      waiting: {
        id: 'waiting', ...HELD_BANDS.waiting, count: waitingCount, urgent,
        rows: waiting, hasMore: waitingCount > waiting.length,
      },
      watched: {
        id: 'watched', ...HELD_BANDS.watched, count: watchedCount,
        rows: watched, hasMore: watchedCount > watched.length,
      },
      handled: {
        id: 'handled', ...HELD_BANDS.handled, count: handledCount, classes,
        graduation: graduationSentence(opts.graduationDays ?? GRADUATION_DAYS),
      },
    },
  };
}
