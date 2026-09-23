// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE CONTEXT BUDGET (W2.7 — invariant 13, EXCERPT HONESTY by structure). The excerpt law decayed
// three times as a LIST OF SITES: every new assembler re-invented its own `.slice(0, N)`, and a raw
// slice cannot declare itself. Worse, a raw slice over a CONCATENATION cuts whatever happens to sit
// last — the calendar tool appended its FREE SLOTS after the event detail, so on a busy week the
// verified slots (the whole point of the call) were the first thing the budget ate, silently.
//
// `packContext` is the ONE place a prompt assembler spends a character budget over several blocks:
//   · every block has a PRIORITY — lower priority shrinks first, higher priority survives longest;
//   · a shrink is a clipForPrompt cut (boundary + declared EXCERPT_MARK), or a head-cut that keeps
//     the tail (`keepTail`) and declares itself at the front — never a silent chop;
//   · STRICT PRIORITY: a block never shrinks below its `minChars` floor; past that it DROPS, and
//     only then does the next block up yield — each drop leaves a declared line ("[… omitted for
//     length by this system — N chars]");
//   · document order is preserved whatever the priorities;
//   · when any excerpt mark is present, EXCERPT_RULE rides at the end — inside the budget, so no
//     caller-side cut can strip it.
// Pure and deterministic — unit-tested in tests/unit/pack-context.test.ts.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { clipForPrompt, EXCERPT_MARK, EXCERPT_RULE } from '@/lib/utils/clip-for-prompt';

export type ContextSection = {
  /** Stable key for the report (and the drop line when no `label` is given). */
  id: string;
  text: string;
  /** Higher survives longer. Ties: the LATER block yields first. */
  priority: number;
  /** Never shrink below this many chars (a floor, not a drop shield). Default: a block may shrink
   *  until a cut is no longer meaningful, then it drops. */
  minChars?: number;
  /** Keep the END of the block when it must shrink (a log whose newest lines are last). */
  keepTail?: boolean;
  /** What the drop line calls this block (defaults to the id). */
  label?: string;
  /** The joiner placed BEFORE this block (defaults to the pack's separator) — lets one pack hold
   *  both blank-line-separated blocks and line-per-row blocks (a calendar's day lines). */
  glue?: string;
};

export type SectionStatus = 'kept' | 'clipped' | 'dropped';
export type PackReport = Record<string, { status: SectionStatus; originalChars: number; keptChars: number }>;
export type PackResult = { text: string; report: PackReport; marked: boolean };

export type PackOptions = {
  /** Joiner between blocks. Default a blank line. */
  separator?: string;
  /** Append EXCERPT_RULE when a mark is present (default true). */
  rule?: boolean;
};

/** A cut shorter than this carries no meaning — the block drops instead (declared). */
const MIN_USEFUL = 60;
const MARK_COST = EXCERPT_MARK.length + 1;

/** A single prompt-bound cut that carries its own rule: clipForPrompt, plus EXCERPT_RULE on a
 *  header line ABOVE the text when anything was removed (a later tail-cut can never strip it). */
export function clipWithRule(text: string, max: number): string {
  const c = clipForPrompt(text, max);
  return c.includes(EXCERPT_MARK) ? `(${EXCERPT_RULE})\n${c}` : c;
}

/** Keep the tail: cut from the FRONT at a line/sentence/word boundary and declare it up front. */
export function clipTailForPrompt(text: string, max: number): string {
  const t = String(text ?? '').trim();
  if (t.length <= max) return t;
  let cut = t.slice(t.length - max);
  const line = cut.indexOf('\n');
  const sentence = Math.min(...['. ', '! ', '? '].map((s) => { const i = cut.indexOf(s); return i < 0 ? Infinity : i + 1; }));
  if (line >= 0 && line < max * 0.4) cut = cut.slice(line + 1);
  else if (sentence < max * 0.5) cut = cut.slice(sentence);
  else {
    const word = cut.indexOf(' ');
    if (word >= 0 && word < max * 0.4) cut = cut.slice(word + 1);
  }
  return `${EXCERPT_MARK} ${cut.trim()}`;
}

