// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ARITHMETIC FLOOR (Arc 1 stage 2 — docs/one-surface-plan.md: computed numbers, never asserted).
//
// A prepared artifact often MAKES computable claims: "Total: €12,450" above line items, "+18% QoQ
// from 2.1M to 2.4M", "Thursday, Aug 6". Models assert these; code can CHECK them. This module is
// the evaluator's mechanical check channel: ONE cheap extraction pass (gated on number-density,
// skipped for plain prose) proposes checks, then PURE CODE recomputes each one. Two honesty laws:
//   • THE QUOTE LAW (W6 generalized): a check only counts when its VERBATIM quote exists in the
//     artifact — a hallucinated extraction can never trigger a false revise.
//   • FAILURE ≠ A VERDICT: extraction/AI failure returns no mismatches — the floor is an
//     enhancement; it never blocks, never flags on its own outage.
// Only a CODE-CONFIRMED mismatch speaks — and it speaks with the exact numbers.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { SupabaseClient } from '@supabase/supabase-js';

export type ExtractedCheck =
  | { kind: 'arith'; quote: string; op: 'sum' | 'diff' | 'product' | 'ratio' | 'pct_change' | 'pct_of'; operands: number[]; stated: number }
  | { kind: 'weekday'; quote: string; date: string; weekday: string };

export type ClaimMismatch = { quote: string; expected: string; stated: string };

// Weekday names across the languages drafts actually mirror (EN/PT/DE/FR) → JS getUTCDay index.
const WEEKDAYS: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
  domingo: 0, 'segunda-feira': 1, segunda: 1, 'terça-feira': 2, terça: 2, terca: 2, 'quarta-feira': 3, quarta: 3,
  'quinta-feira': 4, quinta: 4, 'sexta-feira': 5, sexta: 5, sábado: 6, sabado: 6,
  sonntag: 0, montag: 1, dienstag: 2, mittwoch: 3, donnerstag: 4, freitag: 5, samstag: 6,
  dimanche: 0, lundi: 1, mardi: 2, mercredi: 3, jeudi: 4, vendredi: 5, samedi: 6,
};
const DAY_NAME = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, ''));

function expectedOf(c: Extract<ExtractedCheck, { kind: 'arith' }>): number | null {
  const o = c.operands;
  if (!o.length || o.some((n) => typeof n !== 'number' || !Number.isFinite(n))) return null;
  switch (c.op) {
    case 'sum': return o.reduce((a, b) => a + b, 0);
    case 'diff': return o.length === 2 ? o[0] - o[1] : null;
    case 'product': return o.reduce((a, b) => a * b, 1);
    case 'ratio': return o.length === 2 && o[1] !== 0 ? o[0] / o[1] : null;
    case 'pct_change': return o.length === 2 && o[0] !== 0 ? ((o[1] - o[0]) / Math.abs(o[0])) * 100 : null;
    case 'pct_of': return o.length === 2 ? (o[0] / 100) * o[1] : null; // o[0]% of o[1]
    default: return null;
  }
}

/** The PURE-CODE half — deterministic, unit-gated. Checks whose quote fails the quote law are
 *  silently ignored (never a mismatch from an unverifiable extraction). */
