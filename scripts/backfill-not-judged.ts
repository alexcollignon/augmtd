// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE NOT-JUDGED BACKFILL (stabilization W8.6 — the heartbeat drains "Not yet judged"). GUARDED.
//
// One pass of THE SAME not-judged lane the judgment sweep runs every two hours
// (lib/work/judgment-sweep.ts `runNotJudgedLane`: the kind floor FIRST at zero AI cost, then open
// rows newest first, then past-dated rows; the EXISTING judge + the ONE consequence door), over
// EVERY account — including accounts the active-user rotation never reached (the June–July meeting
// action items) — with a stated per-account `--limit` instead of the cron's per-run cap.
//
//   DRY RUN (default)   — read-only: per account, the lane's population split by what it costs
//                         (kind-floor disposals: zero AI · open · past-dated · past-due commitments
//                         LAW 2's expiry lane owns), and an AI COST ESTIMATE (AI-possible judgments ×
//                         the classification-tier cost). ZERO writes (the client is wrapped: every
//                         write a read path would make — a day cache — is suppressed and counted),
//                         ZERO AI.
//   --apply --all       — every account.
//   --apply --user <id> — one account (uuid).
//   --limit N           — AI-possible judgments per account in this pass (default: the cron's
//                         NOT_JUDGED_CAP_PER_RUN); the zero-cost floor disposals are not limited by it.
//   --budget-min N      — per-account wall clock (default 10); anything unreached is COUNTED.
// Each applied account takes THE SAME exactly-once claim as the cron's judgment job — a backfill and
// a live sweep never judge one account at the same time; a lost claim is reported, never forced.
//
// Run: npx tsx scripts/backfill-not-judged.ts [--user <id>] [--apply --all | --apply --user <id>] [--limit N]
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { collectNotJudged, planNotJudgedLane, runNotJudgedLane, NOT_JUDGED_CAP_PER_RUN } from '../lib/work/judgment-sweep';
import { claimSweepJob } from '../lib/work/sweep-fanout';

/** The classification-tier cost per judgment (€ — the same estimate the W3.1/W7.1 censuses used). */
export const EST_EUR_PER_JUDGMENT = 0.003;

const argv = process.argv.slice(2);
const flag = (f: string) => argv.includes(f);
const val = (f: string): string | null => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null; };
const APPLY = flag('--apply');
const ALL = flag('--all');
const USER = val('--user');
const LIMIT = Math.max(1, Number(val('--limit') ?? NOT_JUDGED_CAP_PER_RUN) || NOT_JUDGED_CAP_PER_RUN);
const BUDGET_MS = Math.max(1, Number(val('--budget-min') ?? 10) || 10) * 60_000;

/** A READ-ONLY view of the client: every write verb becomes a counted no-op (the dry run's floor). */
function readOnly(sb: SupabaseClient, counter: { suppressed: number }): SupabaseClient {
  const noop: unknown = new Proxy(function () { /* chainable no-op */ }, {
    get: (_t, p) => (p === 'then'
      ? (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res)
      : () => noop),
    apply: () => noop,
  });
  return new Proxy(sb, {
    get(target, prop, recv) {
      if (prop !== 'from') return Reflect.get(target, prop, recv);
      return (table: string) => {
        const q = target.from(table);
        return new Proxy(q, {
          get(qt, qp, qr) {
            if (qp === 'insert' || qp === 'upsert' || qp === 'update' || qp === 'delete') {
              return () => { counter.suppressed++; return noop; };
            }
            const v = Reflect.get(qt, qp, qr);
            return typeof v === 'function' ? v.bind(qt) : v;
          },
        });
      };
    },
  }) as SupabaseClient;
}

/** Every account id, paged (no silent cap at the first page of auth users). */
async function allUserIds(sb: SupabaseClient): Promise<string[]> {
  const ids: string[] = [];
  for (let page = 1; page < 100; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`could not list users: ${error.message}`);
    ids.push(...data.users.map((u) => u.id));
    if (data.users.length < 1000) break;
  }
  return ids.sort();
}

