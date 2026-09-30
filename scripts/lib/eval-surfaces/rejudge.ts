// ════════════════════════════════════════════════════════════════════════════════════════════════
// W28 · RE-JUDGE A SAVED RUN (no regeneration). Every column's saved answers are scored again by the
// current blind judge prompt (the same prompt for every column — fair by construction), and a sample can
// be judged twice to measure the grader's own consistency. The pure parts (the transcript, the score,
// the agreement statistics) are exported for the unit test; the CLI wires the live judge + meter.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { AnyAdapter, ColumnRun, EvalCase } from '../eval/engine/types';
import type { EngineResult } from '../eval/engine/runner';
import { describeSignals } from '../eval/home-chat-harness';

export type JudgeCall = (system: string, user: string, nudge: boolean) => Promise<string>;
export type Verdict = { scores: Record<string, number | null>; hardFails?: string[]; failures: string[]; notes: string; error?: string };

/** The transcript the judge reads for one saved column run (the engine runner's own construction). */
export function transcriptOf(adapter: AnyAdapter, c: EvalCase, run: ColumnRun): Array<{ role: 'user' | 'assistant'; text: string }> {
  const userTurns = adapter.conversation!.plainTurns(c);
  const texts = run.out.turns ?? [run.out.text];
  return userTurns.flatMap((u, i) => (texts[i] != null ? [{ role: 'user' as const, text: u }, { role: 'assistant' as const, text: texts[i] }] : []));
}

/** Score = mean of the applicable dimensions; any hard fail → 1 (the engine's rule). Pure. */
export function scoreOf(v: Verdict, dims: string[]): number | null {
  const xs = dims.map((d) => v.scores[d]).filter((x): x is number => typeof x === 'number');
  if (!xs.length) return null;
  return v.hardFails?.length ? 1 : xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Judge one saved run (one retry on an unreadable reply). */
export async function judgeRun(adapter: AnyAdapter, c: EvalCase, run: ColumnRun, call: JudgeCall): Promise<{ verdict: Verdict; score: number | null }> {
  const tr = transcriptOf(adapter, c, run);
  const notes = (run.out.signals ?? []).map((s) => describeSignals(s));
  const p = adapter.conversation!.judgePrompt!(c, tr, notes, null);
  const dims = adapter.scoring.kind === 'judged' ? adapter.scoring.dims.map((d) => d.id) : [];
  let v: Verdict = { scores: {}, failures: [], notes: '', error: 'not run' };
  for (let attempt = 0; attempt < 2 && v.error; attempt++) {
    try { v = adapter.conversation!.parseVerdict!(await call(p.system, p.user, attempt > 0)) as Verdict; }
    catch (e) { v = { scores: {}, failures: [], notes: '', error: (e as Error).message }; }
  }
  return { verdict: v, score: v.error ? null : scoreOf(v, dims) };
}

/** Agreement between two judgings of the same answers. Pure. */
export function agreement(pairs: Array<[number | null, number | null, boolean, boolean]>): { n: number; exactPct: number; within05Pct: number; meanAbsDiff: number; hardFailAgreePct: number } {
  const ok = pairs.filter(([a, b]) => a != null && b != null) as Array<[number, number, boolean, boolean]>;
  const n = ok.length || 1;
  return {
    n: ok.length,
    exactPct: (100 * ok.filter(([a, b]) => Math.abs(a - b) < 1e-9).length) / n,
    within05Pct: (100 * ok.filter(([a, b]) => Math.abs(a - b) <= 0.5 + 1e-9).length) / n,
    meanAbsDiff: ok.reduce((s, [a, b]) => s + Math.abs(a - b), 0) / n,
    hardFailAgreePct: (100 * ok.filter(([, , ha, hb]) => ha === hb).length) / n,
  };
}

/** Every judgeable saved run of a result: [surface index, case index, column, repeat] (reused copies excluded). */
export function judgeableRuns(result: EngineResult): Array<{ si: number; ci: number; col: string; rep: number }> {
  const out: Array<{ si: number; ci: number; col: string; rep: number }> = [];
  result.surfaces.forEach((s, si) => s.cases.forEach((c, ci) => {
    for (const [col, runs] of Object.entries(c.runs)) (runs ?? []).forEach((r, rep) => {
      if (!r || r.skipped || r.reusedFrom || r.out.error) return;
      out.push({ si, ci, col, rep });
    });
  }));
  return out;
}
