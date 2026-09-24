// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE LEDGER'S OWN SENTENCES (docs/attention-plan.md A3 × Q2 × Q3) — pure, client-safe, zero AI.
//
// The CoS's one-sentence intro and the receipts footer are composed BY CODE from the numbers the
// route actually served. They live here rather than in the surface for one reason: a law is only
// alive while a gate enforces it, and a gate cannot import a 'use client' component that pulls
// `next/link` into a CLI process. Same words, one home, assertable.
//
// THE FLOOR THESE OBEY: never a claim the payload did not carry. "None urgent" is spoken only when
// the served `urgent` count is zero; "filed N this month" only when the log actually counted N.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** The shape these read — the ledger route's response, as the surface receives it. */
export type HeldWordsLedger = {
  total: number;
  classes: Array<{ id: string }>;
  bands?: {
    waiting: { count: number; urgent: number };
    watched: { count: number };
    handled: { count: number };
  };
  servedCount?: number;
  poolRead?: number;
  poolSaturated?: boolean;
  filedThisMonth?: number;
};

/**
 * THE CoS's ONE SENTENCE — composed from the route's OWN THREE NUMBERS, deterministically (Q2).
 *
 * It states the gradient in the order the page renders it: what is WAITING (and whether any of it
 * has actually landed), then that everything else is HANDLED rather than owed, then the standing
 * promise. It never claims a number the payload did not carry, and "none urgent" is spoken ONLY
 * when the served `urgent` count is zero — a reassurance that can be wrong is worse than none.
 */
export function heldIntro(l: HeldWordsLedger, deckHeld: number): string {
  const b = l.bands;
  const waiting = (b?.waiting.count ?? 0) + deckHeld;
  const watched = b?.watched.count ?? 0;
  const handled = b?.handled.count ?? (l.total - (b?.waiting.count ?? 0) - watched);
  const urgent = b?.waiting.urgent ?? 0;
  const served = l.servedCount ?? 0;
  if (waiting + watched + handled === 0) return 'Nothing is waiting right now.';

  const parts: string[] = [];
  // W8.3 · THE LIST SAYS ONLY WHAT WAS JUDGED. The waiting band now holds judged work only (the
  // ledger files an unjudged row as "Not yet judged"), so the sentence claims exactly that — never
  // "real … all alive" over rows nobody judged — and its date fact is a DUE fact ("due today or
  // past due"), never "a deadline that has landed" over a July golf day.
  if (waiting > 0) {
    const shape = urgent > 0
      ? `${urgent} of them ${urgent === 1 ? 'is' : 'are'} due today or past due`
      : 'none due yet';
    // W16.3 · PLAIN WORDS — the reader's terms, never the machinery's ("judged", "today's five").
    parts.push(served > 0
      ? `${waiting} more thing${waiting === 1 ? ' is' : 's are'} waiting for you — ${shape}.`
      : `${waiting} thing${waiting === 1 ? ' is' : 's are'} waiting for you — ${shape}.`);
  }
  if (handled > 0) {
    parts.push(`Everything else is handled: ${handled.toLocaleString()} filed quietly${watched > 0 ? `, ${watched} more being watched` : ''}.`);
  } else if (watched > 0) {
    parts.push(`${watched} more ${watched === 1 ? 'is' : 'are'} being watched — someone else owes the next move.`);
  }
  parts.push('Nothing is deleted, and anything comes back.');
  return parts.join(' ');
}

// THE CoS's ONE LINE ON THE HOME — PROPOSED AND RETIRED THE SAME MORNING (Sep 18).
//
// The owner's walk asked for the calm board's sentence back under the greeting, so it was built
// HERE and deterministically: composed by code from facts the page had already been served (seats ·
// the day's next event · what filed today · a catch-up in flight), never a model, never a claim the
// page could not show beside it. He saw it live and removed it — "the top clara line should be
// removed" — which is the same call as Sep 13 ("in home, this feels too much, remove"), now made
// about the honest version too. So the seat is settled: THE GREETING STOPS AT THE GREETING.
//
// The composer is DELETED rather than parked, per the repo's own standing lesson: an orphaned
// function is a corpse the next reader re-mounts. Gate SQ12 asserts the absence on both sides —
// no composer here, no line on the Home — so the next restoration has to be a decision, not a drift.