export function runChecks(content: string, checks: ExtractedCheck[]): ClaimMismatch[] {
  const hay = norm(content);
  // THE OPERAND LAW (found live: the extractor invented an intermediate 3×1,200=3600 not present
  // in the text — right that time, but an invented operand is a false-revise waiting to happen):
  // every operand must itself appear in the artifact as a number. Digit-membership is the check
  // ("1,200" ↔ 1200 across separator styles); a claim beyond the single-op vocabulary drops
  // honestly rather than being verified against guessed intermediates.
  const digitTokens = new Set((content.match(/\d[\d.,]*/g) ?? []).map((t) => t.replace(/[.,]/g, '')));
  const operandInText = (n: number) => digitTokens.has(String(Math.abs(n)).replace(/[.,-]/g, '').replace(/\./g, ''));
  const out: ClaimMismatch[] = [];
  for (const c of checks.slice(0, 6)) {
    const quote = String(c.quote ?? '').trim();
    if (quote.length < 4 || !hay.includes(norm(quote))) continue; // THE QUOTE LAW
    if (c.kind === 'arith') {
      if (!Array.isArray(c.operands) || !c.operands.every((n) => typeof n === 'number' && operandInText(n))) continue;
      const expected = expectedOf(c);
      if (expected === null || typeof c.stated !== 'number' || !Number.isFinite(c.stated)) continue;
      // Tolerance: rounding is honest (14.29% stated as 14.3 or ~14), a wrong number is not.
      const tol = Math.max(0.51, Math.abs(expected) * 0.015);
      if (Math.abs(expected - c.stated) > tol) {
        out.push({ quote: quote.slice(0, 90), expected: fmt(expected), stated: fmt(c.stated) });
      }
    } else if (c.kind === 'weekday') {
      const m = /^\d{4}-\d{2}-\d{2}$/.exec(String(c.date ?? '')) ? new Date(`${c.date}T12:00:00Z`) : null;
      const idx = WEEKDAYS[norm(String(c.weekday ?? ''))];
      if (!m || Number.isNaN(m.getTime()) || idx === undefined) continue;
      if (m.getUTCDay() !== idx) {
        out.push({ quote: quote.slice(0, 90), expected: `${c.date} is a ${DAY_NAME[m.getUTCDay()]}`, stated: String(c.weekday) });
      }
    }
  }
  return out;
}

/** Density gate — plain prose skips the floor entirely (zero cost on the common case). */
export function hasComputableSurface(content: string): boolean {
  const nums = content.match(/\d[\d.,]*\s?%?/g) ?? [];
  const weekdayRe = new RegExp(`\\b(${Object.keys(WEEKDAYS).join('|')})\\b`, 'i');
  return nums.length >= 3 || (weekdayRe.test(content) && /\b\d{1,2}[./-]\d{1,2}|\b\d{4}-\d{2}-\d{2}|\b\d{1,2}\s+(?:jan|feb|fev|mar|apr|abr|mai|may|jun|jul|aug|ago|sep|set|oct|out|nov|dec|dez)/i.test(content));
}

/** The full channel: one cheap reasoned extraction + the code check. Empty on any failure. */
export async function verifyComputableClaims(
  admin: SupabaseClient, userId: string, content: string,
): Promise<ClaimMismatch[]> {
  try {
    if (!hasComputableSurface(content)) return [];
    const { aiCall } = await import('@/lib/ai/call');
    const res = await aiCall<{ checks?: unknown[] }>({
      userId, supabase: admin, shape: { output: 'json' }, temperature: 0, maxTokens: 500,
      source: 'task_preparation',
      prompt:
        `Extract up to 6 claims from the artifact below that are COMPUTABLE from its own text alone:\n` +
        `- arithmetic: a stated total/difference/product/ratio/percentage whose OPERANDS all appear in the text ` +
        `(never bring numbers from outside; never infer unstated operands)\n` +
        `- weekday: a calendar date AND its weekday stated together ("Thursday, Aug 6, 2026" → date 2026-08-06)\n` +
        `STRICT: "quote" is VERBATIM from the artifact and contains the stated result; when unsure, OMIT. ` +
        `An empty list is the normal answer for prose without checkable math.\n\n` +
        `THE ARTIFACT:\n${content.slice(0, 4000)}\n\n` +
        `JSON only: {"checks":[{"kind":"arith","quote":"…","op":"sum|diff|product|ratio|pct_change|pct_of","operands":[1,2],"stated":3}` +
        `,{"kind":"weekday","quote":"…","date":"YYYY-MM-DD","weekday":"thursday"}]}\n` +
        `(pct_change: operands [from,to] → percent change; pct_of: operands [pct,base] → pct% of base; ratio: [a,b] → a/b)`,
    });
    const raw = Array.isArray(res.json?.checks) ? (res.json!.checks as ExtractedCheck[]) : [];
    return runChecks(content, raw);
  } catch { return []; } // the floor is an enhancement — outage speaks no verdict
}
