// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE OUTCOME-LEDGER BACKFILL (W3.2 — THE TWO-WAY LEDGER, Sep 22). DRY-RUN BY DEFAULT; `--apply`
// is OWNER-GATED (stabilization plan PART IV — repair sweeps apply only on the owner's word).
//
// Prints the census first (the ledger by version × class; the one-sided R1 era shows as v1), then
// reconstructs the two-way history the R1 doors never wrote:
//
//   A. DONE ELSEWHERE — inbox items closed by an EXTERNAL reply (`source_data.resolved_reason =
//      'replied'`) that still carry an UNSENT prepared artifact generated BEFORE the resolution. The
//      resolver keeps the drafts on the row, so the history is exact. One v2 row per artifact.
//   B. RECLASSIFIED — each v1 `prepared_discarded` row, re-read against its item's CURRENT state:
//      completed → done_elsewhere (R1 folded "mark done" into "discarded"), dismissed → discarded;
//      anything else (restored, reopened, gone) is left alone — never a guessed class.
//
// Every written row carries `backfilled: true` (+ `ledger_v: 2`) and the resolution time as its
// created_at. Backfilled rows are EXCLUDED from `outcomeLedgerReady` — only live data can prove the
// doors write — but they do count as facts once the owner lifts the quarantine. Idempotent: a v2 row
// for the same (item, artifact) already present is never duplicated.
//
//   npx tsx scripts/backfill-outcome-ledger.ts            # census + dry run (read-only)
//   npx tsx scripts/backfill-outcome-ledger.ts --apply    # OWNER ONLY
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { fetchAllRows } from '../lib/utils/fetch-all';
import { outcomeSignalData, senderClassOf, OUTCOME_LEDGER_VERSION, type PreparedArtifactKind, type PreparedOutcome } from '../lib/prepare/outcome';

const APPLY = process.argv.includes('--apply');
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

type Sig = { id: string; user_id: string; created_at: string; inbox_item_id: string | null; signal_data: Record<string, unknown> | null };
type Item = { id: string; user_id: string; status: string; source_data: Record<string, unknown> | null };

const SD_ARTIFACTS: Array<[string, PreparedArtifactKind]> = [
  ['draft', 'reply_draft'], ['nudge_draft', 'nudge_draft'], ['prepared_invite', 'invite'], ['prepared_forward', 'forward'],
];

