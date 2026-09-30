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
import { topMessageOf } from '@/lib/inbox/top-message';

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

/** W28 · THE USER'S DAY, NOT UTC'S (TIME TRUTH): the source instant re-expressed as UTC noon of its
 *  LOCAL calendar day in `tz` — a Thursday 22:00 mail in a zone west of UTC is a THURSDAY mail ("by
 *  Friday" = tomorrow), though its UTC day is already Friday. Every day-based helper here reads the UTC
 *  day of its anchor, so callers pass this anchor instead of the raw instant. Unknown/invalid → as is. */
export function localDayAnchor(instantIso: string | null | undefined, tz: string | null | undefined): string | null {
  if (!instantIso || Number.isNaN(Date.parse(instantIso))) return instantIso ?? null;
  if (!tz) return instantIso;
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(instantIso));
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')}T12:00:00Z`;
  } catch { return instantIso; }
}

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

// ── W27 · THE WEEKDAY SNAP (TIME TRUTH: "no date derived by a model where code can compute it" — found
// by the eval). "By Saturday" came back as the Friday on the small tier, and every weekday a day late
// on another; nothing checked it, because the stated-window parser reads dates, not weekday names. A
// weekday is arithmetic over the source's own date, so code resolves it. The vocabulary is GENERATED
// from Intl for the corpus locales (never a hand table of languages); the short PT forms ("sexta",
// "quarta") are deliberately not read — they are also ordinals ("a quarta versão").
const WEEKDAY_LOCALES = ['en-US', 'pt-PT', 'de-DE', 'fr-FR', 'es-ES', 'it-IT', 'nl-NL'] as const;
const WEEKDAY_NAMES: Map<string, number> = (() => {
  const m = new Map<string, number>();
  for (let i = 0; i < 7; i++) {
    const d = new Date(Date.UTC(2026, 0, 4 + i, 12)); // 2026-01-04 is a Sunday → index i
    for (const loc of WEEKDAY_LOCALES) {
      try { const n = fold(d.toLocaleDateString(loc, { weekday: 'long', timeZone: 'UTC' })); if (n.length >= 5) m.set(n, i); } catch { /* locale absent */ }
    }
  }
  return m;
})();
const WD_RE = new RegExp(`(?<![\\p{L}])(${[...WEEKDAY_NAMES.keys()].sort((a, b) => b.length - a.length).map(esc).join('|')})(?![\\p{L}])`, 'gu');

/** The weekdays (0 = Sunday) a text names, in any corpus language. Pure. */
export function weekdaysNamedIn(text: string | null | undefined): Set<number> {
  const out = new Set<number>();
  for (const m of fold(String(text ?? '')).matchAll(WD_RE)) {
    const i = WEEKDAY_NAMES.get(m[1]);
    if (i !== undefined) out.add(i);
  }
  return out;
}

/** The source states `iso` with its DAY NUMBER (any language/format dateStatedInText reads) — a bare
 *  weekday name is not enough to vouch for a specific date ("by Friday" names every Friday). Pure. */
export function dateStatedExplicitly(text: string | null | undefined, isoDate: string): boolean {
  // W28 · A LIST NUMBER IS NOT A DAY: "1. Please send the SOW by Friday" once vouched for the 1st
  // (a Thursday the model wrote) — the list marker was read as the date's day number, so the weekday
  // snap stood down and the wrong date stood. Line-leading enumerators ("1.", "2)", "- ") come out
  // before the day number is looked for.
  const t = String(text ?? '').replace(/(^|\n)[ \t]*(?:\d{1,2}[.)]|[-*•·])[ \t]+/g, '$1');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate) || !dateStatedInText(t, isoDate)) return false;
  const day = Number(isoDate.slice(8, 10));
  return new RegExp(`(?<!\\d)0?${day}(?!\\d)`).test(t);
}

/** The first date carrying weekday `idx` strictly AFTER the anchor day (1–7 days on) — "by Friday"
 *  said on a Friday means the next one. */
export function weekdayForward(idx: number, anchorIso?: string | null): string {
  const a = anchorMs(anchorIso);
  const days = ((idx - new Date(a).getUTCDay() + 7) % 7) || 7;
  return iso(a + days * DAY_MS);
}

/**
 * THE WEEKDAY SNAP: a model date within the coming week whose weekday the source never names, while
 * the source (the commitment's own quote first, else the message's own words) names exactly ONE
 * weekday that resolves within two days of it, is an arithmetic slip — code writes the right date.
 * Anything else stands untouched: a date the source spells out, a weekday the source names, several
 * weekdays with no quote to choose, a date far from any named weekday. A missed snap is survivable; a
 * false rewrite is not. Pure.
 */
