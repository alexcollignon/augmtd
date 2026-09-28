// ════════════════════════════════════════════════════════════════════════════════════════════════
// W18 · THE CONVERSATION WINDOW — DRY-RUN CENSUS (read-only: SELECTs only, ZERO AI, ZERO writes).
//
// Which open work does THE CONVERSATION ANSWERS (lib/evidence/match.ts, `conversation` in SETTLE_MATCH)
// now nominate that the old matcher did not? For each open commitment / actionable inbox item of an
// account it runs the SAME planner the live sweep runs (lib/work/evidence-sweep.ts planUserEvidence —
// the real loaders, the real pool, the real matcher) and compares the nominated set with the legacy
// options (teammates + every source, no conversation window). It prints counts + ids only (no names,
// no subjects) and the fresh fulfillment judgments the next sweep would spend, with an estimate.
//
// Nothing here closes anything: the live sweep hands these sets to the ONE fulfillment judge, and
// only a judged delivery closes (EVIDENCE SETTLES). There is no --apply — the sweep IS the apply.
//
// Run: npx tsx scripts/census-conversation-window.ts --user <uuid>
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

/** The classification-tier cost per fulfillment judgment (€ — the W3.1/W7.1 census estimate). */
const EST_EUR_PER_JUDGMENT = 0.003;

async function main() {
  const argv = process.argv.slice(2);
  const i = argv.indexOf('--user');
  const USER = i >= 0 ? argv[i + 1] : null;
  if (!USER || !/^[0-9a-f-]{36}$/i.test(USER)) { console.error('usage: --user <uuid>'); process.exit(2); }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.error('no Supabase env'); process.exit(2); }
  const sb = createClient(url, key, { auth: { persistSession: false } });
  // A census writes nothing — not even the working circle's recomputed inference cache.
  const { setCirclePersistence } = await import('../lib/evidence/circle');
  setCirclePersistence(false);

  const { planUserEvidence } = await import('../lib/work/evidence-sweep');
  const { matchEvidence, loadEvidencePool, scopeOf } = await import('../lib/work/evidence-nominator');
  const nowISO = new Date().toISOString();

  const plan = await planUserEvidence(sb as never, USER, nowISO);
  const since = plan.queue.map((q) => q.work.afterISO).filter(Boolean).sort()[0];
  const pool = since ? await loadEvidencePool(sb as never, USER, since, scopeOf(plan.queue.map((q) => q.work))) : { events: [] };
  const LEGACY = { teammates: true, types: 'all' as const };

  type Row = { kind: string; id: string; before: number; after: number; added: number; otherSide: number; fresh: boolean };
  const rows: Row[] = [];
  for (const q of plan.queue) {
    const before = matchEvidence(pool, q.work, nowISO, LEGACY);
    const beforeIds = new Set(before.map((e) => `${e.type}:${e.id}`));
    const added = q.evidence.filter((e) => !beforeIds.has(`${e.type}:${e.id}`));
    if (!added.length) continue;
    rows.push({
      kind: q.kind, id: q.id, before: before.length, after: q.evidence.length, added: added.length,
      otherSide: added.filter((e) => e.by === 'counterparty' && q.work.fulfiller === 'user').length,
      fresh: q.tier !== 2,
    });
  }
  const commitments = rows.filter((r) => r.kind === 'commitment');
  const inbox = rows.filter((r) => r.kind === 'inbox');
  const fresh = rows.filter((r) => r.fresh).length;
  console.log(`DRY RUN — read-only, zero AI · account ${USER.slice(0, 8)}`);
  console.log(`open commitments ${plan.openCommitments} · open actionable inbox ${plan.openInbox} · nominated (new matcher) ${plan.queue.length}`);
  console.log(`matched evidence left beyond the per-type bounds: ${plan.evidenceLeftBehind ?? 0}`);
  console.log(`\nNEWLY NOMINATED same-conversation evidence — commitments: ${commitments.length} · inbox items: ${inbox.length}`);
  for (const r of rows) {
    console.log(`  ${r.kind.padEnd(10)} ${r.id}  evidence ${r.before} → ${r.after} (+${r.added}; other side's messages ${r.otherSide})${r.fresh ? ' · will be judged' : ''}`);
  }
  console.log(`\nthe next sweep would spend ≤ ${fresh} fresh fulfillment judgment(s) on these ≈ €${(fresh * EST_EUR_PER_JUDGMENT).toFixed(3)} (capped per run; only a judged delivery closes).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
