// W26 — THE SELF-CHECK'S ASSERTIONS (pure): the engine's WIRING, not the product. A stubbed run must
// spend nothing real, leave the probe exactly as it found it, make every AUGMTD run reach its real
// producer (a model call happened — fresh ids defeat every cache), score the good stub 1 and the
// garbage stub lower, and get every judged run scored.
import type { EngineResult } from './runner';

export type SelfCheckScheduling = {
  /** Rows the post-run sweep had to delete (a teardown leak). */
  leaks: string[];
  caps: Record<string, number>;
  /** Peak in-flight model calls per provider (the meter gate). */
  peak: Record<string, number>;
  concurrency: number;
  /** The run went through the stop → resume-from-journal leg. */
  expectResume: boolean;
  /** Column runs the plan executes (tier-free columns once). */
  plannedRuns: number;
  /** THE PROBE POOL: the accounts, the per-account lane width and the fairness check's findings. */
  pool?: { worldLanes: number; unfair: string[]; accounts: Array<{ label: string; tier: string }> };
};

/** The self-check's assertions: the wiring, not the product. */
export function selfCheckProblems(r: EngineResult, residue: string[], blocked: string[], s?: SelfCheckScheduling): string[] {
  const p: string[] = [];
  if (!r.stubbed) p.push('the run was not stubbed');
  if (r.totalCostEur > 0.5) p.push(`stub spend looks real: €${r.totalCostEur.toFixed(4)}`);
  if (residue.length) p.push(`teardown not symmetric: ${residue.join('; ')}`);
  if (blocked.length) p.push(`probe fence refused writes: ${blocked.join('; ')}`);
  if (s) {
    if (s.leaks.length) p.push(`teardown leaked rows the post-run sweep had to delete: ${s.leaks.join(' | ')}`);
    for (const [k, v] of Object.entries(s.peak)) if (v > (s.caps[k] ?? Infinity)) p.push(`provider cap broken: ${k} peaked at ${v} > ${s.caps[k]}`);
    if (s.concurrency > 1 && (r.concurrency?.peakUnits ?? 0) < 2) p.push(`--concurrency ${s.concurrency} but no two units ever overlapped (peak ${r.concurrency?.peakUnits ?? 0})`);
    if (r.stopped) p.push(`the run stopped early (${r.stopped})`);
    if (s.expectResume && !r.resumedRuns) p.push('the resume leg kept no finished run from the journal');
    // Exactly once: every planned column run landed, none twice (a resume must not re-run a finished unit).
    let landed = 0;
    for (const sr of r.surfaces) for (const cr of sr.cases) for (const runs of Object.values(cr.runs)) {
      const own = (runs ?? []).filter((x) => !x.reusedFrom);
      landed += own.length;
      const reps = own.map((x) => x.repeat);
      if (new Set(reps).size !== reps.length) p.push(`${sr.surface}[${sr.tier}] ${cr.caseId}: a repeat landed twice (${reps.join(',')})`);
    }
    if (s.pool) {
      for (const u of s.pool.unfair) p.push(`probe pool unfair: ${u}`);
      const hosts = r.concurrency?.hosts ?? {};
      for (const [label, h] of Object.entries(hosts)) if (h.peakWorlds > s.pool.worldLanes) p.push(`probe pool: ${label} held ${h.peakWorlds} worlds at once > --world-lanes ${s.pool.worldLanes}`);
      // Leasing spreads worlds (least-loaded first): an account may only hold a SECOND world when every
      // account of its tier holds one — so an idle account beside a doubled-up one means leasing broke.
      // (W27.C: the old proxy "enough runs ⇒ every account used" failed on a 4th standard account — the
      // tiers interleave, so ~concurrency/2 standard worlds are ever in flight and #4 is never needed.)
      for (const tier of new Set(s.pool.accounts.map((a) => a.tier))) {
        const labels = s.pool.accounts.filter((a) => a.tier === tier).map((a) => a.label);
        const runs = labels.reduce((n, l) => n + (hosts[l]?.runs ?? 0), 0);
        const idle = labels.filter((l) => !(hosts[l]?.runs));
        const doubled = labels.filter((l) => (hosts[l]?.peakWorlds ?? 0) >= 2);
        if (labels.length > 1 && idle.length && doubled.length) p.push(`probe pool: ${idle.join(', ')} hosted no AUGMTD run while ${doubled.join(', ')} held 2+ worlds at once (${runs} run(s) on tier ${tier}) — leasing broken?`);
      }
    }
    if (landed !== s.plannedRuns) p.push(`exactly-once broken: ${landed} column run(s) landed, ${s.plannedRuns} planned`);
  }
  for (const sr of r.surfaces) {
    if (sr.teardownErrors.length) p.push(`${sr.surface}[${sr.tier}] teardown errors: ${sr.teardownErrors.join('; ')}`);
    if (!sr.cases.length) p.push(`${sr.surface}[${sr.tier}]: no case ran`);
    for (const cr of sr.cases) {
      for (const [col, runs] of Object.entries(cr.runs)) for (const run of runs ?? []) {
        if (run.reusedFrom) continue;
        if (run.out.error) p.push(`${sr.surface}[${sr.tier}] ${cr.caseId} · ${col}: ${run.out.error}`);
        if (col === 'augmtd' && !run.out.error && run.out.calls === 0) p.push(`${sr.surface}[${sr.tier}] ${cr.caseId} · augmtd made NO model call (cache hit or producer short-circuit — fresh ids broken?)`);
        if (col !== 'augmtd' && !run.out.error && run.out.calls === 0) p.push(`${sr.surface}[${sr.tier}] ${cr.caseId} · ${col} made no model call`);
        if (sr.scoring === 'judged' && !run.out.error && run.score == null) p.push(`${sr.surface}[${sr.tier}] ${cr.caseId} · ${col}: unscored by the (stub) judge`);
      }
      if (sr.scoring === 'labelled') {
        const same = cr.runs.same?.[0], gpt = cr.runs.gpt56?.[0];
        if (same && same.score !== 1) p.push(`${sr.surface}[${sr.tier}] ${cr.caseId}: the good stub (same) scored ${same.score} (expected 1 — scorer/parser mismatch: ${(same.label?.fields ?? []).filter((f) => !f.correct).map((f) => `${f.field} ${f.truth}≠${f.pred}`).join(', ')})`);
        if (gpt && gpt.score != null && same && same.score != null && gpt.score >= same.score) p.push(`${sr.surface}[${sr.tier}] ${cr.caseId}: the garbage stub (gpt56) did not score below the good stub`);
      }
    }
  }
  return p;
}
