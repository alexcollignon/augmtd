// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE EVIDENCE-SETTLES BACKFILL (stabilization W7.1 HEARTBEAT THROUGHPUT · invariant 7). GUARDED.
//
// One pass of THE SAME per-account evidence settle the commitments sweep runs
// (lib/work/evidence-sweep.ts runEvidenceSweep → settleWorkByEvidence: undoable, activity-logged,
// narrated, `evidence:<type>` stamped at the evidence's own time) over EVERY open commitment and
// actionable inbox item — once, with the per-run fresh caps LIFTED (the backlog the law-version
// bump + the cache-hit-counting caps left behind). Evidence-only: LAW 2's expiry lane is not run.
//
//   DRY RUN (default)   — read-only: per account, what the nominator hands the judge, split by tier
//                         (never judged under the current law · evidence moved · cache hit — free),
//                         and the estimated spend (fresh judgments × the classification-tier cost).
//                         ZERO writes, ZERO AI.
//   --apply --all       — every account the sweep owes a pass.
//   --apply --user <id> — one account.
//   --concurrency N     — accounts in flight at once (default 2, max 4); each account's own settles
//                         run at the sweep's EVIDENCE_CONCURRENCY.
//   --budget-min N      — per-account wall clock (default 20); anything unreached is COUNTED.
// Each applied account takes THE SAME exactly-once claim as the cron's job (lane 'evidence') — a
// backfill and a live sweep never judge one account at the same time; a lost claim is reported.
//
// Run: npx tsx scripts/backfill-evidence-settles.ts [--user <id>] [--apply --all | --apply --user <id>]
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { planUserEvidence, runEvidenceSweep, evidenceSweepUsers } from '../lib/work/evidence-sweep';
import { claimSweepJob } from '../lib/work/sweep-fanout';

/** The classification-tier cost per fulfillment judgment (€, same estimate the W3.1 census used). */
export const EST_EUR_PER_JUDGMENT = 0.003;

const argv = process.argv.slice(2);
const flag = (f: string) => argv.includes(f);
const val = (f: string): string | null => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null; };
const APPLY = flag('--apply');
const ALL = flag('--all');
const USER = val('--user');
const CONCURRENCY = Math.max(1, Math.min(4, Number(val('--concurrency') ?? 2) || 2));
const BUDGET_MS = Math.max(1, Number(val('--budget-min') ?? 20) || 20) * 60_000;

