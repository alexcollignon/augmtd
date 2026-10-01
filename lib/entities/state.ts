// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ONE BRAIN — ENTITY STATE synthesis (Phase B→C bridge). The brains move INTO the entity registry:
// for each entity, ONE reasoned pass over its linked ledger (all sources) produces where-it-stands,
// momentum, whoOwes, the ONE next move, and — new — the REASONED PRIORITY {weight, reason} that replaces
// the hand-tuned verdict weight tables (the demolition promise: judgment is reasoned, never a formula).
//
// Same discipline as the initiative/person brains: assembly is deterministic + cheap; the AI call is
// sig-gated (unchanged ledger = no AI); classification-shape via the router. Consumers read these fields
// in Phase C exactly where they read initiative_state/verdict today.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';
import { readPlans, asRawResult } from '@/lib/store/item-plans';
import { aiCall } from '@/lib/ai/call';
import { isAutomatedSender } from '@/lib/inbox/automated';
import { clipForPrompt, clipForDisplay, EXCERPT_RULE } from '@/lib/utils/clip-for-prompt';
import { serveTimeWords, absolutizeTimeWords, annotateMessageDays, dayStrip, shortDay } from '@/lib/core/relative-time';
import { withoutMachineAddressed } from '@/lib/utils/inbound-data';
import { topMessageOf } from '@/lib/inbox/top-message';
import { figuresIn } from '@/lib/room/figures';

// VOICE (P5a): bump whenever the synthesis prompt/voice changes — threaded into the stored sig so every
// cached state regenerates through the existing sig-gated paths (the alignment-cache lesson: a
// prompt-driven cache must invalidate on the prompt itself, not only on the data).
export const STATE_PROMPT_VERSION = 10; // 10: W37 (eval narrate.state) — the ledger gist carries the message's own words at LEDGER_GIST_CHARS (a 90-char gist cut the target off "94% (target 98%)" and the synthesis called the rollout "on track"), and THE NARRATION TRUTH RULES (owes only from a stated ask/promise/commitment · results against their stated targets · conflicting values both named · lapsed prep for a past event is not due ahead). 9: THE SETTLED LINE IS HISTORY — a (handled)/DONE line, or one whose NOW clause says THE USER spoke last, may not appear in whoOwes.you, blocking OR next_move (found live: the synthesis ran after the resolutions, read both signals, demanded the settled deed anyway, and froze on a matching sig); rides with THE WATERMARK SURVIVES THE CLIP, which changes the ledger TEXT — so every stale state re-synthesizes lawfully through the existing sig gate. 8: THE ONE-CLAIM LAW — the judge's standing verdicts are FACTS the prose must not contradict ("no reply needed yet" stood for days under a headline saying "confirm or propose" — two caches, one page, neither able to invalidate the other; found live). 7: THE EXCERPT-HONESTY LAW — clipped gists declare themselves; a clip marker is never source truncation. 6: LAW 6 — settled ledger lines speak history-grammar, never open-debt grammar. 5: THE DEIXIS LAW — no relative day-words in cached prose; pre-today ledger events are the past. 4: the reasoned `scope` verdict.

// The BANNED machinery register — the system describing its own bookkeeping instead of the matter.
// ONE definition: the synthesis self-checks against it (with a corrective retry) and the voice smoke
// gates with the same regex — they can never drift.
export const MACHINERY_REGISTER = /prepared for nudge|nudge (?:sent|prepared|ready)|completion signals?|draft (?:is )?ready|pending confirmation|documentation deliverables|communication (?:to \S+ )?overdue|no (?:response|reply) signal|awaiting your documentation|reminder (?:sent|scheduled)|follow-?up (?:prepared|queued)/i;

export type EntityState = {
  summary: string;                                  // where it stands right now
  momentum: 'active' | 'needs_you' | 'waiting' | 'gone_quiet' | 'stalled';
  category?: 'client' | 'internal' | 'personal' | 'admin'; // what KIND of work (reasoned)
  /** PROJECTHOOD (projecthood-plan P1) — the JUDGED scope. `project` = an ongoing body of work that
   *  belongs in the user's portfolio; `errand` = real but self-contained (one action closes it);
   *  `background` = automated/admin hum. The user's `tracked` pin is a READ-TIME override
   *  (consumers treat tracked as project) — the judgment itself stays pure. */
  scope?: 'project' | 'errand' | 'background';
  whoOwes: { you: string[]; them: string[] };
  stage: string | null;
  blocking: string | null;
  /** W19.A — when this prose was composed (the TIME TRUTH anchor every serve reads). Absent on
   *  states composed before the stamp: their relative words are withheld at serve. */
  composedAt?: string;
};
export type EntityNextMove = {
  kind: 'reply' | 'send' | 'followup' | 'none'; title: string; reason: string; entityRef: string | null;
  /** THE ARBITER (P6a): ledger refs ("inbox:<id>" / "commit:<id>") of the member items this move
   *  RESOLVES — the emails/commitments whose whole point IS this move. Consumers render covered
   *  members as EVIDENCE under the one action instead of parallel calls-to-action ("one deal, one
   *  ask" — the semantic twin of one-obligation-one-row). Items NOT covered keep their own ask. */
  covers?: string[];
};
export type EntityPriority = { weight: number; reason: string };

export type LedgerLine = { at: string; kind: string; who: string | null; text: string; ref: string };

/** W37 · the ledger gist width (the message's own words): wide enough to keep a figure with its target. */
export const LEDGER_GIST_CHARS = 260;
/** W37 · the state synthesis' reasoning effort (lib/ai/effort.ts applies it per model family). */
export const STATE_EFFORT = 'low' as const;

/**
 * W37 · THE NARRATION TRUTH RULES (eval narrate.* / prep.*: the state, person, status and prep narrators all
 * invented "they owe: confirm X", called a pilot at 94% against a 98% target "on track", silently picked one of
 * two budgets, and demanded prep for a workshop that had already happened). ONE copy, read by every narrator
 * that speaks where work stands (lib/entities/state.ts, lib/people/brain.ts, the status update, the meeting
 * preps). Pure text.
 */
export const NARRATION_TRUTH_RULES =
  `TRUTH RULES (each one checked before you answer):\n` +
  `- OWED ONLY FROM THE RECORD: something is owed — by the user or by them — only where a line states it: an ask put to someone, a promise someone made, an open commitment. Never infer an acknowledgement, a confirmation, a "response" or an "update" as owed. When the user's own message delivered the thing (sent it, attached it) or the other side said nothing more is needed, nothing is owed for it.\n` +
  `- RESULTS AGAINST THEIR TARGETS: a result stated with a target is reported with it ("94% against a 98% target"); a missed target is never "on track".\n` +
  `- CONFLICTING VALUES: when lines give different values for the same thing (a budget, a date, a count), name both with who said each. They stay a conflict — never choose one, not even the newer — until a line settles it in words ("moves to", "change of plan", "this replaces"); then use the new value and say it changed. While it is open, settling it (asking which holds) comes before any step that would use the figure.\n` +
  `- ASKS THAT PULL AGAINST EACH OTHER: two open asks that cannot both be honoured as written (confirm a payment / hold all payments) are named together, and the move is one reply that settles both.\n` +
  `- NOTHING FILLED IN FOR THE USER: never propose a date, figure, option or wording on the user's behalf that the records do not contain — what the user still has to decide is named as theirs to decide.\n` +
  `- A SCHEDULED FACT IS NOT A DEBT: "the station arrives on 6 October", "training is booked" are facts about the work, not things a person owes.\n` +
  `- DATES AS WRITTEN: a day a message names relative to itself ("on Monday", "by Friday") belongs to that message's own date (each line shows its weekday) — "Monday" in a message sent on a Monday is the NEXT Monday. Keep it in the message's words, or resolve it from the message's date; never invent a calendar date for it. Name dates, never a count of days you worked out yourself ("by Mon 5 Oct", not "2 days left").\n` +
  `- PAST IS PAST: anything dated before today has happened or lapsed. A preparation owed for an event that has already taken place is no longer due ahead — say its status is unconfirmed, and make the move a follow-up on how the event went and what comes next; never present it as upcoming, and never leave a just-past event with no move.`;

/** W37 · the sections of the ONE grounding page (lib/room/grounding.ts) a ledger-based narrator also needs:
 *  the threads' own newest words and the code-read figures — an item's envelope follows its NEWEST message,
 *  so an earlier figure on the same thread (a €40,000 approval before a €45,000 request) never reached the
 *  ledger. Picks the named top-level sections out of the page text. Pure. */
