// ════════════════════════════════════════════════════════════════════════════════════════════════
// EXTRACTION TRUTH (stabilization W3.4 · invariant 14 TIME TRUTH · THE DEIXIS LAW · THE SEAT LAW).
//
// The pure, zero-AI cores every commitment write door (and every repair sweep) asks. ONE module so
// the write path and the backfills can never answer the same question two ways:
//
//   • THE FORWARD ANCHOR — a model-supplied date is resolved FORWARD from the SOURCE'S own date; a
//     year the model wrote into the past (a spoken "27th of August" landing as 2024) is re-anchored
//     by code, never modernized by the model.
//   • THE STATED WINDOW — "week of September 16", "Sep 15 or 16", "— September 30 or October 1":
//     a window the source STATES becomes `due_date` = the window's END, so the expiry law can see
//     it. Parsed, never guessed; every date-bearing shape is code-verified in the text
//     (`dateStatedInText`); a window ending before its own source is a reference, not a deadline.
//   • THE SELF-PARTY LAW — the user is never their own counterparty: a counterparty or a title's
//     "with X" that denotes the user is re-derived from the source's OTHER party, or left honest.
//   • THE OPEN-DUPLICATE LAW — one obligation, one open row: same thread / meeting, or the same
//     counterparty within 14 days, at the shared Jaccard bar.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import { dateStatedInText } from '@/lib/utils/user-time';
import { MAY_VERB_TAIL } from '@/lib/utils/weekday-floor'; // THE MAY RULE — one reading of "may"
import { norm, nameTokens, sameAttendee, emailLocalpart } from '@/lib/projects/identity';

const DAY_MS = 86_400_000;
/** A date with no written year that already went by more than this long before its source reads
 *  as NEXT year — people state the coming date, not the one behind them (weekday-floor's rule). */
export const FORWARD_TOLERANCE_DAYS = 45;

const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

// ── Month vocabulary — generated from Intl for the corpus locales (never a hand table of
// languages), plus the EN abbreviations mail actually writes. Short non-EN forms ("set", "mar")
// are deliberately NOT read: they collide with ordinary words ("set 15 goals").
const MONTHS: Map<string, number> = (() => {
  const m = new Map<string, number>();
  for (let i = 0; i < 12; i++) {
    const d = new Date(Date.UTC(2026, i, 15, 12));
    for (const loc of ['en-US', 'pt-PT', 'de-DE', 'fr-FR']) {
      try { m.set(fold(d.toLocaleDateString(loc, { month: 'long', timeZone: 'UTC' })), i); } catch { /* locale absent */ }
    }
  }
  ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].forEach((s, i) => m.set(s, i));
  m.set('sept', 8);
  return m;
})();
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const M_ALT = [...MONTHS.keys()].sort((a, b) => b.length - a.length).map(esc).join('|');
const ORD = '(?:st|nd|rd|th|er|o|º)?';
const SEP = '\\s*(?:-|–|—|to|or|and|&|/|ou|e|oder|und|bis|a)\\s*';


const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const utcNoon = (y: number, m: number, d: number) => Date.UTC(y, m, d, 12);

