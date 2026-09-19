// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE CATCH-UP RUNNER (docs/attention-plan.md PART III — the instant-help correction, Sep 18).
//
// The graduation and proof-of-life lanes were born as 2-hourly cron slices — correct for steady
// state, WRONG for first experience: a user facing a 4,900-item backlog cannot wait two days of
// sweeps for the ledger to tell the truth (owner: "user can't wait half a day to have things
// properly working"). This runner drives the SAME lanes (one implementation, bigger budget) to
// drain a dirty account NOW. It adds no law of its own: graduation stays zero-AI and undoable;
// proof-of-life stays one-question-per-window through the one judge door.
//
//   npx tsx scripts/catch-up-attention.ts --user <email|uuid-prefix>            # dry: what would drain
//   npx tsx scripts/catch-up-attention.ts --user <email|uuid-prefix> --apply    # drain now
//   flags: --grad-cap 6000 · --pol-cap 120 · --minutes 12 (wall-clock ceiling)
//
// Idempotent: a drained account yields zeros. The cron keeps the account clean afterwards.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { createClient } from '@supabase/supabase-js';
import { runGraduationLane } from '../lib/work/graduation';
import { runJudgmentSweep } from '../lib/work/judgment-sweep';

const APPLY = process.argv.includes('--apply');
const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(k);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const USER = arg('--user', '');
const GRAD_CAP = parseInt(arg('--grad-cap', '6000'), 10);
const POL_CAP = parseInt(arg('--pol-cap', '120'), 10);
const MINUTES = parseInt(arg('--minutes', '12'), 10);

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL; const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.log('! NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing'); process.exit(1); }
  if (!USER) { console.log('Refusing to run unscoped. Pass --user <email|uuid-prefix>.'); process.exit(1); }
  const sb = createClient(url, key);

  const { data: profs } = await sb.from('profiles').select('id, email').or(`email.ilike.${USER}%,id.eq.${/^[0-9a-f-]{36}$/.test(USER) ? USER : '00000000-0000-0000-0000-000000000000'}`);
  const prof = (profs ?? [])[0];
  if (!prof) { console.log(`No user matched "${USER}".`); process.exit(1); }
  console.log(`\nTHE CATCH-UP — ${prof.email} · ${APPLY ? 'APPLY' : 'dry run'} · grad cap ${GRAD_CAP} · pol cap ${POL_CAP} · ${MINUTES}min ceiling`);
  const deadline = Date.now() + MINUTES * 60_000;

  // THE PHASE SPLIT (bug found on the first live drain, Sep 18): graduation ran to the SHARED
  // deadline and left the sweep a 60s budget against an 11-minute proof-of-life slice — the lane's
  // own guard (budget must exceed slice) then skipped it, and "eligible 0" was really "never ran".
  // Each phase now owns its slice of the ceiling: graduation ~55%, the sweep the rest with a floor.
  const gradDeadline = Date.now() + Math.floor(MINUTES * 60_000 * 0.55);

  // 1 · GRADUATION — zero-AI, the bulk of the drain.
  const g = await runGraduationLane(sb as never, prof.id, {
    apply: APPLY, cap: GRAD_CAP, selfEmail: prof.email, deadlineMs: gradDeadline,
  });
  console.log(`graduation: eligible ${g.eligible} · filed ${g.filed} · left ${g.leftBehind} · ${JSON.stringify(g.byClass)}`);

  // 2 · PROOF-OF-LIFE — judged, one question per item per window; driven through the ONE sweep
  // (its own nominator builds the candidates) with the catch-up's widened slice. Dry mode stops
  // here: the sweep's lane always applies, so we only run it under --apply.
  if (APPLY) {
    const sweepBudget = Math.max(3 * 60_000, deadline - Date.now());
    const r = await runJudgmentSweep(sb as never, prof.id, {
      budgetMs: sweepBudget,
      proofOfLifeCap: POL_CAP,
      // The lane's guard needs budget ≥ slice + 15s headroom — leave 45s so it can never self-skip.
      proofSliceMs: Math.max(60_000, sweepBudget - 45_000),
    });
    const p = r.proofOfLife;
    console.log(`proof-of-life: eligible ${p.eligible} · checked ${p.checked} · reaffirmed ${p.reaffirmed} · demoted ${p.demoted} · left ${p.leftBehind}`);
    console.log(`sweep: visited ${r.visited} · fresh ${r.fresh} · resolved ${r.resolved} · graduated ${r.graduated}`);
  } else {
    console.log('proof-of-life: (dry — runs only with --apply, through the one sweep)');
  }

  console.log(APPLY ? '\n✅ drained — the cron keeps it clean from here.' : '\nℹ️  dry — re-run with --apply.');
}
main().catch((e) => { console.error('THREW:', e?.message ?? e); process.exit(1); });