export const PAGE_SECTION_HEADS = ['THE LEDGER NOW', 'THE LIVE BOARD', 'FIGURES ON RECORD', 'THE THREADS THEMSELVES', 'THE SYNTHESIS (', 'GOALS:', 'RULES:', 'STANDING PRODUCTION', 'OPEN ASKS TO THE USER', 'HISTORY (', 'FILES on this work', 'THE CONVERSATION'] as const;
export function pickPageSections(page: string, heads: readonly string[]): string {
  const text = String(page ?? '');
  const starts = PAGE_SECTION_HEADS.map((h) => ({ h, i: text.startsWith(h) ? 0 : text.indexOf(`\n\n${h}`) }))
    .filter((x) => x.i >= 0).map((x) => ({ h: x.h, i: x.i === 0 ? 0 : x.i + 2 })).sort((a, b) => a.i - b.i);
  return starts.filter((x) => heads.includes(x.h)).map((x) => {
    const next = starts.find((y) => y.i > x.i);
    return text.slice(x.i, next ? next.i : undefined).trim();
  }).join('\n\n');
}

/**
 * W37 · THE FIGURES FLOOR (two keys: the model writes, code checks). The page's FIGURES ON RECORD block lists
 * the different amounts the messages state in one currency; a narration that names one of them and leaves
 * another out has silently picked a figure (eval narrate.status: "€45,000, which supersedes the €40,000" was
 * the good case; the bad one never said €40,000 at all). Returns the on-record amounts (as written) the text
 * leaves out — only when the text names at least one of them (a narration about something else is not
 * checked). Pure.
 */
export function figuresLeftOut(page: string, text: string): string[] {
  const block = pickPageSections(page, ['FIGURES ON RECORD']);
  if (!block) return [];
  // The block's lines read "- €40,000 — Lee, 2026-09-26: "clause"" — the amount is the line head.
  const heads = block.split('\n').slice(1).map((l) => l.replace(/^-\s*/, '').split(' — ')[0]).filter(Boolean);
  const onRecord = figuresIn(heads.map((h) => ({ who: '', at: null, text: h })));
  const written = figuresIn([{ who: '', at: null, text: String(text ?? '') }]);
  const has = (f: { currency: string; value: number }) => written.some((w) => w.currency === f.currency && Math.abs(w.value - f.value) < 0.005);
  if (!onRecord.some(has)) return [];
  return [...new Set(onRecord.filter((f) => !has(f)).map((f) => f.raw))];
}

/** W37 · an ISO day with its weekday ("Mon 2026-09-28") — so a narrator can place "by Monday" written in
 *  that message (a bare ISO date made models resolve a message's weekday to the wrong day). Pure. */
export function withWeekday(iso: string | null | undefined): string {
  const day = String(iso ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return day;
  return `${new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })} ${day}`;
}

/** W37 · the page's FIGURES ON RECORD block, parsed back into its facts (amount · who · day · their words). Pure. */
export type PageFigure = { raw: string; who: string; at: string | null; clause: string };
export function figuresFromPage(page: string): PageFigure[] {
  const block = pickPageSections(page, ['FIGURES ON RECORD']);
  if (!block) return [];
  const out: PageFigure[] = [];
  for (const line of block.split('\n').slice(1)) {
    const m = /^-\s*(.+?) — (.+?)(?:, (\d{4}-\d{2}-\d{2}))?: "(.*)"\s*$/.exec(line.trim());
    if (m) out.push({ raw: m[1].trim(), who: m[2].trim(), at: m[3] ?? null, clause: m[4].trim() });
  }
  return out;
}

/**
 * W37 · THE FIGURES ARE STATED BY CODE (eval room.opening / prep.anticipate: the composer named both budgets
 * but dropped WHAT each one was — "finance approved, incl. two workshops" vs "the CFO's plan figure" — or kept
 * only one). When a composed text names any amount on the page's FIGURES ON RECORD, this returns ONE code-built
 * line stating every on-record amount with who stated it, when, and in their own words — the composer's prose
 * stays, the facts ride beside it verbatim. null when the text names none of them (a narration about something
 * else is never decorated). Pure.
 */
export function figuresOnRecordLine(page: string, text: string): string | null {
  const figs = figuresFromPage(page);
  if (figs.length < 2) return null;
  const written = figuresIn([{ who: '', at: null, text: String(text ?? '') }]);
  const named = figs.some((f) => figuresIn([{ who: '', at: null, text: f.raw }]).some((x) => written.some((w) => w.currency === x.currency && Math.abs(w.value - x.value) < 0.005)));
  if (!named) return null;
  // Already said: every figure named AND its source's own words carried (most of its content words) — the
  // composer did the job; a second copy is repetition, not a fact.
  const lower = String(text ?? '').toLowerCase();
  const covered = (f: PageFigure) => {
    const toks = [...new Set((f.clause.toLowerCase().match(/[\p{L}]{5,}/gu) ?? []))];
    return toks.length > 0 && toks.filter((t) => lower.includes(t)).length / toks.length >= 0.34;
  };
  if (!figuresLeftOut(page, text).length && figs.every(covered)) return null;
  const day = (at: string | null) => (at ? `, ${shortDay(at)}` : '');
  return `On record: ${figs.slice(0, 4).map((f) => `${f.raw} — ${f.who}${day(f.at)}: "${clipForDisplay(f.clause, 140)}"`).join('; ')}.`;
}

/** W37 · ADOPTION GRAMMAR: a narration that treats one of two on-record amounts as settled ("budget is set at
 *  €45,000", "updated from €40,000", "build the deck with the €45,000 figure"). Returns the adopting phrase, or
 *  null. Only when the page carries two or more figures. Pure. */
const ADOPTS = /\b(?:is (?:now |set )?(?:at )?|set at|confirmed(?: at)?|should be|updated (?:to|from)|revised (?:to|from)|updating (?:the )?(?:earlier|previous|old)|replac\w*|supersed\w*|locked(?: in)?|final(?:ised|ized)?|go(?:es|ing)? with|use the|with the|stick with|proceed with|budgeted|per \w+'s (?:latest|update)|latest figure)\b/i;
const AMOUNT = /(?:R\$|€|\$|£)\s?\d[\d.,\s]*(?:\s?[kKmM]\b)?|\d[\d.,]*\s?(?:[kKmM]\b\s?)?(?:€|EUR|USD|GBP)/g;
export function adoptsOneFigure(page: string, text: string): string | null {
  const figs = figuresFromPage(page);
  if (figs.length < 2) return null;
  const onRecord = figuresIn(figs.map((f) => ({ who: '', at: null, text: f.raw })));
  const t = String(text ?? '');
  AMOUNT.lastIndex = 0;
  for (let m = AMOUNT.exec(t); m; m = AMOUNT.exec(t)) {
    const val = figuresIn([{ who: '', at: null, text: m[0].trim() }])[0];
    if (!val || !onRecord.some((f) => f.currency === val.currency && Math.abs(f.value - val.value) < 0.005)) continue;
    const win = t.slice(Math.max(0, m.index - 45), m.index + m[0].length + 14);
    if (ADOPTS.test(win)) return win.trim();
  }
  return null;
}

const daysBetween = (a: string, b: number) => Math.floor((b - new Date(a).getTime()) / 86400000);

// ════════════════════════════════════════════════════════════════════════════════════════════════
// A SETTLED LINE CANNOT FOUND A DEMAND — the code half (owner walk, Sep 8; proven necessary by the
// fidelity run, where the strengthened PROMPT alone still re-issued the settled deed).
//
// The doctrine this repo learned three times over: a prompt is a hope, the law is code. So the
// model proposes and a DETERMINISTIC arbiter disposes (the two-key idiom): every whoOwes.you item,
// the blocking phrase and the next_move are matched — by the house distinctive-token test — against
// the ledger lines themselves. A claim that belongs to a SETTLED line (marked handled/dismissed/
// DONE, or whose watermark says THE USER spoke last) more than to any OPEN line is a settled deed
// restated, and it is dropped. Nothing is invented and nothing open is ever silenced: a claim that
// matches an open line at least as well always survives.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** A line whose obligation has left the user's hands — the two settlement signals, read structurally. */
export function isSettledLedgerLine(text: string): boolean {
  return /\(handled\)|\(dismissed[^)]*\)|^DONE — /.test(text)
    || /— NOW \([^)]*\bthe user spoke last\)/.test(text);
}

/** Share of the CLAIM's distinctive tokens present in a line (the offerEchoesMove idiom). */
function claimShare(claimTokens: string[], line: string): number {
  if (!claimTokens.length) return 0;
  const hay = line.toLowerCase();
  return claimTokens.filter((t) => hay.includes(t)).length / claimTokens.length;
}