export function snapWeekdayDue(modelIso: string | null, opts: { sourceText?: string | null; quote?: string | null; anchorIso?: string | null }): string | null {
  if (!modelIso || !/^\d{4}-\d{2}-\d{2}$/.test(modelIso)) return modelIso;
  const anchor = anchorMs(opts.anchorIso);
  const ms = Date.parse(`${modelIso}T12:00:00Z`);
  if (Number.isNaN(ms) || ms < anchor - DAY_MS || ms > anchor + 9 * DAY_MS) return modelIso;
  const own = opts.sourceText ? topMessageOf(String(opts.sourceText)) : '';
  if (dateStatedExplicitly(own, modelIso) || dateStatedExplicitly(opts.quote, modelIso)) return modelIso;
  const fromQuote = weekdaysNamedIn(opts.quote);
  const named = fromQuote.size ? fromQuote : weekdaysNamedIn(own);
  if (named.size !== 1) return modelIso;
  const dow = new Date(ms).getUTCDay();
  if (named.has(dow)) return modelIso;
  const fixed = weekdayForward([...named][0], opts.anchorIso);
  // W28: when the commitment's OWN QUOTE names the one weekday, that weekday IS the deadline — a model
  // date of another weekday in the coming week is an arithmetic slip however far it landed ("by
  // Thursday" written as next Wednesday). Named only elsewhere in the message, the ±2-day guard stays.
  if (fromQuote.size === 1) return fixed;
  return Math.abs(Date.parse(`${fixed}T12:00:00Z`) - ms) <= 2 * DAY_MS ? fixed : modelIso;
}

/**
 * THE WINDOW'S END as `due_date`: the model's (forward-anchored) date, widened to the end of a
 * window the description states when the model's date sits inside it; the stated window's end when
 * the model gave none. `sourceText`, when present, must itself state the window's start (a title
 * the model wrote cannot mint a date its source never said). No stated date → null.
 */
export function dueDateFromSource(opts: {
  modelDate?: unknown; description: string; sourceText?: string | null; anchorIso?: string | null;
  /** W27: the commitment's verbatim quote — the weekday snap reads the weekday IT names first. */
  quote?: string | null;
}): string | null {
  const model = snapWeekdayDue(anchorDueDate(opts.modelDate, opts.anchorIso),
    { sourceText: opts.sourceText, quote: opts.quote, anchorIso: opts.anchorIso });
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

// ── THE ATTENDANCE FLOOR (W20 · ONE FACT, ONE HOME). A mutual meeting is a CALENDAR fact, never a
// debt: "Attend the scheduled call — Oct 12" is no obligation either side owes the other — the event
// (or the invite the item prepares) is its one home. The extractor is told so; this is the zero-AI
// floor at the write, so a model that still emits one never lands a row. Conservative: only a title
// that IS attendance (an attendance verb leading, a meeting noun in it, nothing chained after "and");
// "Schedule a call", "Prepare for the meeting", "Join the call and present the deck" all survive. ──
const ATTEND_LEAD = /^(?:please\s+)?(?:attend|join|be\s+(?:present\s+)?(?:at|on|in|for)|participate\s+in|take\s+part\s+in|show\s+up\s+(?:at|to|for)|dial\s+in(?:to)?|hop\s+on|jump\s+on|sit\s+in\s+on|assister\s+a|participer\s+a|rejoindre|participar\s+(?:em|n[ao]s?|en)|comparecer|asistir\s+a|teilnehmen|an\s+\S+\s+teilnehmen)\b/;
const MEETING_NOUN = /\b(?:call|calls|meeting|meetings|session|sync|catch[-\s]?up|demo|webinar|workshop|interview|stand[-\s]?up|check[-\s]?in|conference|kick[-\s]?off|zoom|teams|appel|reunion|reuniao|chamada|videochamada|besprechung|termin|llamada)\b/;
export function isAttendanceObligation(description: string | null | undefined): boolean {
  const t = fold(String(description ?? '')).trim();
  if (!t || !ATTEND_LEAD.test(t) || !MEETING_NOUN.test(t)) return false;
  // A chained deed ("…and present the deck", "…& send the notes") is real work riding the meeting.
  return !/\s(?:and|&|\+|et|e|und|y)\s+\p{L}/u.test(t.replace(/\s[—–-]\s.*$/, ''));
}