async function main() {
  if (APPLY && !ALL && !USER) { console.error('REFUSED: --apply needs an explicit scope — --all or --user <id>. (Dry run needs neither.)'); process.exit(2); }
  if (ALL && USER) { console.error('REFUSED: --all and --user are exclusive.'); process.exit(2); }
  if (USER && !/^[0-9a-f-]{36}$/i.test(USER)) { console.error('REFUSED: --user must be a uuid.'); process.exit(2); }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.error('no Supabase env'); process.exit(2); }
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const today = new Date().toISOString().slice(0, 10);

  const users = USER ? [USER] : await allUserIds(sb);
  console.log(`${APPLY ? 'APPLY' : 'DRY RUN (read-only — no writes, no AI)'} · ${users.length} account(s) · limit ${LIMIT} AI-possible judgment(s)/account${APPLY ? ` · budget ${BUDGET_MS / 60_000}min/account` : ''}\n`);

  if (!APPLY) {
    const counter = { suppressed: 0 };
    const ro = readOnly(sb, counter);
    const tot = { accounts: 0, population: 0, floored: 0, open: 0, passed: 0, neverJudged: 0, stale: 0, expiryOwned: 0, aiAll: 0, aiLimited: 0, failed: 0 };
    for (const uid of users) {
      let rows;
      try {
        // One key, one row (a held row can also be a never-judged spine candidate) — the census counts unique rows.
        const seen = new Set<string>();
        rows = (await collectNotJudged(ro, uid)).filter((r) => (seen.has(r.key) ? false : (seen.add(r.key), true)));
      }
      catch (e) { tot.failed++; console.log(`  ${uid.slice(0, 8)}  could not be read (${e instanceof Error ? e.message : 'error'}) — counted, not guessed`); continue; }
      // The WHOLE population (no caps) for the census; the limited plan for this pass's estimate.
      const whole = planNotJudgedLane(rows, { todayISO: today, cap: Number.MAX_SAFE_INTEGER, floorCap: Number.MAX_SAFE_INTEGER });
      if (!whole.population) continue;
      const limited = planNotJudgedLane(rows, { todayISO: today, cap: LIMIT, floorCap: Number.MAX_SAFE_INTEGER });
      const never = rows.filter((r) => r.neverJudged).length;
      tot.accounts++; tot.population += whole.population; tot.floored += whole.floored.length;
      tot.open += whole.open.length; tot.passed += whole.passed.length; tot.expiryOwned += whole.expiryOwned;
      tot.neverJudged += never; tot.stale += rows.length - never;
      tot.aiAll += whole.aiPossible; tot.aiLimited += limited.aiPossible;
      const commits = rows.filter((r) => r.kind === 'commitment').length;
      console.log(`  ${uid.slice(0, 8)}  population ${whole.population} (never judged ${never} · stale-version ${rows.length - never} · commitments ${commits})`
        + `  ·  kind-floor ${whole.floored.length} (zero AI) · open ${whole.open.length} · past-dated ${whole.passed.length} · expiry-owned ${whole.expiryOwned}`
        + `  ·  this pass ${limited.aiPossible} AI-possible ≈ €${(limited.aiPossible * EST_EUR_PER_JUDGMENT).toFixed(2)}`
        + (limited.leftBehind ? ` · ${limited.leftBehind} left for the cron` : ''));
    }
    console.log(`\n  TOTAL  ${tot.accounts} account(s) with unjudged rows · population ${tot.population} (never judged ${tot.neverJudged} · stale-version ${tot.stale})`);
    console.log(`  TOTAL  kind-floor disposals ${tot.floored} (zero AI) · open ${tot.open} · past-dated ${tot.passed} · past-due commitments left to LAW 2's expiry lane ${tot.expiryOwned}`);
    console.log(`  TOTAL  AI COST ESTIMATE — this pass (--limit ${LIMIT}/account): ${tot.aiLimited} judgment(s) ≈ €${(tot.aiLimited * EST_EUR_PER_JUDGMENT).toFixed(2)}`
      + ` · the whole backlog: ${tot.aiAll} judgment(s) ≈ €${(tot.aiAll * EST_EUR_PER_JUDGMENT).toFixed(2)} (upper bound: classification tier, ~€${EST_EUR_PER_JUDGMENT}/judgment; a same-day cache hit costs nothing)`);
    if (tot.failed) console.log(`  TOTAL  ${tot.failed} account(s) could not be read — counted, not estimated`);
    console.log(`  (dry run — ${counter.suppressed} read-path cache write(s) suppressed, 0 written. Re-run with --apply --all or --apply --user <id> [--limit N] to judge.)`);
    return;
  }

  const tot = { accounts: 0, visited: 0, fresh: 0, cached: 0, failed: 0, resolved: 0, leftBehind: 0, lostClaim: 0 };
  for (const uid of users) {
    if (!await claimSweepJob(sb, uid, 'judgment')) { tot.lostClaim++; console.log(`  ${uid.slice(0, 8)}  claim held by a live sweep this window — skipped, reported`); continue; }
    const r = await runNotJudgedLane(sb, uid, {
      deadlineMs: Date.now() + BUDGET_MS, todayISO: today, cap: LIMIT, floorCap: Number.MAX_SAFE_INTEGER, apply: true,
    });
    if (!r.population) continue;
    tot.accounts++; tot.visited += r.visited; tot.fresh += r.fresh; tot.cached += r.cached;
    tot.failed += r.failed; tot.resolved += r.resolved; tot.leftBehind += r.leftBehind;
    console.log(`  ${uid.slice(0, 8)}  population ${r.population} · visited ${r.visited} (fresh ${r.fresh} · cached ${r.cached} · failed ${r.failed}) · resolved ${r.resolved} · left ${r.leftBehind}`);
  }
  console.log(`\n  TOTAL  ${tot.accounts} account(s) · visited ${tot.visited} (fresh ${tot.fresh} · cached ${tot.cached} · failed ${tot.failed}) · resolved ${tot.resolved} · left behind ${tot.leftBehind}${tot.lostClaim ? ` · ${tot.lostClaim} claim(s) held by a live sweep` : ''}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