/** The arbiter. Returns true when `claim` restates a settled line and no open line owns it better. */
export function restatesSettledWork(claim: string, ledger: LedgerLine[], generic: Set<string>): boolean {
  const toks = [...new Set(String(claim ?? '').toLowerCase().split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 4 && !generic.has(t)))];
  if (toks.length < 2) return false; // too little signal to accuse anything — keep the claim
  let settledBest = 0, openBest = 0;
  for (const l of ledger) {
    const s = claimShare(toks, l.text);
    if (isSettledLedgerLine(l.text)) settledBest = Math.max(settledBest, s);
    else openBest = Math.max(openBest, s);
  }
  return settledBest >= 0.5 && settledBest > openBest;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// W19.A · THE SUMMARY IS NOT A SECOND TRUTH (invariant 6 ONE FACT, ONE HOME + 14 TIME TRUTH; owner
// walk Sep 28). The synthesis v9 prompt forbids naming a (handled) line as owed and the write-time
// arbiter above checks it — and a stored state still read "Your RIB stops the pilot payment … Nine
// days overdue" beside a ledger whose RIB line was handled: the arbiter's 4-letter floor could not
// see the acronym that WAS the matter, and an open line sharing the deal's generic words out-scored
// the settled one. The stored prose is a DERIVED VIEW of the rows; where it disagrees with them the
// rows win, at every serve. This floor is zero AI and pure:
//   · SETTLED-DISTINCTIVE TOKENS — the words that name a settled line's matter and NO open line's
//     (data-derived per ledger: what is shared with open work is not evidence either way; acronyms
//     count however short). A blocking / whoOwes / next-move claim, or a summary clause spoken in
//     owed grammar, that names settled matter more than open matter is DROPPED.
//   · TIME — every sentence passes serveTimeWords against the state's own composition time; a
//     sentence whose relative words cannot be proven true ("nine days overdue" with no known
//     anchor) is WITHHELD, never served.
// The write path runs the same floor before storing, so a recomposed state is clean at the source.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** A line whose ROW is closed — handled, dismissed or DONE. Deliberately NOT the watermark ("the user
 *  spoke last"): since W19.A a reply that only PROMISES a deliverable leaves the item open, so the
 *  last speaker is no longer proof of settlement at the serve floor — only the row's status is. */
export function isClosedLedgerLine(text: string): boolean {
  return /\(handled\)|\(dismissed[^)]*\)|^DONE — /.test(String(text ?? ''));
}

/** The line's MATTER — its title/description, without status marks, gists, watermarks or labels. */
export function ledgerLineHead(text: string): string {
  let s = String(text ?? '');
  s = s.replace(/^DONE — [^:]*:\s*/, '').replace(/^(?:you owe|they owe|team prepared|Upcoming meeting|Meeting):\s*/i, '');
  const cut = [' (handled)', ' (dismissed', ' — "', ' — NOW (', ' [attached', ' (was due ', ' (due '].map((m) => s.indexOf(m)).filter((i) => i > 0);
  return (cut.length ? s.slice(0, Math.min(...cut)) : s).trim();
}

const MONTH_ABBR = new Set(['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']);
const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** The claim's content tokens: ≥4 letters, or a short ACRONYM as written (RIB, NDA, SOW). */
export function floorTokens(text: string, skip: ReadonlySet<string> = new Set()): string[] {
  const raw = String(text ?? '');
  const acronyms = new Set((raw.match(/\b[A-Z]{2,5}\b/g) ?? []).map((a) => fold(a)));
  return [...new Set(fold(raw).split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t && !/^\d+$/.test(t) && !skip.has(t) && !MONTH_ABBR.has(t) && (t.length >= 4 || acronyms.has(t))))];
}

/** The owed / blocking / overdue grammar a SUMMARY clause must speak before the floor may drop it
 *  (a clause telling settled history — "they met Jul 28" — is history, and stays). EN · PT · DE · FR. */
export const OWED_GRAMMAR = /(?<![\p{L}])(?:owe[sd]?|owing|promis|overdue|late|past due|deadline|due|block|unblock|stops?|holding up|holds up|waiting (?:on|for)|awaiting|needs? (?:you|your)|still (?:owe|need|to)|must|has to|have to|outstanding|pending|missing|deve[ms]?|devido|prometid|prometeu|atras|prazo|bloque|pendente|falta|aguard|schuld|versproch|[üu]berf[äa]llig|versp[äa]t|frist|f[äa]llig|blockier|ausstehend|fehlt|wartet|dois|doit|devez|promis|retard|[ée]ch[ée]ance|bloqu|en attente|attend|manque)/iu;

export type SettledIndex = { settled: Set<string>; open: Set<string> };

/** Per-ledger token index: words DISTINCTIVE to settled lines (in ≤2 settled heads and no open
 *  head) vs words only open lines carry. Shared words belong to neither — they prove nothing. */
export function settledIndexOf(ledger: ReadonlyArray<{ text: string }>, skip: ReadonlySet<string> = new Set()): SettledIndex {
  const settledCount = new Map<string, number>();
  const openAll = new Set<string>();
  for (const l of ledger) {
    const toks = floorTokens(ledgerLineHead(l.text), skip);
    if (isClosedLedgerLine(l.text)) for (const t of toks) settledCount.set(t, (settledCount.get(t) ?? 0) + 1);
    else for (const t of toks) openAll.add(t);
  }
  const settled = new Set([...settledCount].filter(([t, n]) => n <= 2 && !openAll.has(t)).map(([t]) => t));
  const open = new Set([...openAll].filter((t) => !settledCount.has(t)));
  return { settled, open };
}

/** Does this claim name SETTLED matter more than open matter? Pure. */
export function namesSettledWork(claim: string, idx: SettledIndex, skip: ReadonlySet<string> = new Set()): boolean {
  const toks = floorTokens(claim, skip);
  const s = toks.filter((t) => idx.settled.has(t)).length;
  const o = toks.filter((t) => idx.open.has(t)).length;
  return s >= 1 && s > o;
}

const SUMMARY_CLAUSES = /(?<=[.,;:])\s+|\s+—\s+/;
const SENTENCES = /(?<=[.!?])\s+/;

/** THE TIME HALF, sentence-wise: every sentence served through serveTimeWords against the state's
 *  own composition time; a sentence that cannot be proven true is withheld (the rest stands). */
export function serveStateProse(text: string | null | undefined, anchor: { composedAt: string | null | undefined; now?: Date; tz?: string | null }): { text: string; withheld: string[] } {
  const raw = String(text ?? '');
  const withheld: string[] = [];
  const kept: string[] = [];
  let changed = false;
  for (const s of raw.split(SENTENCES).filter((x) => x.trim())) {
    const v = serveTimeWords(s, anchor);
    if (v.withheld) { withheld.push(s); changed = true; } else { kept.push(v.text); if (v.text !== s) changed = true; }
  }
  // Nothing to floor → the stored text byte-identical (a cache sig that reads it never moves).
  return { text: changed ? kept.join(' ').trim() : raw, withheld };
}

export type ServedEntityState = {
  summary: string | null;
  blocking: string | null;
  whoOwesYou: string[];
  whoOwesThem: string[];
  nextMove: string | null;
  /** The stage label (a short phrase — "payment blocked, awaiting the RIB" is a claim too). */
  stage: string | null;
  /** What the settled floor dropped (claims naming handled work as owed). */
  dropped: string[];
  /** What the time floor withheld (relative words that cannot be proven true today). */
  withheld: string[];
};

/**
 * THE SERVE FLOOR for a stored entity state (pure, zero AI). `ledger` = the live ledger (when the
 * reader holds it — the settled half runs only then); `composedAt` = the state's own composition
 * time (state.composedAt; unknown → relative words are withheld).
 */
