// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE EXCERPT-HONESTY LAW (Aug 4, found live): every prompt used to hard-cut source text at a
// character count and quote it as the sender's complete words — so a normal email clipped at 400
// chars ended mid-word, and the judge HONESTLY concluded "his email cut off mid-sentence", wrote
// it into the watch-outs, and the room repeated it. The model wasn't hallucinating — we lied to it
// and it believed us.
//
// The law: any code-side cut that feeds a prompt (a) ends at a sentence/word boundary, (b) declares
// itself with an explicit marker, and (c) every consuming prompt carries the rule that the marker
// is OUR clipping — never evidence about the source. Mechanical truncation must never masquerade
// as source truth.
// ════════════════════════════════════════════════════════════════════════════════════════════════

export const EXCERPT_MARK = '[…clipped for length — the original continues]';

/** The one prompt rule every consumer appends near its excerpt(s). */
export const EXCERPT_RULE =
  `Text ending in "${EXCERPT_MARK}" was clipped BY THIS SYSTEM for prompt length — it is NEVER ` +
  `evidence that the source email/document itself was truncated, cut off, or incomplete.`;

/** Clip source text for a prompt: sentence boundary preferred, word boundary otherwise, and an
 *  explicit marker whenever anything was actually removed. Unclipped text passes through clean. */
export function clipForPrompt(text: string, max: number): string {
  const t = String(text ?? '').trim();
  if (t.length <= max) return t;
  let cut = t.slice(0, max);
  const sentence = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '), cut.lastIndexOf('.\n'));
  if (sentence > max * 0.5) cut = cut.slice(0, sentence + 1);
  else {
    const word = cut.lastIndexOf(' ');
    if (word > max * 0.6) cut = cut.slice(0, word);
  }
  return `${cut.trim()} ${EXCERPT_MARK}`;
}

/** A LABEL IS NOT AN EXCERPT (Sep 21, found by the T2 replay). Titles, thread names and the
 *  report-back's `Task: "…"` line are cut for DISPLAY, not for prompt budget — they carry no
 *  marker (chrome inside a title reads as a defect) but they must still end at a word boundary.
 *  A raw `.slice()` here produced `…'Last Week's Highlights' s`, and the coworker composing the
 *  hand-back quoted OUR cut back at the user as evidence that the work had been truncated — the
 *  excerpt-honesty law's own failure mode, arriving through the one seam the law never covered
 *  because it isn't a prompt excerpt. Every label clip goes through here. */
export function clipLabel(text: string, max: number): string {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, Math.max(1, max - 1));
  const word = cut.lastIndexOf(' ');
  const kept = word > max * 0.5 ? cut.slice(0, word) : cut;
  return `${kept.replace(/[\s,;:—–-]+$/, '')}…`;
}