(async () => {
  console.log(`THE OUTCOME-LEDGER BACKFILL — ${APPLY ? 'APPLY (owner)' : 'DRY RUN (read-only)'}\n`);

  // ── THE CENSUS ────────────────────────────────────────────────────────────────────────────────
  const sigs = await fetchAllRows<Sig>((from, to) => sb.from('learning_signals')
    .select('id, user_id, created_at, inbox_item_id, signal_data')
    .eq('signal_type', 'action_taken').like('signal_data->>action', 'prepared_%')
    .order('created_at', { ascending: true }).range(from, to));
  const byClass = new Map<string, number>();
  for (const s of sigs) {
    const sd = s.signal_data ?? {};
    const v = Number(sd.ledger_v) >= OUTCOME_LEDGER_VERSION ? `v${OUTCOME_LEDGER_VERSION}` : 'v1';
    const key = `${v} · ${String(sd.action).replace('prepared_', '')} · ${String(sd.artifact ?? '?')}${sd.backfilled ? ' · backfilled' : ''}`;
    byClass.set(key, (byClass.get(key) ?? 0) + 1);
  }
  console.log(`CENSUS — ${sigs.length} outcome rows across ${new Set(sigs.map((s) => s.user_id)).size} users`);
  for (const [k, n] of [...byClass.entries()].sort()) console.log(`  ${String(n).padStart(5)}  ${k}`);

  const haveV2 = new Set(sigs
    .filter((s) => Number(s.signal_data?.ledger_v) >= OUTCOME_LEDGER_VERSION)
    .map((s) => `${String(s.signal_data?.item_id)}|${String(s.signal_data?.artifact)}`));
  const planned: Array<{ user_id: string; created_at: string; inbox_item_id: string | null; signal_data: Record<string, unknown>; why: string }> = [];

  // ── A · DONE ELSEWHERE (external reply while a prepared artifact was pending) ────────────────
  const replied = await fetchAllRows<Item>((from, to) => sb.from('inbox_items')
    .select('id, user_id, status, source_data')
    .eq('source_data->>resolved_reason', 'replied')
    .order('id', { ascending: true }).range(from, to));
  let aItems = 0;
  const aByArtifact = new Map<string, number>();
  for (const it of replied) {
    const sd = it.source_data ?? {};
    const resolvedAt = typeof sd.resolved_at === 'string' ? sd.resolved_at : null;
    let any = false;
    for (const [field, artifact] of SD_ARTIFACTS) {
      const a = sd[field] as { body?: unknown; sent_at?: unknown; generated_at?: unknown; title?: unknown; to?: unknown } | undefined;
      if (!a || typeof a !== 'object' || a.sent_at) continue;
      const hasContent = field === 'draft' || field === 'nudge_draft' ? typeof a.body === 'string' && a.body.trim() : true;
      if (!hasContent) continue;
      const gen = typeof a.generated_at === 'string' ? a.generated_at : null;
      if (resolvedAt && gen && gen > resolvedAt) continue; // prepared AFTER the reply — not overtaken by it
      if (haveV2.has(`${it.id}|${artifact}`)) continue;
      any = true;
      aByArtifact.set(artifact, (aByArtifact.get(artifact) ?? 0) + 1);
      planned.push({
        user_id: it.user_id, created_at: resolvedAt ?? new Date().toISOString(), inbox_item_id: it.id, why: 'A',
        signal_data: outcomeSignalData({
          outcome: 'done_elsewhere', artifact, itemKind: 'inbox', itemId: it.id, door: 'backfill',
          senderClass: senderClassOf(sd), preparedAt: gen, backfilled: true,
        }, resolvedAt ? Date.parse(resolvedAt) : Date.now()),
      });
    }
    if (any) aItems++;
  }
  console.log(`\nA · DONE ELSEWHERE — ${replied.length} items closed by an external reply; ${aItems} carried a pending preparation`);
  for (const [k, n] of aByArtifact) console.log(`  ${String(n).padStart(5)}  ${k}`);

  // ── B · RECLASSIFY the one-sided v1 discards against the item's current state ────────────────
  const v1 = sigs.filter((s) => !(Number(s.signal_data?.ledger_v) >= OUTCOME_LEDGER_VERSION) && s.signal_data?.action === 'prepared_discarded');
  const ids = [...new Set(v1.map((s) => String(s.signal_data?.item_id ?? s.inbox_item_id ?? '')).filter(Boolean))];
  const statusOf = new Map<string, Item>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await sb.from('inbox_items').select('id, user_id, status, source_data').in('id', ids.slice(i, i + 200));
    for (const it of (data ?? []) as Item[]) statusOf.set(it.id, it);
  }
  const bCount = new Map<string, number>();
  for (const s of v1) {
    const itemId = String(s.signal_data?.item_id ?? s.inbox_item_id ?? '');
    const artifact = String(s.signal_data?.artifact ?? '') as PreparedArtifactKind;
    const it = statusOf.get(itemId);
    const outcome: PreparedOutcome | null = !it ? null : it.status === 'completed' ? 'done_elsewhere' : it.status === 'dismissed' ? 'discarded' : null;
    const label = outcome ?? `left alone (${it ? it.status : 'item gone'})`;
    bCount.set(label, (bCount.get(label) ?? 0) + 1);
    if (!outcome || haveV2.has(`${itemId}|${artifact}`)) continue;
    planned.push({
      user_id: s.user_id, created_at: s.created_at, inbox_item_id: itemId, why: 'B',
      signal_data: { ...outcomeSignalData({
        outcome, artifact, itemKind: 'inbox', itemId, door: 'backfill', senderClass: senderClassOf(it!.source_data), backfilled: true,
      }), reclassified_from: s.id },
    });
  }
  console.log(`\nB · RECLASSIFY — ${v1.length} v1 discards`);
  for (const [k, n] of bCount) console.log(`  ${String(n).padStart(5)}  ${k}`);

  const aN = planned.filter((p) => p.why === 'A').length, bN = planned.filter((p) => p.why === 'B').length;
  console.log(`\nPLANNED — ${planned.length} v2 rows (A done_elsewhere: ${aN} · B reclassified: ${bN})`);
  if (!APPLY) { console.log('\nDry run — nothing written. Re-run with --apply (owner only) to write.'); return; }

  let wrote = 0;
  for (let i = 0; i < planned.length; i += 200) {
    const chunk = planned.slice(i, i + 200).map((p) => ({
      user_id: p.user_id, signal_type: 'action_taken', inbox_item_id: p.inbox_item_id,
      signal_data: p.signal_data, created_at: p.created_at,
    }));
    const { error } = await sb.from('learning_signals').insert(chunk);
    if (error) { console.error('insert failed:', error.message); break; }
    wrote += chunk.length;
  }
  console.log(`\nWROTE ${wrote} rows.`);
})().catch((e) => { console.error(e); process.exit(1); });