export function serveEntityState(
  state: { summary?: unknown; blocking?: unknown; stage?: unknown; whoOwes?: { you?: unknown; them?: unknown } | null; composedAt?: unknown } | null | undefined,
  opts: { ledger?: ReadonlyArray<{ text: string }> | null; entityName?: string | null; generic?: ReadonlySet<string>; nextMove?: string | null; now?: Date; tz?: string | null } = {},
): ServedEntityState {
  const st = state ?? {};
  const skip = new Set<string>([...(opts.generic ?? []), ...floorTokens(String(opts.entityName ?? ''))]);
  const idx = opts.ledger?.length ? settledIndexOf(opts.ledger, skip) : null;
  const dropped: string[] = [];
  const withheld: string[] = [];
  const anchor = { composedAt: typeof st.composedAt === 'string' ? st.composedAt : null, now: opts.now, tz: opts.tz };
  const settledClaim = (c: string) => !!idx && namesSettledWork(c, idx, skip);
  const claim = (c: unknown): string | null => {
    const s = typeof c === 'string' ? c.trim() : '';
    if (!s) return null;
    if (settledClaim(s)) { dropped.push(s); return null; }
    const t = serveStateProse(s, anchor);
    withheld.push(...t.withheld);
    return t.text || null;
  };
  const list = (xs: unknown): string[] => (Array.isArray(xs) ? xs : []).map(claim).filter((x): x is string => !!x);
  // The summary: owed-grammar clauses naming settled matter drop; then the time half, sentence-wise.
  let summary: string | null = null;
  const raw = typeof st.summary === 'string' ? st.summary.trim() : '';
  if (raw) {
    // Clause-wise (the file's one CLAUSES split — the boundaries keep their punctuation), so a
    // dropped or withheld clause leaves the rest of the position readable.
    const parts = raw.split(SUMMARY_CLAUSES);
    let changed = false;
    const kept: string[] = [];
    for (const c of parts) {
      if (OWED_GRAMMAR.test(c) && settledClaim(c)) { dropped.push(c); changed = true; continue; }
      const v = serveTimeWords(c, anchor);
      if (v.withheld) { withheld.push(c); changed = true; continue; }
      if (v.text !== c) changed = true;
      kept.push(v.text);
    }
    let mended = !changed ? raw : kept.join(' ').replace(/\s+/g, ' ').replace(/[\s,;:—]+$/, '').trim();
    if (mended && changed && !/[.!?]$/.test(mended)) mended = `${mended}.`;
    summary = mended || null;
  }
  return {
    summary,
    blocking: claim(st.blocking),
    whoOwesYou: list(st.whoOwes?.you),
    whoOwesThem: list(st.whoOwes?.them),
    nextMove: claim(opts.nextMove ?? null),
    stage: claim(st.stage),
    dropped, withheld,
  };
}

/**
 * W19.A · THE LEDGER HEADS — the light ledger the serve floor needs for MANY entities at once: each
 * entity's linked inbox items + commitments as status-marked title lines (the same grammar
 * assembleLedger writes — "(handled)", "(dismissed)", "DONE — …", "you owe: …"), without gists,
 * watermarks, meetings or deliverables (the floor reads only a line's matter and whether its row is
 * closed). Batched + paged (NO SILENT CAPS); a failed read yields no heads (the time half still runs).
 */
export async function loadLedgerHeads(client: SupabaseClient, userId: string, entityIds: string[]): Promise<Map<string, Array<{ text: string }>>> {
  const out = new Map<string, Array<{ text: string }>>();
  const ids = [...new Set(entityIds.filter(Boolean))];
  if (!ids.length) return out;
  try {
    const { fetchAllRows } = await import('@/lib/utils/fetch-all');
    const chunk = <T,>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, (i + 1) * n));
    type Link = { entity_id: string; item_kind: string; item_id: string };
    const links = (await Promise.all(chunk(ids, 100).map((c) => fetchAllRows<Link>((from, to) => client.from('entity_links')
      .select('entity_id, item_kind, item_id').eq('user_id', userId).in('entity_id', c).in('item_kind', ['inbox_item', 'commitment'])
      .order('item_id', { ascending: true }).range(from, to) as unknown as PromiseLike<{ data: Link[] | null; error: unknown }>)))).flat();
    const inboxIds = [...new Set(links.filter((l) => l.item_kind === 'inbox_item').map((l) => l.item_id))];
    const commitIds = [...new Set(links.filter((l) => l.item_kind === 'commitment').map((l) => l.item_id))];
    const line = new Map<string, string>();
    await Promise.all([
      ...chunk(inboxIds, 200).map(async (c) => {
        const { data, error } = await client.from('inbox_items').select('id, work_title, status, subject:source_data->>subject').eq('user_id', userId).in('id', c);
        if (error) return;
        for (const it of (data ?? []) as Array<{ id: string; work_title: string | null; status: string; subject: string | null }>) {
          const res = it.status === 'completed' ? ' (handled)' : it.status === 'dismissed' ? ' (dismissed)' : '';
          line.set(`inbox_item:${it.id}`, `${String(it.work_title || it.subject || '')}${res}`);
        }
      }),
      ...chunk(commitIds, 200).map(async (c) => {
        const { data, error } = await client.from('commitments').select('id, description, direction, status').eq('user_id', userId).in('id', c);
        if (error) return;
        for (const r of (data ?? []) as Array<{ id: string; description: string | null; direction: string | null; status: string }>) {
          const closed = r.status === 'done' || r.status === 'dismissed';
          line.set(`commitment:${r.id}`, closed ? `DONE — handled: ${r.description ?? ''}` : `${r.direction === 'awaiting' ? 'they owe' : 'you owe'}: ${r.description ?? ''}`);
        }
      }),
    ]);
    for (const l of links) {
      const t = line.get(`${l.item_kind}:${l.item_id}`);
      if (!t) continue;
      (out.get(l.entity_id) ?? out.set(l.entity_id, []).get(l.entity_id)!).push({ text: t });
    }
  } catch { /* the settled half needs the rows; without them only the time half runs */ }
  return out;
}

/**
 * W19.A · THE ONE SERVE DOOR for stored entity rows — every reader that surfaces a work_entities
 * state's prose (summary · blocking · whoOwes · the next move's title) passes its rows through here.
 * Returns the rows with `state` floored (serveEntityState over the entity's ledger heads + the time
 * floor against state.composedAt) and `next_move` dropped when its title named settled work. The
 * row's other fields are untouched. `heads` may be pre-loaded (a caller that starts the read in its
 * first wave); otherwise it is loaded here in one batched pass.
 */
export async function floorEntityRows<T extends Record<string, unknown>>(
  client: SupabaseClient, userId: string, rows: T[],
  opts: { heads?: Map<string, Array<{ text: string }>> | Promise<Map<string, Array<{ text: string }>>>; tz?: string | null; now?: Date } = {},
): Promise<T[]> {
  if (!rows.length) return rows;
  const [heads, generic] = await Promise.all([
    opts.heads ?? loadLedgerHeads(client, userId, rows.map((r) => String(r.id ?? '')).filter(Boolean)),
    import('@/lib/entities/recognize').then((m) => m.GENERIC_WORK_WORDS as ReadonlySet<string>).catch(() => new Set<string>() as ReadonlySet<string>),
  ]);
  return rows.map((r) => floorEntityRowWith(r, heads.get(String(r.id ?? '')) ?? null, generic, opts));
}

/** The sync half of floorEntityRows (heads already in hand). Pure. */
export function floorEntityRowWith<T extends Record<string, unknown>>(
  r: T, ledger: ReadonlyArray<{ text: string }> | null, generic: ReadonlySet<string> = new Set(), opts: { tz?: string | null; now?: Date } = {},
): T {
  const st = (r.state && typeof r.state === 'object' ? r.state : null) as Record<string, unknown> | null;
  if (!st) return r;
  const nm = (r.next_move && typeof r.next_move === 'object' ? r.next_move : null) as { title?: unknown } | null;
  const s = serveEntityState(st as never, {
    ledger, entityName: typeof r.name === 'string' ? r.name : null, generic,
    nextMove: typeof nm?.title === 'string' ? nm.title : null, tz: opts.tz, now: opts.now,
  });
  const state = {
    ...st,
    summary: s.summary ?? undefined,
    blocking: s.blocking,
    ...('stage' in st ? { stage: s.stage } : {}),
    whoOwes: { you: s.whoOwesYou, them: s.whoOwesThem },
  };
  const next = nm && typeof nm.title === 'string' ? (s.nextMove ? { ...nm, title: s.nextMove } : null) : r.next_move;
  return { ...r, state, ...('next_move' in r ? { next_move: next } : {}) };
}

/** Is a stored state older than the ledger it summarises? (Its sig embeds the ledger sig it was
 *  composed over — `v<N>:<ledgerSig>:ev…`.) Pure; an unknown sig is stale. */
export function entityStateStale(stateSig: string | null | undefined, ledgerSig: string | null | undefined): boolean {
  if (!ledgerSig) return false;
  return !String(stateSig ?? '').includes(`:${ledgerSig}:`);
}

// The user's own name (so the synthesis says "you") — same memo pattern as the brains.
const nameMemo = new Map<string, { at: number; name: string | null }>();
async function getUserName(supabase: SupabaseClient, userId: string): Promise<string | null> {
  const c = nameMemo.get(userId);
  if (c && Date.now() - c.at < 5 * 60 * 1000) return c.name;
  let name: string | null = null;
  try { const { data } = await supabase.from('profiles').select('full_name').eq('id', userId).maybeSingle(); name = (data as { full_name?: string } | null)?.full_name?.trim() || null; } catch { /* non-fatal */ }
  nameMemo.set(userId, { at: Date.now(), name });
  return name;
}

/** STRUCTURAL FACTS for the projecthood judgment (P1) — computed alongside the ledger, never AI.
 *  They CONSTRAIN the scope verdict the way domain facts constrain category. */