async function main() {
  // W11.2: a DRY RUN writes nothing — not even the working circle's recomputed inference cache.
  if (!APPLY) { const { setCirclePersistence } = await import('../lib/evidence/circle'); setCirclePersistence(false); }
  if (APPLY && !ALL && !USER) {
    console.error('REFUSED: --apply needs an explicit scope — --all or --user <id>. (Dry run needs neither.)');
    process.exit(2);
  }
  if (APPLY && ALL && USER) {
    console.error('REFUSED: --all and --user are exclusive.');
    process.exit(2);
  }
  if (USER && !/^[0-9a-f-]{36}$/i.test(USER)) { console.error('REFUSED: --user must be a uuid.'); process.exit(2); }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.error('no Supabase env'); process.exit(2); }
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const users = USER ? [USER] : (await evidenceSweepUsers(sb)).sort();
  console.log(`${APPLY ? 'APPLY' : 'DRY RUN (read-only — no writes, no AI)'} · ${users.length} account(s)${APPLY ? ` · concurrency ${CONCURRENCY} · budget ${BUDGET_MS / 60_000}min/account` : ''}\n`);

  if (!APPLY) {
    const tot = { cOpen: 0, iOpen: 0, cNom: 0, iNom: 0, t0: 0, t1: 0, t2: 0, capped: 0 };
    const rows: string[] = [];
    for (const uid of users) {
      const plan = await planUserEvidence(sb, uid);
      if (!plan.openCommitments && !plan.openInbox) continue;
      const cN = plan.queue.filter((e) => e.kind === 'commitment').length;
      const iN = plan.queue.length - cN;
      const t = [0, 0, 0];
      for (const e of plan.queue) t[e.tier]++;
      tot.cOpen += plan.openCommitments; tot.iOpen += plan.openInbox; tot.cNom += cN; tot.iNom += iN;
      tot.t0 += t[0]; tot.t1 += t[1]; tot.t2 += t[2]; if (plan.pool?.capped) tot.capped++;
      rows.push(`  ${uid.slice(0, 8)}  commitments ${cN}/${plan.openCommitments} · inbox ${iN}/${plan.openInbox} nominated  ·  `
        + `fresh ${t[0] + t[1]} (never-under-law ${t[0]}, moved ${t[1]}) · cache ${t[2]}  ·  pool e-scoped ${plan.pool?.scopedEmails ?? 0} + newest ${plan.pool?.newestEmails ?? 0}${plan.pool?.capped ? ' (CAPPED)' : ''}`
        + `  ·  ≈ €${((t[0] + t[1]) * EST_EUR_PER_JUDGMENT).toFixed(2)}`);
    }
    rows.forEach((r) => console.log(r));
    const fresh = tot.t0 + tot.t1;
    console.log(`\n  TOTAL  nominated: commitments ${tot.cNom}/${tot.cOpen} · inbox ${tot.iNom}/${tot.iOpen}`);
    console.log(`  TOTAL  would spend ${fresh} fresh judgment(s) (never judged under the current law ${tot.t0} · evidence moved ${tot.t1}); ${tot.t2} cache hit(s) re-apply free`);
    console.log(`  TOTAL  estimated cost ≈ €${(fresh * EST_EUR_PER_JUDGMENT).toFixed(2)} (classification tier, ~€${EST_EUR_PER_JUDGMENT}/judgment)${tot.capped ? ` · ${tot.capped} account pool(s) hit the scoped ceiling` : ''}`);
    console.log('\n  (dry run — re-run with --apply --all or --apply --user <id> to settle)');
    return;
  }

  const queue = [...users];
  const sum = { accounts: 0, claimedElsewhere: 0, nominated: 0, fresh: 0, cached: 0, closed: 0, leftBehind: 0, failed: 0 };
  const worker = async () => {
    for (;;) {
      const uid = queue.shift();
      if (!uid) return;
      try {
        if (!await claimSweepJob(sb, uid, 'evidence')) { sum.claimedElsewhere++; console.log(`  ${uid.slice(0, 8)}  skipped — a sweep holds this account's claim (re-run after the window)`); continue; }
        const r = await runEvidenceSweep(sb, uid, {
          budgetMs: BUDGET_MS, expiry: false,
          freshCaps: { commitment: Number.POSITIVE_INFINITY, inbox: Number.POSITIVE_INFINITY },
        });
        sum.accounts++;
        sum.nominated += r.commitments.nominated + r.inbox.nominated;
        sum.fresh += r.commitments.fresh + r.inbox.fresh;
        sum.cached += r.commitments.cached + r.inbox.cached;
        sum.closed += r.commitments.closed + r.inbox.closed;
        sum.leftBehind += r.leftBehind;
        console.log(`  ${uid.slice(0, 8)}  nominated ${r.commitments.nominated + r.inbox.nominated} · fresh ${r.commitments.fresh + r.inbox.fresh} · cache ${r.commitments.cached + r.inbox.cached} · settled ${r.commitments.closed + r.inbox.closed} · left ${r.leftBehind} · ${Math.round(r.elapsedMs / 1000)}s`);
      } catch (e) { sum.failed++; console.error(`  ${uid.slice(0, 8)}  failed:`, e instanceof Error ? e.message : e); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, users.length || 1) }, worker));
  console.log(`\n  DONE  accounts ${sum.accounts} (claimed elsewhere ${sum.claimedElsewhere}, failed ${sum.failed}) · nominated ${sum.nominated} · fresh ${sum.fresh} · cache ${sum.cached} · SETTLED ${sum.closed} (undoable — Activity) · left behind ${sum.leftBehind}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