/** Anchor instant of a source (its own date) — UTC noon of that day; now when absent/unparseable. */
export function anchorMs(anchorIso?: string | null): number {
  const t = anchorIso ? Date.parse(anchorIso) : NaN;
  const d = Number.isNaN(t) ? new Date() : new Date(t);
  return utcNoon(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** month/day with no written year → the date FORWARD from the anchor (tolerance above). Null for an
 *  impossible day (31 September never round-trips). */
export function resolveForward(month0: number, day: number, anchor: number, year?: number | null): string | null {
  let y = year ?? new Date(anchor).getUTCFullYear();
  let ms = utcNoon(y, month0, day);
  if (year == null && ms < anchor - FORWARD_TOLERANCE_DAYS * DAY_MS) { y += 1; ms = utcNoon(y, month0, day); }
  const d = new Date(ms);
  if (d.getUTCMonth() !== month0 || d.getUTCDate() !== day) return null;
  return iso(ms);
}

/**
 * THE FORWARD ANCHOR on a model-supplied YYYY-MM-DD. A date inside the forward window stands; a
 * date the model wrote before it (the year-transposition class) keeps its month/day and is
 * re-resolved forward from the SOURCE's own date. Anything unparseable → null (never invented).
 */
export function anchorDueDate(modelDate: unknown, anchorIso?: string | null): string | null {
  if (typeof modelDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(modelDate)) return null;
  const [y, m, d] = modelDate.split('-').map(Number);
  const ms = utcNoon(y, m - 1, d);
  const probe = new Date(ms);
  if (probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return null;
  const anchor = anchorMs(anchorIso);
  if (ms >= anchor - FORWARD_TOLERANCE_DAYS * DAY_MS) return modelDate;
  return resolveForward(m - 1, d, anchor);
}

/** Does a text name this month (any corpus locale, word-bounded)? The month-only window's floor. */
export function monthNamedIn(text: string, month0: number): boolean {
  const t = fold(text);
  return [...MONTHS.entries()].some(([name, i]) => i === month0 && name.length >= 4 && new RegExp(`\\b${esc(name)}\\b`).test(t));
}

export type StatedWindow = { start: string; end: string; shapes: string[] };

/**
 * THE STATED WINDOW: the date window a text STATES, as {start, end}. Deterministic, zero AI.
 * Shapes: ISO · "Month D[, YYYY]" · "D[th] [of|de] Month" · ranges/alternatives in one month
 * ("Sep 15 or 16", "16–20 September") · "week of <date>" (ends that ISO week's Sunday) ·
 * "before <date>" (ends the day before) · month-only after a window preposition ("— September",
 * "by end of October") ends the month's last day. Several dates → the latest end (a choice of
 * slots is open until its last one). Refuses (null) when any date is a written year long before
 * the source, and drops any window ending before the source's own date (a reference, not a due).
 */
export function statedWindow(text: string | null | undefined, anchorIso?: string | null): StatedWindow | null {
  const raw = String(text ?? '');
  if (!raw.trim()) return null;
  const t = fold(raw);
  const anchor = anchorMs(anchorIso);
  const hits: Array<{ start: string; end: string; shape: string; at: number; len: number }> = [];
  const taken: Array<[number, number]> = [];
  const free = (a: number, b: number) => !taken.some(([x, y]) => a < y && b > x);
  let refuse = false;

  const monthOf = (s: string) => MONTHS.get(s.replace(/\.$/, ''));
  const yearOf = (s?: string) => (s ? Number(s) : null);
  const push = (at: number, len: number, startIso: string | null, endIso: string | null, shape: string, verify = true) => {
    if (!startIso || !endIso || !free(at, at + len)) return;
    // Code-verified in the source text — either edge (a shared-month range states its month once).
    if (verify && !dateStatedInText(raw, startIso) && !dateStatedInText(raw, endIso)) return;
    if (Date.parse(endIso) < anchor - FORWARD_TOLERANCE_DAYS * DAY_MS) { refuse = true; return; }
    taken.push([at, at + len]);
    hits.push({ start: startIso, end: endIso, shape, at, len });
  };
  const mayIsVerb = (monthTok: string, after: string) => monthTok === 'may' && MAY_VERB_TAIL.test(after);

  // 1 · week of <date>
  for (const m of t.matchAll(new RegExp(`\\bweek of (?:the )?(?:(${M_ALT})\\.?\\s+(\\d{1,2})${ORD}|(\\d{1,2})${ORD}(?: of| de)?\\s+(${M_ALT}))\\b(?:,?\\s+(\\d{4}))?`, 'g'))) {
    const mo = monthOf(m[1] ?? m[4]); const day = Number(m[2] ?? m[3]);
    if (mo === undefined) continue;
    const s = resolveForward(mo, day, anchor, yearOf(m[5]));
    if (!s) continue;
    const dow = new Date(`${s}T12:00:00Z`).getUTCDay();
    push(m.index!, m[0].length, s, iso(Date.parse(`${s}T12:00:00Z`) + ((7 - dow) % 7) * DAY_MS), 'week-of');
  }
  // 2 · ranges / alternatives inside one month
  for (const m of t.matchAll(new RegExp(`\\b(${M_ALT})\\.?\\s+(\\d{1,2})${ORD}${SEP}(\\d{1,2})${ORD}(?![:\\d])(?!\\s*(?:${M_ALT})\\b)(?:,?\\s+(\\d{4}))?`, 'g'))) {
    const mo = monthOf(m[1]); if (mo === undefined) continue;
    const y = yearOf(m[4]);
    push(m.index!, m[0].length, resolveForward(mo, Number(m[2]), anchor, y), resolveForward(mo, Number(m[3]), anchor, y), 'range');
  }
  for (const m of t.matchAll(new RegExp(`\\b(\\d{1,2})${ORD}${SEP}(\\d{1,2})${ORD}(?:\\.| of| de)?\\s+(${M_ALT})\\b(?:,?\\s+(\\d{4}))?`, 'g'))) {
    const mo = monthOf(m[3]); if (mo === undefined) continue;
    if (mayIsVerb(m[3], t.slice(m.index! + m[0].length))) continue;
    const y = yearOf(m[4]);
    push(m.index!, m[0].length, resolveForward(mo, Number(m[1]), anchor, y), resolveForward(mo, Number(m[2]), anchor, y), 'range');
  }
  // 3 · ISO
  for (const m of t.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    const s = resolveForward(Number(m[2]) - 1, Number(m[3]), anchor, Number(m[1]));
    push(m.index!, m[0].length, s, s, 'iso');
  }
  // 4 · single dates (month-first, day-first); "before" ends the day before
  const single = (at: number, len: number, mo: number, day: number, y: number | null) => {
    const s = resolveForward(mo, day, anchor, y);
    if (!s) return;
    const before = /\bbefore\s+(?:the\s+)?$/.test(t.slice(Math.max(0, at - 12), at));
    push(at, len, s, before ? iso(Date.parse(`${s}T12:00:00Z`) - DAY_MS) : s, before ? 'before' : 'date');
  };
  for (const m of t.matchAll(new RegExp(`\\b(${M_ALT})\\.?\\s+(\\d{1,2})${ORD}(?![:\\d])\\b(?:,?\\s+(\\d{4}))?`, 'g'))) {
    const mo = monthOf(m[1]); if (mo === undefined) continue;
    single(m.index!, m[0].length, mo, Number(m[2]), yearOf(m[3]));
  }
  for (const m of t.matchAll(new RegExp(`\\b(\\d{1,2})${ORD}(?:\\.| of| de)?\\s+(${M_ALT})\\b(?:,?\\s+(\\d{4}))?`, 'g'))) {
    const mo = monthOf(m[2]); if (mo === undefined) continue;
    if (mayIsVerb(m[2], t.slice(m.index! + m[0].length))) continue;
    single(m.index!, m[0].length, mo, Number(m[1]), yearOf(m[3]));
  }
  // 5 · month-only, only after a window preposition ("may" alone is never read)
  for (const m of t.matchAll(new RegExp(`(?:\\b(?:end of|by|in|during|until|through|before)|[—–])\\s+(?:the end of\\s+|end of\\s+)?(${M_ALT})\\b(?!\\.?\\s*\\d)(?:\\s+(\\d{4}))?`, 'g'))) {
    if (m[1] === 'may') continue;
    const mo = monthOf(m[1]); if (mo === undefined) continue;
    const s = resolveForward(mo, 1, anchor, yearOf(m[2]));
    if (!s) continue;
    const [y] = s.split('-').map(Number);
    push(m.index!, m[0].length, s, iso(utcNoon(y, mo + 1, 0)), 'month', false);
  }

  if (refuse) return null;
  const live = hits.filter((h) => Date.parse(`${h.end}T12:00:00Z`) >= anchor);
  if (!live.length) return null;
  return {
    start: live.map((h) => h.start).sort()[0],
    end: live.map((h) => h.end).sort().slice(-1)[0],
    shapes: [...new Set(live.map((h) => h.shape))],
  };
}

/**
 * THE WINDOW'S END as `due_date`: the model's (forward-anchored) date, widened to the end of a
 * window the description states when the model's date sits inside it; the stated window's end when
 * the model gave none. `sourceText`, when present, must itself state the window's start (a title
 * the model wrote cannot mint a date its source never said). No stated date → null.
 */
export function dueDateFromSource(opts: {
  modelDate?: unknown; description: string; sourceText?: string | null; anchorIso?: string | null;
}): string | null {
  const model = anchorDueDate(opts.modelDate, opts.anchorIso);
  const w = statedWindow(opts.description, opts.anchorIso);
  const src = opts.sourceText;
  const sw = w && src != null ? statedWindow(src, opts.anchorIso) : null;
  const verified = w && (src == null
    || dateStatedInText(src, w.start) || dateStatedInText(src, w.end)
    || (sw && sw.start <= w.end && sw.end >= w.start)                   // the source states a date inside it
    || (w.shapes.every((s) => s === 'month') && monthNamedIn(src, Number(w.start.slice(5, 7)) - 1)));
  if (!w || !verified) return model;
  if (!model) return w.end;
  return model >= w.start && model <= w.end ? w.end : model;
}

// ── THE SELF-PARTY LAW ─────────────────────────────────────────────────────────────────────────
export type UserForms = { name?: string | null; aliases?: Array<string | null | undefined> | null };

/**
 * Does `who` denote the user? Deterministic and conservative: an exact alias/address, or a name
 * whose every token is one of the user's own name tokens. Never a localpart-contains guess ("Sam"
 * is not "Samantha"). A form that ALSO denotes `other` (a colleague sharing the first name) is
 * ambiguous and answers false — the other party is the likelier reading.
 */
export function denotesUser(who: string | null | undefined, user: UserForms, other?: string | null): boolean {
  const w = norm(String(who ?? '').replace(/<[^>]*>/g, ' ')).replace(/[^\p{L}\p{N}@.\s'-]/gu, ' ').trim();
  const addr = /<([^>]+@[^>]+)>/.exec(String(who ?? ''))?.[1]?.toLowerCase() ?? (w.includes('@') ? w : null);
  const aliases = (user.aliases ?? []).map((a) => norm(String(a ?? ''))).filter(Boolean);
  if (addr && aliases.includes(addr)) return true;
  if (!w || w.includes('@')) return false;
  if (other && sameAttendee(w, other)) return false;
  if (aliases.includes(w)) return true;
  const mine = new Set([
    ...nameTokens(user.name ?? ''),
    ...aliases.filter((a) => !a.includes('@')).flatMap(nameTokens),
  ]);
  const toks = nameTokens(w).filter((x) => x.length >= 2);
  return toks.length > 0 && mine.size > 0 && toks.every((x) => mine.has(x));
}

// Only the SYMMETRIC preposition: "call with X" names the other party whichever side owes it.
// "Send the deck to <user>" on an awaiting row is the other party's debt TO the user — true as written.
const WITH_RE = /\b(with)\s+((?:\p{Lu}[\p{L}'’-]+)(?:\s+\p{Lu}[\p{L}'’-]+)?)/gu;

/** The "with <Name>" span in a title that denotes the user, or null. */
export function selfPartyInTitle(title: string, user: UserForms, other?: string | null): { span: string; name: string; prep: string } | null {
  for (const m of String(title ?? '').matchAll(WITH_RE)) {
    if (denotesUser(m[2], user, other)) return { span: m[0], name: m[2], prep: m[1] };
  }
  return null;
}

/** A display name for a counterparty string: the name half of "Name <addr>", else the raw form. */
export function partyDisplay(who: string | null | undefined): string | null {
  const s = String(who ?? '').trim();
  if (!s) return null;
  const m = /^(.*?)<[^>]+>\s*$/.exec(s);
  if (m && m[1].trim()) return m[1].trim().replace(/^"|"$/g, '');
  return emailLocalpart(s) ? null : s; // a bare address is a fact, not a name to write into a title
}

/**
 * Repair one commitment under THE SELF-PARTY LAW. `other` = the source's OTHER party (the email's
 * sender/recipient, the meeting's sole counterpart). Returns the corrected fields; `changed` false
 * when nothing named the user.
 */
export function repairSelfParty(
  c: { description: string; counterparty?: string | null; direction?: string },
  user: UserForms,
  other?: string | null,
): { description: string; counterparty: string | null; direction?: string; changed: boolean } {
  const otherOk = other && !denotesUser(other, user) ? other : null;
  let description = c.description;
  let counterparty = c.counterparty ?? null;
  let direction = c.direction;
  if (counterparty && denotesUser(counterparty, user, otherOk)) {
    // The user owes it to someone, never to themself: an "awaiting" on yourself IS your own task.
    counterparty = otherOk;
    if (direction === 'awaiting') direction = 'you_owe';
  }
  // The title's "with <user>" is a lie only on the user's OWN debt ("call with <user>"); on an
  // awaiting row ("review with <user>") it is the other party's debt with the user — true as written.
  const hit = direction !== 'awaiting' ? selfPartyInTitle(description, user, otherOk) : null;
  if (hit) {
    const disp = partyDisplay(otherOk);
    if (disp) description = description.replace(hit.span, `${hit.prep} ${disp}`);
    if (!counterparty) counterparty = otherOk;
  }
  const changed = description !== c.description || counterparty !== (c.counterparty ?? null) || direction !== c.direction;
  return { description, counterparty, direction, changed };
}

// ── THE OPEN-DUPLICATE LAW ─────────────────────────────────────────────────────────────────────
export const DUP_WINDOW_DAYS = 14;
export type DupRow = {
  description: string; direction?: string | null; counterparty?: string | null;
  thread_id?: string | null; source_id?: string | null; created_at?: string | null;
};

/**
 * Is `cand` the same obligation as an open `row`? Same direction AND the shared near-duplicate bar
 * (`isNearDuplicate`, passed in so there is ONE Jaccard) AND a shared context: the same thread,
 * the same source (meeting), or the same counterparty within 14 days.
 */
export function isOpenDuplicate(cand: DupRow, row: DupRow, near: (a: string, b: string) => boolean): boolean {
  if ((cand.direction ?? null) !== (row.direction ?? null)) return false;
  if (!near(cand.description, row.description)) return false;
  if (cand.thread_id && row.thread_id && cand.thread_id === row.thread_id) return true;
  if (cand.source_id && row.source_id && cand.source_id === row.source_id) return true;
  if (cand.counterparty && row.counterparty && sameAttendee(cand.counterparty, row.counterparty)) {
    const a = Date.parse(cand.created_at ?? '') || Date.now();
    const b = Date.parse(row.created_at ?? '') || Date.now();
    return Math.abs(a - b) <= DUP_WINDOW_DAYS * DAY_MS;
  }
  return false;
}