/** Shrink one block to at most `max` chars INCLUDING its mark. Null = no meaningful cut fits. */
function shrink(s: ContextSection & { text: string }, max: number): string | null {
  if (s.text.length <= max) return s.text;
  const room = max - MARK_COST;
  if (room < MIN_USEFUL) return null;
  return s.keepTail ? clipTailForPrompt(s.text, room) : clipForPrompt(s.text, room);
}

export function packContext(sections: ContextSection[], budgetChars: number, opts: PackOptions = {}): PackResult {
  const sep = opts.separator ?? '\n\n';
  const withRule = opts.rule !== false;
  const report: PackReport = {};
  const live = sections
    .map((s, i) => ({ ...s, text: String(s.text ?? '').trim(), i }))
    .filter((s) => {
      if (s.text) return true;
      report[s.id] = { status: 'kept', originalChars: 0, keptChars: 0 };
      return false;
    });

  // cur: null = dropped; otherwise the text currently standing for the block.
  const cur = new Map<number, string | null>(live.map((s) => [s.i, s.text]));

  const assemble = (): string => {
    const out: Array<{ glue: string; text: string }> = [];
    let run: typeof live = [];
    const flush = () => {
      if (!run.length) return;
      const n = run.reduce((a, s) => a + s.text.length, 0);
      const names = run.map((s) => s.label ?? s.id).join(', ');
      out.push({ glue: run[0].glue ?? sep, text: `[${names} omitted for length by this system — ${n} chars not shown; never treat this as the whole picture]` });
      run = [];
    };
    for (const s of live) {
      const t = cur.get(s.i);
      if (t === null) { run.push(s); continue; }
      flush();
      out.push({ glue: s.glue ?? sep, text: t as string });
    }
    flush();
    const body = out.map((o, k) => (k ? o.glue : '') + o.text).join('');
    return withRule && body.includes(EXCERPT_MARK) ? `${body}${sep}${EXCERPT_RULE}` : body;
  };

  let text = assemble();
  if (text.length > budgetChars) {
    // Room the rule may need once a cut happens — reserved up front so it never pushes us over.
    const avail = () => budgetChars - (withRule ? sep.length + EXCERPT_RULE.length : 0);
    const bodyLen = () => { const t = assemble(); return withRule && t.endsWith(EXCERPT_RULE) ? t.length - sep.length - EXCERPT_RULE.length : t.length; };
    const yieldOrder = [...live].sort((a, b) => a.priority - b.priority || b.i - a.i);

    // PHASES 1+2 — STRICT PRIORITY: the lowest block yields first — it shrinks to its floor and,
    // if the page still overruns, it DROPS (declared) before any higher block loses a character.
    for (const s of yieldOrder) {
      const over = bodyLen() - avail();
      if (over <= 0) break;
      const now = cur.get(s.i) as string;
      const floor = Math.min(s.minChars ?? 0, s.text.length);
      const target = Math.max(floor, now.length - over);
      if (target < now.length) {
        const next = shrink(s, target);
        if (next !== null && next.length < now.length) cur.set(s.i, next);
      }
      if (bodyLen() - avail() > 0) cur.set(s.i, null);
    }
    text = assemble();
    // The last resort (only a budget smaller than the drop lines themselves): one honest cut.
    if (text.length > budgetChars) {
      const room = Math.max(MIN_USEFUL, avail() - MARK_COST);
      const body = clipForPrompt(text, room);
      text = withRule && body.includes(EXCERPT_MARK) ? `${body}${sep}${EXCERPT_RULE}` : body;
    }
  }

  for (const s of live) {
    const t = cur.get(s.i);
    report[s.id] = t === null
      ? { status: 'dropped', originalChars: s.text.length, keptChars: 0 }
      : { status: t === s.text ? 'kept' : 'clipped', originalChars: s.text.length, keptChars: (t as string).length };
  }
  return { text, report, marked: text.includes(EXCERPT_MARK) };
}