export type LedgerFacts = {
  counts: Record<string, number>;      // members by kind (email/meeting/commitment/event)
  spanDays: number;                    // first→last dated event
  activeDays: number;                  // distinct calendar days with activity
  automatedEmails: number;             // inbox members from automated/no-reply senders
  totalEmails: number;
  humanCounterparty: boolean;          // any real human on the other side (sender or commitment counterparty)
};

/** Assemble the entity's cross-source ledger from its links — deterministic, no AI. */
export async function assembleLedger(supabase: SupabaseClient, userId: string, entityId: string): Promise<{ ledger: LedgerLine[]; sig: string; quietDays: number | null; facts: LedgerFacts }> {
  const { data: links } = await supabase.from('entity_links')
    .select('item_kind, item_id').eq('user_id', userId).eq('entity_id', entityId).neq('item_kind', 'email_thread').limit(200);
  const byKind = new Map<string, string[]>();
  for (const l of (links ?? []) as Array<{ item_kind: string; item_id: string }>) {
    (byKind.get(l.item_kind) ?? byKind.set(l.item_kind, []).get(l.item_kind)!).push(l.item_id);
  }
  const ledger: LedgerLine[] = [];
  let totalEmails = 0, automatedEmails = 0, humanCounterparty = false;
  const inboxIds = byKind.get('inbox_item') ?? [];
  if (inboxIds.length) {
    const { data } = await supabase.from('inbox_items').select('id, work_title, source_data, created_at, status, last_activity_at').in('id', inboxIds.slice(0, 100));
    // THE WATERMARK LAW (Aug 2): a ledger line must carry the thread's CURRENT position, not the
    // founding snapshot — a member whose thread moved ("you replied", "they said thanks, done")
    // used to feed the synthesis its day-one ask forever. ONE batched query: the newest message
    // per member thread; when it's newer than the founding email, a NOW clause rides the line
    // (and, being part of the ledger text, it moves the sig — the state re-synthesizes).
    // ONE IMPLEMENTATION (Sep 8): the read moved to lib/inbox/thread-now.ts so the ROOM's composer
    // reads the same watermark this ledger does. A fork of this one fact is how a room ends up
    // demanding a reply the user already sent — the very class the owner walked into.
    const { latestByThread, nowClause } = await import('@/lib/inbox/thread-now');
    // W37 · a message's own day words are resolved against ITS date, in the user's zone (annotateMessageDays).
    const ledgerTz = await import('@/lib/utils/user-time').then((m) => m.userTimezone(supabase, userId)).catch(() => 'UTC');
    const nowByThread = await latestByThread(supabase, userId, ((data ?? []) as Array<Record<string, any>>)
      .map((it) => (it.source_data?.thread_id as string) || '').filter(Boolean));
    for (const it of (data ?? []) as Array<Record<string, any>>) {
      const sd = it.source_data ?? {};
      // Resolution status rides the line (L2): a handled/dismissed item must read as SETTLED — so the
      // synthesis can see "he already dealt with this" instead of re-arguing it as open.
      // D2 (work-surface): a dismissal's USER NOTE is the strongest line here — the user told the
      // brain something it didn't know ("we'll discuss it Thursday"); the synthesis reasons WITH it.
      const note = typeof sd.dismiss_note === 'string' && sd.dismiss_note.trim() ? ` — user: "${sd.dismiss_note.trim()}"` : '';
      const res = it.status === 'completed' ? ' (handled)' : it.status === 'dismissed' ? ` (dismissed${note})` : '';
      // PROJECTION FLOOR (P7a): the line carries a CONTENT gist + an attachment note, not just the
      // subject — a title-only ledger made the brain confidently wrong about what an email contained
      // (the "no catalog yet" class). Every ledger consumer (state synthesis, entity ask, the
      // conversation loop's grounding) inherits this.
      // W37 · the gist is the message's OWN words (quoted history off), a line spoken to an assistant
      // removed (UNTRUSTED INPUT IS DATA), at a width that keeps a figure with its target.
      const gist = clipForPrompt(annotateMessageDays(withoutMachineAddressed(topMessageOf(String(sd.body || '')) || String(sd.body || '')), sd.received_at ?? it.created_at ?? null, ledgerTz).replace(/\s+/g, ' ').trim(), LEDGER_GIST_CHARS);
      const atts = Array.isArray(sd.attachments) ? (sd.attachments as Array<{ filename?: string }>).map((a) => a.filename).filter(Boolean) : [];
      totalEmails++;
      if (isAutomatedSender((sd.from_address as string) || null, (sd.from_name as string) || null, (sd.subject as string) || '')) automatedEmails++;
      else humanCounterparty = true;
      const nowLine = (() => {
        const n = sd.thread_id ? nowByThread.get(String(sd.thread_id)) : null;
        if (!n || !n.at || n.at <= String(sd.received_at ?? it.created_at ?? '').slice(0, 10)) return '';
        // ONE AUTHOR for the clause (Sep 8) — the clippers locate it by the same marker.
        return nowClause(n);
      })();
      ledger.push({
        at: sd.received_at ?? it.created_at ?? '', kind: 'email', who: sd.from_name ?? sd.from_address ?? null,
        text: `${String(it.work_title || sd.subject || '')}${res}${gist ? ` — "${gist}"` : ''}${atts.length ? ` [attached: ${atts.slice(0, 3).join(', ')}]` : ''}${nowLine}`,
        ref: `inbox:${it.id}`,
      });
    }
  }
  const mtgIds = byKind.get('meeting') ?? [];
  if (mtgIds.length) {
    const { data } = await supabase.from('meeting_transcripts').select('id, title, start_time').in('id', mtgIds.slice(0, 40));
    for (const m of (data ?? []) as Array<Record<string, any>>) ledger.push({ at: m.start_time ?? '', kind: 'meeting', who: null, text: String(m.title || 'Meeting'), ref: `meeting:${m.id}` });
  }
  const cIds = byKind.get('commitment') ?? [];
  if (cIds.length) {
    const { data } = await supabase.from('commitments').select('id, description, counterparty, direction, due_date, created_at, status, resolved_reason').in('id', cIds.slice(0, 60));
    // D2: a HUMAN resolved_reason (not one of the machine stamps) is the user's own context — surface it.
    // 'fulfilled' + 'expired' added Sep 13 (THE PROACTIVE REACH ARC): both are machine stamps —
    // rendering either as `— user: "expired"` quoted a stamp as the user's own words.
    const MACHINE_REASONS = new Set(['user_marked', 'user_dismissed', 'replied', 'chat', 'consolidated', 'completed', 'dismissed', 'fulfilled', 'expired', 'workflow_deleted']);
    for (const c of (data ?? []) as Array<Record<string, any>>) {
      const owes = String(c.direction || 'you_owe') === 'awaiting' ? 'they owe' : 'you owe';
      if (c.counterparty) humanCounterparty = true;
      // EVIDENCE SETTLES (W3.1): 'evidence:<type>' is a machine stamp too — never quoted as the user's words.
      const rr = typeof c.resolved_reason === 'string' && c.resolved_reason.trim() && !MACHINE_REASONS.has(c.resolved_reason.trim()) && !c.resolved_reason.trim().startsWith('evidence:') ? ` — user: "${c.resolved_reason.trim()}"` : '';
      // LAW 6 (experience spec — found live Aug 2): a SETTLED obligation must never speak in
      // open-debt grammar. "you owe (done): … (due <today>)" led with the debt and a bare
      // due-today date — the synthesis followed the grammar and re-asserted a delivered report
      // as owed. Settled lines lead with DONE and put the date in the past tense.
      const isSettled = c.status === 'done' || c.status === 'dismissed';
      const text = isSettled
        ? `DONE — ${c.status === 'dismissed' ? `dismissed${rr}` : 'delivered/handled'}: ${c.description}${c.due_date ? ` (was due ${withWeekday(c.due_date)})` : ''}`
        : `${owes}: ${c.description}${c.due_date ? ` (due ${withWeekday(c.due_date)})` : ''}`;
      ledger.push({ at: c.created_at ?? '', kind: 'commitment', who: c.counterparty ?? null, text, ref: `commit:${c.id}` });
    }
  }
  // COWORKER DELIVERABLES (Prepared-Work C3): what the team produced for this entity's items — the deal's
  // brain SEES prepared work ("a proposal was drafted"), so state/next-move reason with it. Deliverables
  // hang off items (kind+entity_id = the item id), so we join through the entity's linked item ids.
  const itemIds = [...inboxIds.slice(0, 60), ...cIds.slice(0, 40)];
  if (itemIds.length) {
    try {
      const { data } = await supabase.from('item_deliverables').select('entity_id, title, type, created_at, metadata')
        .eq('user_id', userId).in('entity_id', itemIds).order('created_at', { ascending: false }).limit(12);
      for (const d of (data ?? []) as Array<Record<string, any>>) {
        ledger.push({ at: d.created_at ?? '', kind: 'commitment', who: (d.metadata?.agentName as string) ?? (d.metadata?.worker as string) ?? 'team', text: `team prepared: ${String(d.title || d.type || 'deliverable')}`, ref: `deliv:${d.entity_id}` });
      }
    } catch { /* pre-migration / non-fatal */ }
  }
  const calIds = byKind.get('calendar_event') ?? [];
  if (calIds.length) {
    const { data } = await supabase.from('calendar_events').select('id, title, start_time').in('id', calIds.slice(0, 40));
    const nowIso = new Date().toISOString();
    for (const e of (data ?? []) as Array<Record<string, any>>) ledger.push({ at: e.start_time ?? '', kind: 'meeting', who: null, text: `${(e.start_time ?? '') > nowIso ? 'Upcoming meeting' : 'Meeting'}: ${e.title || ''}`, ref: `event:${e.id}` });
  }
  ledger.sort((a, b) => (b.at || '').localeCompare(a.at || ''));
  const nowMs = Date.now();
  const past = ledger.filter((l) => l.at && new Date(l.at).getTime() <= nowMs);
  const quietDays = past.length ? Math.max(0, daysBetween(past[0].at, nowMs)) : null;
  // CONTENT-HASH sig (L2) — the old `length:newest-at` was DEAF to user actions: resolving an item adds no
  // line and moves no timestamp, so the brain literally could not notice a dismissal/completion. Hashing
  // the line texts (which now carry resolution status) makes any status flip count as change.
  let h = 0; for (const l of ledger) { const s = `${l.at}|${l.text}`; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; }
  const sig = `${ledger.length}:${h}`;
  // Structural facts (P1) — derived from the same rows, deliberately OUTSIDE the sig (they add no
  // information the ledger hash doesn't already cover).
  const counts: Record<string, number> = {};
  for (const l of ledger) counts[l.kind] = (counts[l.kind] ?? 0) + 1;
  const datedMs = ledger.filter((l) => l.at).map((l) => new Date(l.at).getTime()).filter((n) => !Number.isNaN(n));
  const spanDays = datedMs.length >= 2 ? Math.round((Math.max(...datedMs) - Math.min(...datedMs)) / 86400000) : 0;
  const activeDays = new Set(ledger.filter((l) => l.at).map((l) => String(l.at).slice(0, 10))).size;
  const facts: LedgerFacts = { counts, spanDays, activeDays, automatedEmails, totalEmails, humanCounterparty };
  return { ledger: ledger.slice(0, 28), sig, quietDays, facts };
}

