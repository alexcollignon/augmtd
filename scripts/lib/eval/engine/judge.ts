// ════════════════════════════════════════════════════════════════════════════════════════════════
// W26 — THE BLIND JUDGE (generic rubric) + the tolerant JSON readers every column's answer shares.
// The judge sees ONE answer, the case's truth sheet and the rubric — never which column wrote it,
// never a product name. Inputs ride clipped under the excerpt law. A reply with no readable scores is
// retried once by the runner (a JSON-only nudge); a second failure is reported as UNSCORED.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { clipForPrompt, EXCERPT_MARK, EXCERPT_RULE } from '../../../../lib/utils/clip-for-prompt';
import { jsonObjects, lenientParse } from '../home-chat-harness';
import type { RubricDim, RubricVerdict } from './types';

export const JUDGE_SYSTEM =
  'You are a strict evaluator of work produced for a busy professional. You grade ONE answer against a truth sheet, hard conditions and a rubric. ' +
  'First reason step by step about the answer against the truth sheet and each hard condition; only then score. ' +
  'Score each dimension 1-5 using its anchors. Judge only what is written. Do not reward length. Reply with JSON only.';

export const JUDGE_ANSWER_CHARS = 9_000;
export const JUDGE_SOURCE_CHARS = 14_000;

/** THE GENERIC RUBRIC JUDGE (eval guidance: detailed rubric, hard pass/fail conditions, REASON FIRST
 *  then score — the reasoning is read and discarded; only scores + hard fails are kept). */
export function buildRubricPrompt(a: { title: string; task: string; truthSheet: string; source?: string | null; dims: RubricDim[]; hardConditions?: string[]; answer: string; notes?: string[] }): { system: string; user: string } {
  const src = a.source ? clipForPrompt(a.source, JUDGE_SOURCE_CHARS) : '';
  const ans = clipForPrompt(a.answer || '(no output — nothing was served)', JUDGE_ANSWER_CHARS);
  const clipped = src.includes(EXCERPT_MARK) || ans.includes(EXCERPT_MARK);
  const hard = a.hardConditions ?? [];
  const anchors = (d: RubricDim) => d.anchors ? ` [1 = ${d.anchors[1] ?? 'failed'}; 3 = ${d.anchors[3] ?? 'acceptable with clear flaws'}; 5 = ${d.anchors[5] ?? 'exemplary'}]` : '';
  const user =
    `CASE: ${a.title}\n\nTHE TASK THE ANSWER WAS FOR:\n${a.task}\n\n` +
    `TRUTH SHEET (what is true about this case; anything contradicting it is wrong, anything beyond it is unsupported):\n${a.truthSheet}\n\n` +
    (src ? `SOURCE MATERIAL (the raw records):\n${src}\n\n` : '') +
    (hard.length ? `HARD CONDITIONS (violating ANY one fails the answer outright, whatever else it does well):\n${hard.map((h, i) => `${i + 1}. ${h}`).join('\n')}\n\n` : '') +
    `RUBRIC (score each 1-5):\n${a.dims.map((d) => `- ${d.id}: ${d.label} — ${d.gloss}${anchors(d)}`).join('\n')}\n\n` +
    (a.notes?.length ? `NOTES:\n${a.notes.map((n) => `- ${n}`).join('\n')}\n\n` : '') +
    `THE ANSWER:\n${ans}\n\n` + (clipped ? `(${EXCERPT_RULE})\n\n` : '') +
    `Return ONLY one JSON object, no code fence, with the reasoning FIRST: ` +
    `{"reasoning":"<your step-by-step check against the truth sheet and each hard condition>","hard_fails":[<numbers of violated hard conditions, [] if none>],"scores":{${a.dims.map((d) => `"${d.id}":<integer 1-5>`).join(',')}},"failures":["<short quote or concrete failure, max 3>"],"notes":"<one sentence>"}. ` +
    `Inside strings use single quotes for any quotation.`;
  return { system: JUDGE_SYSTEM, user };
}

export function parseRubric(raw: string, dimIds: string[]): Pick<RubricVerdict, 'scores' | 'notes' | 'failures' | 'hardFails'> & { error?: string } {
  const body = String(raw ?? '').replace(/```(?:json)?/gi, '');
  const cands = jsonObjects(body).filter((c) => /"scores"/.test(c));
  const byRegex = (text: string) => {
    const scores: Record<string, number | null> = {};
    let hits = 0;
    for (const d of dimIds) {
      const m = new RegExp(`"${d}"\\s*:\\s*(null|\\d(?:\\.\\d+)?)`).exec(text);
      if (m) { hits++; scores[d] = m[1] === 'null' ? null : clamp(Number(m[1])); }
    }
    return hits ? scores : null;
  };
  const hardOf = (text: string): string[] => {
    const m = /"hard_fails"\s*:\s*\[([^\]]*)\]/.exec(text);
    return m ? [...m[1].matchAll(/\d+/g)].map((x) => x[0]) : [];
  };
  if (!cands.length) {
    const rx = byRegex(body);
    if (rx) return { scores: rx, notes: '(scores recovered from a malformed judge reply)', failures: [], hardFails: hardOf(body) };
    return { scores: {}, notes: '', failures: [], error: `judge returned no JSON${body.trim() ? `: ${body.trim().slice(0, 120)}` : ' (empty reply)'}` };
  }
  const last = cands[cands.length - 1];
  try {
    // The reasoning is read by the judge for itself and DISCARDED here — only scores + hard fails count.
    const j = lenientParse(last) as { scores?: Record<string, unknown>; notes?: unknown; failures?: unknown; hard_fails?: unknown };
    const scores: Record<string, number | null> = {};
    for (const d of dimIds) {
      const v = j.scores?.[d];
      scores[d] = typeof v === 'number' && Number.isFinite(v) ? clamp(v) : null;
    }
    if (dimIds.every((d) => scores[d] == null)) return { scores, notes: '', failures: [], error: 'judge JSON carried no applicable score' };
    const failures = Array.isArray(j.failures) ? j.failures.filter((f): f is string => typeof f === 'string').slice(0, 3) : [];
    const hardFails = Array.isArray(j.hard_fails) ? j.hard_fails.map((x) => String(x)).filter((x) => /^\d+$/.test(x)) : [];
    return { scores, notes: typeof j.notes === 'string' ? j.notes : '', failures, hardFails };
  } catch (e) {
    const rx = byRegex(last);
    if (rx) return { scores: rx, notes: '(scores recovered from a malformed judge reply)', failures: [], hardFails: hardOf(last) };
    return { scores: {}, notes: '', failures: [], error: `judge JSON unparseable: ${(e as Error).message}` };
  }
}

const clamp = (v: number) => Math.max(1, Math.min(5, Math.round(v)));

/** Tolerant JSON for a plain column's labelled answer: the LAST balanced object in the text
 *  (fences, preamble, trailing commas tolerated). null = unparseable → scored as wrong. */
export function parseAnswerJSON(text: string): Record<string, unknown> | null {
  const body = String(text ?? '').replace(/```(?:json)?/gi, '');
  const cands = jsonObjects(body);
  for (let i = cands.length - 1; i >= 0; i--) {
    try {
      const v = lenientParse(cands[i]);
      if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
    } catch { /* try the previous object */ }
  }
  return null;
}

export const RETRY_NUDGE = 'Your previous reply could not be read as JSON. Reply again with ONLY the JSON object — no prose, no code fence.';
