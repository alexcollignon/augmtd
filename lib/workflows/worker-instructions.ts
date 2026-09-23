// ═══ WORKER INSTRUCTIONS = METHOD + FEEDBACK (W2.4 THE MEMORY LADDER, Sep 22) ══════════════════
//
// `workflows.worker_instructions` used to be ONE string that room feedback appended to and a
// tail cap (`slice(-4000)`) trimmed — so once dated STANDING FEEDBACK accumulated, the AUTHORED
// METHOD at the head was what got cut. The method is the user's standing word; feedback is
// commentary on it. They are two things with two lifetimes:
//
//   method      — the authored instructions. NEVER truncated, never folded.
//   feedback[]  — dated STANDING FEEDBACK entries. Capped by COUNT and AGE; the oldest fold into
//                 ONE summary line (zero-AI) so nothing is lost silently and the method stays whole.
//
// STORAGE (no migration): the rendered string stays THE home — the column every reader already
// consumes (run-workflow → executeAIStep's [TASK INSTRUCTIONS] block, the Studio editor, clone,
// worker-tasks). The structure is a DERIVATION of that string (parse) and the string is a
// derivation of the structure (render) — one fact, one home, round-trip stable. The legacy
// appended format (`\n\nSTANDING FEEDBACK (YYYY-MM-DD): …`) parses as-is, so existing rows need
// no repair and a reader that predates this module sees exactly what it always saw.

export const FEEDBACK_MARK = 'STANDING FEEDBACK';
export const FEEDBACK_MAX_ENTRIES = 8;
export const FEEDBACK_MAX_AGE_DAYS = 180;
export const FEEDBACK_ENTRY_CHARS = 400;
export const FEEDBACK_FOLD_CHARS = 600;

export type FeedbackEntry = { day: string; text: string };
export type WorkerInstructions = {
  method: string;
  feedback: FeedbackEntry[];
  /** The folded summary of feedback that aged out — one line, oldest first. */
  folded: string | null;
};

const ENTRY_RE = /\n*STANDING FEEDBACK \((\d{4}-\d{2}-\d{2})\):[ \t]*/g;
const FOLD_PREFIX = 'STANDING FEEDBACK (earlier, folded): ';

export function parseWorkerInstructions(raw: string | null | undefined): WorkerInstructions {
  const s = String(raw ?? '').replace(/\r\n/g, '\n');
  const parts: Array<{ day: string; start: number; end: number }> = [];
  for (const m of s.matchAll(ENTRY_RE)) parts.push({ day: m[1], start: m.index ?? 0, end: (m.index ?? 0) + m[0].length });
  const foldIdx = s.indexOf(FOLD_PREFIX);
  const firstCut = Math.min(...[parts[0]?.start, foldIdx >= 0 ? foldIdx : undefined].filter((n): n is number => typeof n === 'number'), s.length);
  const method = s.slice(0, firstCut).trim();
  let folded: string | null = null;
  if (foldIdx >= 0) {
    const foldEnd = parts.find((p) => p.start > foldIdx)?.start ?? s.length;
    folded = s.slice(foldIdx + FOLD_PREFIX.length, foldEnd).trim() || null;
  }
  const feedback: FeedbackEntry[] = parts.map((p, i) => {
    const next = parts[i + 1]?.start ?? s.length;
    return { day: p.day, text: s.slice(p.end, next).trim() };
  }).filter((e) => e.text);
  return { method, feedback, folded };
}

export function renderWorkerInstructions(wi: WorkerInstructions): string {
  const lines: string[] = [];
  if (wi.method.trim()) lines.push(wi.method.trim());
  if (wi.folded?.trim()) lines.push(`${FOLD_PREFIX}${wi.folded.trim()}`);
  for (const e of wi.feedback) lines.push(`${FEEDBACK_MARK} (${e.day}): ${e.text.trim()}`);
  return lines.join('\n\n').trim();
}

function daysBetween(a: string, b: string): number {
  const ta = Date.parse(`${a}T00:00:00Z`); const tb = Date.parse(`${b}T00:00:00Z`);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return 0;
  return Math.round((tb - ta) / 86_400_000);
}

/** Fold feedback that aged out (older than FEEDBACK_MAX_AGE_DAYS) or overflowed the count into the
 *  one summary line — oldest first, the newest entries stay verbatim. The method is untouched. */
export function foldFeedback(wi: WorkerInstructions, today: string): WorkerInstructions {
  const sorted = [...wi.feedback].sort((a, b) => a.day.localeCompare(b.day));
  const fresh = sorted.filter((e) => daysBetween(e.day, today) <= FEEDBACK_MAX_AGE_DAYS);
  const aged = sorted.filter((e) => daysBetween(e.day, today) > FEEDBACK_MAX_AGE_DAYS);
  const overflow = fresh.length > FEEDBACK_MAX_ENTRIES ? fresh.slice(0, fresh.length - FEEDBACK_MAX_ENTRIES) : [];
  const keep = fresh.slice(overflow.length);
  const toFold = [...aged, ...overflow];
  if (!toFold.length) return { ...wi, feedback: keep };
  const joined = [wi.folded, ...toFold.map((e) => `${e.text} (${e.day})`)].filter(Boolean).join(' · ');
  // The fold is already a summary: when it overflows, its OLDEST part goes (the newest folded
  // feedback is the most likely still to matter).
  const folded = joined.length > FEEDBACK_FOLD_CHARS ? `… ${joined.slice(joined.length - FEEDBACK_FOLD_CHARS)}` : joined;
  return { method: wi.method, feedback: keep, folded };
}

/** The steer door's one operation: parse → append the dated entry → fold → render. */
export function addStandingFeedback(
  raw: string | null | undefined, instruction: string, day: string,
): { rendered: string; parsed: WorkerInstructions } {
  const wi = parseWorkerInstructions(raw);
  const text = String(instruction ?? '').replace(/\s+/g, ' ').trim().slice(0, FEEDBACK_ENTRY_CHARS);
  if (text) wi.feedback.push({ day, text });
  const parsed = foldFeedback(wi, day);
  return { rendered: renderWorkerInstructions(parsed), parsed };
}