/** Sig-gated synthesis of ONE entity's state + next move + reasoned priority. */
export async function refreshEntityState(supabase: SupabaseClient, userId: string, entityId: string, opts: { force?: boolean } = {}): Promise<void> {
  try {
    const { data: ent } = await supabase.from('work_entities')
      .select('id, name, summary, aliases, sig, tracked').eq('id', entityId).eq('user_id', userId).maybeSingle();
    if (!ent) return;
    const { ledger, sig: ledgerSig, quietDays, facts } = await assembleLedger(supabase, userId, entityId);
    if (!ledger.length) {
      // SELF-HEAL: an active initiative with NO ledger and NO members is registry pollution — a
      // born-empty row (or one emptied outside reconcile). Archive it here (the same rule reconcile
      // applies on membership moves) so it can't sit in the portfolio/recall/snapshot forever.
      // THE PINNING LAW (July 29, found live): a TRACKED entity is a human decision — a user-created
      // project awaiting its work is NOT a ghost. The machine never auto-archives it, at any door.
      const { count } = await supabase.from('entity_links').select('*', { count: 'exact', head: true })
        .eq('user_id', userId).eq('entity_id', entityId);
      if (!count && !ent.tracked) {
        await supabase.from('work_entities').update({ status: 'archived' }).eq('id', entityId).eq('user_id', userId)
          .then(() => {}, () => {});
      }
      return;
    }
    // T-class EVENT-BOUNDARY invalidation: the ledger hash is content-only — time passing changes
    // nothing in it, which is how "prep session locked for tomorrow" survived the meeting itself.
    // The count of this entity's calendar events already in the PAST rides the sig: every time an
    // event boundary crosses, the state re-synthesizes once (never a daily re-burn for all).
    let pastEvents = 0;
    try {
      const { data: evLinks } = await supabase.from('entity_links').select('item_id')
        .eq('user_id', userId).eq('entity_id', entityId).eq('item_kind', 'calendar_event').limit(100);
      const evIds = ((evLinks ?? []) as Array<{ item_id: string }>).map((l) => l.item_id);
      if (evIds.length) {
        const { count } = await supabase.from('calendar_events').select('id', { count: 'exact', head: true })
          .in('id', evIds).lt('start_time', new Date().toISOString());
        pastEvents = count ?? 0;
      }
    } catch { /* boundary detection is an enhancement */ }
    // THE ONE-CLAIM LAW (Aug 13, found live — the Stratto contradiction): the state prose once
    // declared "no reply needed yet" while the item's judged verdict said a reply was owed, and
    // NOTHING could force a re-read (two caches, one page). The judge is AUTHORITATIVE for what's
    // owed; the state describes position and must never contradict a standing verdict. The
    // verdict digest rides the sig, so a verdict flip re-synthesizes the state.
    let verdictFacts: string[] = [];
    let verdictDigest = '';
    try {
      const { data: links } = await supabase.from('entity_links').select('item_id, item_kind')
        .eq('user_id', userId).eq('entity_id', entityId).in('item_kind', ['inbox_item', 'commitment']).limit(30);
      const keys = ((links ?? []) as Array<{ item_id: string; item_kind: string }>)
        .map((l) => `${l.item_kind === 'inbox_item' ? 'inbox' : 'commitment'}:${l.item_id}`);
      if (keys.length) {
        const { data: js } = asRawResult(await readPlans(supabase, userId, 'judgment', { keys }));
        const pairs: string[] = [];
        for (const j of (js ?? []) as Array<{ entity_id: string; tasks: unknown }>) {
          const v = (j.tasks as { verdict?: { work?: string; reason?: string } } | null)?.verdict;
          if (!v?.work) continue;
          pairs.push(`${j.entity_id}:${v.work}`);
          if (v.work !== 'none' && verdictFacts.length < 6) {
            verdictFacts.push(`- an open item here is judged "${v.work}"${v.reason ? ` (${String(v.reason).slice(0, 110)})` : ''}`);
          }
        }
        pairs.sort();
        let vh = 0; const vs = pairs.join('|');
        for (let i = 0; i < vs.length; i++) vh = (vh * 31 + vs.charCodeAt(i)) | 0;
        verdictDigest = pairs.length ? `:j${vh}` : '';
      }
    } catch { /* verdict facts are an enhancement — the ledger still grounds */ }
    const sig = `v${STATE_PROMPT_VERSION}:${ledgerSig}:ev${pastEvents}${verdictDigest}`;
    if (!opts.force && ent.sig === sig) return; // unchanged ledger + verdicts + no event boundary → no AI

    const userName = await getUserName(supabase, userId);
    // W37 · THE THREADS' OWN WORDS — the same sections the room page carries (one grounding, never a fork).
    let threadWords = '';
    let groundRule = '';
    try {
      const { assembleRoomGrounding } = await import('@/lib/room/grounding');
      const { GROUND_EVIDENCE_RULE } = await import('@/lib/room/ground-evidence');
      const g = await assembleRoomGrounding(supabase, userId, { kind: 'entity', entityId });
      groundRule = GROUND_EVIDENCE_RULE;
      threadWords = pickPageSections(g?.text ?? '', ['FIGURES ON RECORD', 'THE THREADS THEMSELVES', 'THE LEDGER NOW']);
    } catch { /* the ledger still grounds */ }
    // THE WATERMARK SURVIVES THE CLIP (Sep 8): a plain 200-char cut removed the trailing NOW clause
    // from exactly the longest lines — the synthesis then re-argued a settled thread as open.
    const { clipLedgerLine } = await import('@/lib/inbox/thread-now');
    const lines = ledger.map((l, i) => `[#${i + 1}] ${withWeekday(l.at)} · ${l.kind}${l.who ? ` · ${l.who}` : ''}: ${clipLedgerLine(l.text, LEDGER_GIST_CHARS + 120)}`).join('\n');
    const prompt =
      `You are the user's chief of staff, keeping the live picture of ONE body of work — it can be anything ` +
      `bounded: a deal, a program, a hire, an operation, a personal matter. No funnel assumptions. From its ` +
      `event ledger, write where it stands, pick the single next move, and judge its priority.\n\n` +
      (userName ? `The owner is ${userName} — address them as "you", never by name.\n` : '') +
      // THE DEIXIS LAW (T-class): this prose is CACHED and re-read for days — a relative day-word
      // decays into a lie, and anything already behind today's date is the PAST, not a plan.
      `TODAY is ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}. The next days: ${dayStrip(new Date(), null, 14)}. This text will be read for DAYS — never write relative day-words ("tomorrow", "next week", "later today"): name absolute dates ("Jul 28"). Anything in the ledger dated BEFORE today already HAPPENED — describe it as past ("they met Jul 28"), never as upcoming.\n` +
      // EXCERPT-HONESTY (Aug 4): the ledger's quoted gists are clipped by US for length.
      `${EXCERPT_RULE} Never describe a message or document as truncated/cut-off/incomplete based on a clipped quote.\n` +
      // THE SETTLED LINE IS HISTORY (Sep 8, found live — root cause C1 of the room that kept
      // asking): this pass ran AFTER the resolutions, read "(handled)" and a NOW clause naming the
      // user as the last speaker, and STILL wrote whoOwes.you / blocking / next_move demanding the
      // very deed that had just been done — then froze, because the sig matched from then on. The
      // rule was here; it named only the marker and only the word "owed", so the model routed the
      // demand through the OTHER three fields. Now it names the fields, and the watermark.
      `A ledger line marked DONE / (handled) / (dismissed) — or whose "${'— NOW ('}…)" clause says THE USER spoke last on that thread — is HISTORY: the obligation is settled and has left the user's hands. NEVER present it as owed, due, or pending, whatever its original due date says, and it may NOT appear in "whoOwes.you", in "blocking", or as the "next_move" — not in other words, not as a follow-up on the same deed.\n` +
      `BEFORE you write each whoOwes.you item, each blocking phrase and the next_move, find the ledger line it comes from and check that line: if it is settled by the test above, DROP the candidate. A thread where the user spoke last is not a debt you may restate — even when their own message only promised the thing, it has left their hands and you cannot see what they did outside this ledger. Anything you still claim as owed must come from an UNSETTLED line — a line where the counterparty spoke last, or an open commitment — and you must speak that line's own matter. If everything is settled, say so plainly, put nothing in whoOwes.you, and return next_move kind "none" (the calm is earned).\n` +
      (verdictFacts.length
        ? `THE JUDGE'S STANDING VERDICTS (authoritative for what's owed — your prose must NEVER contradict them: never write "no reply needed", "you're all set", "nothing owed" while a verdict below says work is owed; describe the position, leave the obligation claim to the verdict):\n${verdictFacts.join('\n')}\n`
        : '') +
      `Body of work: ${ent.name}${ent.summary ? ` — ${ent.summary}` : ''}\n` +
      `Days since last real touch: ${quietDays ?? 'unknown'}\n` +
      `STRUCTURAL FACTS (these CONSTRAIN your scope judgment):\n` +
      `- members: ${Object.entries(facts.counts).map(([k, n]) => `${n} ${k}`).join(', ') || 'none'}\n` +
      `- activity span: ${facts.spanDays} days (${facts.activeDays} distinct days)\n` +
      `- automated senders: ${facts.automatedEmails}/${facts.totalEmails} emails\n` +
      `- human counterparty present: ${facts.humanCounterparty ? 'yes' : 'no'}\n\n` +
      `Event ledger (most recent first — ALL you know; never invent beyond it):\n${lines}\n\n` +
      (threadWords ? `${clipForPrompt(threadWords, 7000)}\n${groundRule}\n\n` : '') +
      `VOICE — this text renders on the user's cards and briefs; write like a sharp colleague, not a system:\n` +
      `- Speak about the MATTER: the people, the thing being done, what just happened, what's genuinely next. Plain words.\n` +
      `- NEVER describe this system's own bookkeeping or internal status: no "prepared for nudge", "draft ready", ` +
      `"no completion signal", any talk of "signals", "communication overdue", "awaiting deliverables", "pending confirmation", ` +
      `"documentation deliverables" — that register is banned. A ledger line like "team prepared: X" is OUR ` +
      `machinery: reason with it, but the summary talks about the deal, never about us or our drafts.\n` +
      `- "summary": 1-2 short sentences, <=30 words, concrete and current — what you'd say if asked "where's ` +
      `this at?" over coffee. Name the real person or thing driving it. NO semicolon chains, NO status-report telegrams.\n` +
      `- whoOwes entries: short human phrases as a colleague would say them ("send them your pricing", "their signed contract").\n` +
      `${NARRATION_TRUTH_RULES}\n\n` +
      `Return ONLY JSON:\n` +
      `{"summary":"1-2 sentences, <=30 words, colleague voice",` +
      `"momentum":"active|needs_you|waiting|gone_quiet|stalled",` +
      `"whoOwes":{"you":["short items YOU owe"],"them":["short items OTHERS owe you"]},` +
      `"stage":"<=4 words in its own terms, or null",` +
      `"blocking":"<=12 words if something concrete blocks it, else null",` +
      `"scope":"project|errand|background",` +
      `"next_move":{"kind":"reply|send|followup|none","title":"<=10 words, an imperative you could act on as-is","reason":"<=15 words why now","covers":["#N refs of ledger items this move RESOLVES"]},` +
      `"priority":{"weight":0-100,"reason":"<=12 words"}}\n` +
      `priority calibration — judge against a busy person's whole day: 80+ = drop-everything (a major matter ` +
      `needs you now / hard deadline); 50-79 = important active matter; 20-49 = routine upkeep; <20 = background ` +
      `noise/awareness. Judge by stakes IN THE LEDGER (who's waiting, money, deadlines, momentum) — never inflate.\n` +
      `scope — PROJECTHOOD, the judgment that decides whether this earns a slot in the user's portfolio:\n` +
      `- "project" = an ongoing body of work: multiple touches over time, a human counterparty/team, an ` +
      `objective that outlives any single action (a deal, a program, a hire, an engagement).\n` +
      `- "errand" = real but SELF-CONTAINED: one action (or a short exchange) closes it — a bill, a security ` +
      `alert, a single ask, a delivery problem, a one-off intro. Real work, but not a slot in their head.\n` +
      `- "background" = automated/administrative hum with no genuine action for the user.\n` +
      `HARD CONSTRAINTS from the facts: all-automated senders with NO human counterparty can NEVER be ` +
      `"project". A single email with no follow-on is not a "project". When genuinely unsure between ` +
      `project and errand, choose "errand" — the user can always promote it, but a portfolio full of ` +
      `non-projects destroys trust.\n` +
      `next_move — honest: "none" when nothing is owed (do NOT invent a move).\n` +
      `next_move.covers — the ARBITER: list the [#N] refs of OPEN ledger items whose whole point IS this ` +
      `move (the email asking for it, the commitment promising it) — doing the move settles them. Items ` +
      `merely related but with their OWN distinct ask are NOT covered. Empty when unsure.`;

    type StateJson = {
      summary?: string; momentum?: string; whoOwes?: { you?: string[]; them?: string[] }; stage?: string | null; blocking?: string | null;
      scope?: string;
      next_move?: { kind?: string; title?: string; reason?: string; covers?: unknown[] }; priority?: { weight?: number; reason?: string };
    };
    // W37 · THE STATE THINKS FIRST (eval narrate.state: at the param floor the fast model broke the rules it
    // was given — a missed target "on track", a scheduled delivery as a debt, one of two budgets chosen). A
    // short reasoning budget on the call; the sig gate keeps it to one call per ledger change.
    const res = await aiCall<StateJson>({ userId, supabase, shape: { output: 'json', effort: STATE_EFFORT }, prompt, temperature: 0, maxTokens: 1400, source: 'brain_synthesis' });
    let p = res.json ?? {};
    // W37 · AN UNPARSEABLE STATE IS RETRIED, NEVER SILENT (eval EU: the thinking budget left a cut JSON): one
    // retry at the param floor before last-good stands.
    if (!p.summary && String(res.text ?? '').trim()) {
      const again = await aiCall<StateJson>({ userId, supabase, shape: { output: 'json' }, prompt, temperature: 0, maxTokens: 1400, source: 'brain_synthesis' });
      if (again.json?.summary) p = again.json;
    }
    if (!p.summary) { console.warn('[state] synthesis returned no summary (likely truncation) — state left as-is', String(res.text ?? '').slice(0, 160)); return; }
    // SELF-CORRECTION: temp-0 can repeat a banned phrase verbatim even when the prompt names it. One
    // corrective retry quoting the violation; if it persists, keep the retry's output (the smoke gate
    // reports any systemic leak). Costs one extra call ONLY on a violation — rare.
    if (MACHINERY_REGISTER.test(String(p.summary))) {
      const bad = String(p.summary).match(MACHINERY_REGISTER)?.[0] ?? '';
      const retry = await aiCall<StateJson>({
        userId, supabase, shape: { output: 'json' }, temperature: 0.4, maxTokens: 900, source: 'brain_synthesis',
        prompt: prompt + `\n\nYOUR PREVIOUS DRAFT used the banned system-register phrase "${bad}" in the summary. Rewrite the WHOLE JSON with the summary in plain colleague speech about the matter — no bookkeeping/status-register words at all.`,
      });
      if (retry.json?.summary) p = retry.json;
    }
    // THE SUMMARY OBEYS THE SAME ARBITER (fidelity run, Sep 8: the demand fields came out clean and
    // the prose still trailed "Awaiting meeting link send"). A sentence cannot be surgically edited
    // by code without mangling it, so the deed here is the file's OWN corrective-retry idiom: name
    // the offending clause and ask for the whole JSON again. One extra call ONLY on a violation.
    const { GENERIC_WORK_WORDS } = await import('@/lib/entities/recognize');
    const settledDemand = (claim: string) => restatesSettledWork(claim, ledger, GENERIC_WORK_WORDS);
    // ONE SPLIT for both halves (detect + strip): the boundaries keep their own punctuation, so a
    // removed clause leaves readable prose behind.
    const CLAUSES = /(?<=[.,;:])\s+|\s+—\s+/;
    const settledClause = (s: string): string | null =>
      String(s ?? '').split(CLAUSES).find((c) => settledDemand(c)) ?? null;
    const badClause = settledClause(String(p.summary ?? ''));
    if (badClause) {
      const retry = await aiCall<StateJson>({
        userId, supabase, shape: { output: 'json' }, temperature: 0.3, maxTokens: 900, source: 'brain_synthesis',
        prompt: prompt + `\n\nYOUR PREVIOUS DRAFT wrote "${badClause}" — that work belongs to a SETTLED ledger line (marked handled/dismissed/DONE, or one where THE USER spoke last). Rewrite the WHOLE JSON without it: describe the position as it stands now, and claim as owed only what an UNSETTLED line supports.`,
      });
      if (retry.json?.summary && !settledClause(String(retry.json.summary))) p = retry.json;
      else if (p.summary) {
        // THE LAST WORD IS CODE'S (proven necessary on the live room: the retry re-issued the same
        // trailing claim). A clause is separable — the split points ARE sentence boundaries — so the
        // offending clause is REMOVED and the rest of the position stands. Never blanks a summary:
        // if nothing would survive, the model's prose is kept (a room without a position is worse
        // than a room with a stale sentence, and the demand fields below are already clean).
        const kept = String(p.summary).split(CLAUSES).filter((c) => !settledDemand(c));
        if (kept.length) {
          const mended = kept.join(' ').replace(/\s+/g, ' ').replace(/[\s,;:]+$/, '').trim();
          if (mended) p = { ...p, summary: /[.!?]$/.test(mended) ? mended : `${mended}.` };
        }
      }
    }

    const mo = ['active', 'needs_you', 'waiting', 'gone_quiet', 'stalled'].includes(p.momentum as string) ? p.momentum : 'active';
    // Category is owned by the GROUNDED classifier (scripts/backfill-entity-category.ts — domain-aware),
    // NOT this ledger-only pass. PRESERVE the existing grounded value so a state refresh never overwrites it.
    let priorCategory: EntityState['category'] | undefined;
    try { const { data: cur } = await supabase.from('work_entities').select('state').eq('id', entityId).maybeSingle(); priorCategory = ((cur?.state ?? null) as { category?: EntityState['category'] } | null)?.category; } catch { /* non-fatal */ }
    // SCOPE — validated; the structural constraint is enforced in CODE too (a fact can't be argued
    // with): no human counterparty + majority-automated mail can never judge "project". Missing/invalid
    // scope falls back to a conservative structural read.
    let scope = (['project', 'errand', 'background'].includes(p.scope as string) ? p.scope : null) as EntityState['scope'] | null;
    if (!scope) {
      scope = facts.humanCounterparty && (Object.keys(facts.counts).length >= 2 || facts.spanDays >= 7) ? 'project' : 'errand';
    }
    if (scope === 'project' && !facts.humanCounterparty && facts.totalEmails > 0 && facts.automatedEmails >= facts.totalEmails) {
      scope = 'errand';
    }
    // A SETTLED LINE CANNOT FOUND A DEMAND — the code half. Runs on the model's own output, over
    // the same ledger it read: a demand belonging to a settled line is dropped before it is stored.
    const owedYou = (p.whoOwes?.you ?? []).slice(0, 5).map(String).filter((c) => !settledDemand(c));
    const blockingRaw = p.blocking ? String(p.blocking).slice(0, 120) : null;
    const state: EntityState = {
      summary: String(p.summary).slice(0, 200), momentum: mo as EntityState['momentum'],
      category: priorCategory,
      scope,
      whoOwes: { you: owedYou, them: (p.whoOwes?.them ?? []).slice(0, 5).map(String) },
      stage: p.stage ? String(p.stage).slice(0, 40) : null,
      blocking: blockingRaw && !settledDemand(blockingRaw) ? blockingRaw : null,
    };
    let nextMove: EntityNextMove | null = null;
    const nm = p.next_move;
    // …and the MOVE obeys the same arbiter: the one action a room pins may never be a settled deed.
    if (nm?.kind && ['reply', 'send', 'followup'].includes(nm.kind) && nm.title && !settledDemand(String(nm.title))) {
      const latestInbound = ledger.find((l) => l.kind === 'email')?.ref ?? null;
      // covers: "#N" citations → ledger refs. Only refs that actually exist survive (grounded-or-absent).
      const covers = (Array.isArray((nm as { covers?: unknown }).covers) ? ((nm as { covers?: unknown[] }).covers ?? []) : [])
        .map((c) => { const i = parseInt(String(c).replace(/\D/g, ''), 10) - 1; return ledger[i]?.ref ?? null; })
        // Only FOLDABLE members (emails/commitments — the rows the deck arbitrates). A calendar event or
        // team deliverable is context the move may cite, but nothing downstream folds it.
        .filter((r): r is string => !!r && (r.startsWith('inbox:') || r.startsWith('commit:'))).slice(0, 12);
      nextMove = { kind: nm.kind as EntityNextMove['kind'], title: String(nm.title).slice(0, 120), reason: String(nm.reason || '').slice(0, 140), entityRef: latestInbound, ...(covers.length ? { covers } : {}) };
    }
    // W19.A · THE SUMMARY IS NOT A SECOND TRUTH, at the source: the SAME serve floor runs over what
    // is about to be stored (acronym-aware, settled-distinctive — the gap the arbiter above left), and
    // the compose-time time belt writes exact relative words ("nine days overdue") as dates. The
    // stored state is then as clean as the serve; readers outside the grounding inherit it on the
    // next recompose (entityStateStale marks a state older than its ledger for exactly that).
    {
      const composedAt = new Date().toISOString();
      // (composedAt = now: the time half is a no-op on the composition day — the belt below writes dates)
      const floored = serveEntityState({ ...state, composedAt }, { ledger, entityName: String(ent.name ?? ''), generic: GENERIC_WORK_WORDS, nextMove: nextMove?.title ?? null });
      const belt = (x: string | null) => (x ? absolutizeTimeWords(x, {}).text : x);
      state.summary = belt(floored.summary) ?? state.summary;
      state.blocking = belt(floored.blocking);
      state.stage = floored.stage;
      state.whoOwes = { you: floored.whoOwesYou.map((x) => belt(x) ?? x), them: floored.whoOwesThem.map((x) => belt(x) ?? x) };
      if (nextMove && !floored.nextMove) nextMove = null;
      state.composedAt = composedAt;
      if (floored.dropped.length) console.log(`[state] W19.A floor dropped ${floored.dropped.length} settled claim(s) before storing (${entityId.slice(0, 8)})`);
    }
    const priority: EntityPriority = {
      weight: Math.max(0, Math.min(100, Math.round(Number(p.priority?.weight ?? 20)))),
      reason: String(p.priority?.reason || '').slice(0, 100),
    };
    await supabase.from('work_entities').update({
      state, next_move: nextMove, priority, sig,
      last_event_at: ledger[0]?.at || new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq('id', entityId).eq('user_id', userId);
  } catch { /* non-fatal */ }
}

/** Batch refresh (sig-gated per entity — unchanged ones cost nothing). */
export async function refreshEntityStates(supabase: SupabaseClient, userId: string, entityIds?: string[]): Promise<void> {
  let ids = entityIds;
  if (!ids) {
    const { data } = await supabase.from('work_entities').select('id').eq('user_id', userId).eq('kind', 'initiative').eq('status', 'active').limit(300);
    ids = (data ?? []).map((r) => r.id as string);
  }
  const CH = 4;
  for (let i = 0; i < ids.length; i += CH) {
    await Promise.all(ids.slice(i, i + CH).map((id) => refreshEntityState(supabase, userId, id)));
  }
}