/** THE RECEIPTS FOOTER — the honest bound of this account, in the route's own numbers, plus Q3's
 *  one earned claim: how many rows filed THEMSELVES this month (counted from the activity log). */
export function heldReceipts(l: HeldWordsLedger): string {
  const parts: string[] = [];
  if (typeof l.poolRead === 'number') parts.push(`read from ${l.poolRead} pending item${l.poolRead === 1 ? '' : 's'}`);
  parts.push(`${l.classes.length} class${l.classes.length === 1 ? '' : 'es'}`);
  if (typeof l.filedThisMonth === 'number' && l.filedThisMonth > 0) {
    parts.push(`filed ${l.filedThisMonth.toLocaleString()} this month`);
  }
  if (l.poolSaturated) parts.push('the read hit its cap — older items are not accounted for here');
  parts.push('nothing deleted');
  return parts.join(' · ');
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// W16.3 · THE ROW'S WHY, IN THE READER'S WORDS — ONE home for the line a waiting row (the triage
// card's why-line and the held list's "subject — why") speaks.
//
// Owner walk, Sep 24, on the one-at-a-time card: the why-line read "judged work — it did not make
// today's five" — the platform talking about its own machinery. The line now says WHY THE ITEM IS
// HERE in the user's terms, from the item's OWN facts (its park, the machine's looks-done state, its
// stated due date, who asked and when, the calendar), in that order. Pure, deterministic, zero AI;
// NO internal term ever reaches it ("judged", "today's five", "held", "seat", "budget") — gated by
// scripts/smoke-decision-card.ts over every class × fact fixture.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { LOOKS_DONE_WORD as LOOKS_DONE_ROW_WORD } from '@/lib/evidence/looks-done-word';

/** The words that must never reach a card or a list row — the platform's own vocabulary. */
export const ROW_JARGON = /\bjudg(?:e|ed|ment|ing)\b|today['’]s (?:five|\d+)|\bheld\b|\bseat(?:s|ed)?\b|\bbudget\b/i;

/** The plain constant words of the ladder (the dated / named rungs are composed below). */
export const ROW_WHY_WORDS = {
  parked: 'you asked to see this today',
  looksDone: LOOKS_DONE_ROW_WORD,
  waiting: 'waiting for you',
  quiet: 'quiet — nothing has moved on it',
  ownOutreach: 'a reply to your own outreach',
  answered: 'the thread was already answered',
  expired: 'the moment it asked about has passed',
  nothingToDo: 'nothing to do here',
  cold: 'unsolicited outreach — nothing is owed until you answer it',
  list: 'list mail — nobody wrote this to you',
  noticeDeadline: 'automated, but it names a real deadline',
  notice: 'an automated notice — no reply is possible',
  copied: 'you were copied, not asked',
  notRead: 'not looked at yet',
} as const;

const MONTH_DAY = (iso: string): string => {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso.slice(0, 10) : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
};

/** A day in plain words against the caller's day: today · tomorrow · yesterday · "Sep 13". */
export function dayWordOf(iso: string, todayISO: string): string {
  const days = Math.round((Date.parse(iso.slice(0, 10)) - Date.parse(todayISO)) / 86_400_000);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  return MONTH_DAY(iso);
}

/** "due today" · "due tomorrow" · "due Sep 13" · "was due Sep 13" — the stated date, plainly. */
export function dueWordsOf(dueISO: string, todayISO: string): string {
  const due = dueISO.slice(0, 10);
  const when = dayWordOf(due, todayISO);
  if (due < todayISO) return when === 'yesterday' ? 'was due yesterday' : `was due ${when}`;
  return `due ${when}`;
}

/** The first name a person is spoken by — never an address, never an invented name. */
export function spokenFirstName(who: string | null | undefined): string | null {
  const t = String(who ?? '').replace(/["']/g, '').trim();
  if (!t || t.includes('@')) return null;
  const first = t.split(/[\s,]+/)[0] ?? '';
  return /^[\p{L}][\p{L}.'-]*$/u.test(first) ? first : null;
}

/** The facts a row's why is composed from — all the item's own. */
export type RowWhyFacts = {
  /** The held class id (lib/home/attention.ts HeldClassId). */
  cls: string;
  todayISO: string;
  /** The person's own park arrived today. */
  parkedDue?: boolean;
  /** THE MACHINE's single state for the item (lib/work/machine.ts), when served. */
  machineState?: string | null;
  /** The item's stated due date (ISO day). */
  dueDate?: string | null;
  /** Who wrote it, as stored. */
  who?: string | null;
  /** When their message arrived (ISO). */
  receivedAt?: string | null;
  /** The item's own understanding says the user owes the next move. */
  userOwes?: boolean;
  /** The sender is someone on the user's calendar in the next two days. */
  calendarSoon?: boolean;
  /** Present in the waiting set because the day had more than it could show (the band's fact). */
  overflow?: boolean;
  /** A stated deadline today or ahead. */
  deadlineAhead?: boolean;
  /** A "nothing to do" record's own disposition. */
  resolution?: string | null;
  /** The reasoned mail kind, lower-cased. */
  mailKind?: string | null;
};

/** THE ROW'S WHY — first rung that holds wins. Pure. */
export function rowWhyOf(f: RowWhyFacts): string {
  const W = ROW_WHY_WORDS;
  if (f.parkedDue) return W.parked;
  if (f.machineState === 'looks_done') return W.looksDone;
  switch (f.cls) {
    case 'own_outreach': return W.ownOutreach;
    case 'judged_quiet': return f.resolution === 'answered' ? W.answered : f.resolution === 'expired' ? W.expired : W.nothingToDo;
    case 'bulk_mail': return f.mailKind === 'cold_outreach' ? W.cold : W.list;
    case 'cc_watch': return W.copied;
    case 'not_judged': {
      const due = f.dueDate && /^\d{4}-\d{2}-\d{2}/.test(f.dueDate) ? f.dueDate.slice(0, 10) : null;
      return due && due < f.todayISO ? `its date (${MONTH_DAY(due)}) has passed — ${W.notRead}` : W.notRead;
    }
    case 'notices':
      if (!(f.deadlineAhead && f.overflow)) return W.notice;
      break;
    default: break;
  }
  // THE WAITING RUNGS — the item's own facts, most concrete first.
  if (f.dueDate && /^\d{4}-\d{2}-\d{2}/.test(f.dueDate)) return dueWordsOf(f.dueDate, f.todayISO);
  if (f.cls === 'notices') return W.noticeDeadline;
  const name = spokenFirstName(f.who);
  if (f.userOwes && name) {
    return f.receivedAt && /^\d{4}-\d{2}-\d{2}/.test(f.receivedAt)
      ? (() => { const d = dayWordOf(f.receivedAt!, f.todayISO); return `${name} asked you ${/^\p{L}{3} \d/u.test(d) ? `on ${d}` : d}`; })()
      : `${name} asked you`;
  }
  if (f.cls === 'brought_forward' || f.calendarSoon) return name ? `you meet ${name} soon` : 'you meet them soon';
  return f.overflow ? W.waiting : W.quiet;
}

/** The card's why-line, as a sentence (the list keeps its lower-case "subject — why" grammar). */
export const sentenceCase = (s: string | null | undefined): string => {
  const t = String(s ?? '').trim();
  return t ? t[0].toUpperCase() + t.slice(1) : '';
};
