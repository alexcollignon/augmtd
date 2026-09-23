// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE MIRROR RETIREMENT SWEEP (stabilization W2.3, invariant 6 ONE FACT ONE HOME).
//
// From June 23 the commitments sweep wrote an `inbox_items` MIRROR (`source='commitment'`) for every
// overdue/stale open commitment so it could be seen on surfaces that then only rendered inbox rows.
// Every surface now reads commitments directly; the writer is gone (app/api/cron/commitments-sweep)
// and every listing read excludes the historical rows (lib/inbox/commitment-mirrors.ts). This sweep
// ARCHIVES what is left — never a hard delete:
//   • every PENDING `source='commitment'` inbox row → status 'dismissed', source_data.resolved_reason
//     'mirror_retired' + resolved_at + mirror_retired:true; the prepared artifacts that lived on the
//     row (draft / nudge_draft / prepared_invite / prepared_forward / prepared_by — drafted against a
//     row with no thread) are stripped from source_data and REPORTED;
//   • every `item_deliverables` pool row scoped to a mirror id is stamped metadata.archived_at +
//     archived_reason 'mirror_retired' (no status column exists; the parent row is excluded from every
//     reader so the pool row is unreachable — the stamp is the receipt);
//   • NOTHING ELSE is touched: no commitment, no other inbox row, no activity_events (931 machine
//     rows must never read as the user's deeds), no hard delete anywhere.
// DRY-RUN BY DEFAULT — prints per-user counts and the orphaned artifacts it would archive. `--apply`
// is owner-gated (PART IV of docs/stabilization-plan.md). `--user <email>` narrows to one account.
//   npx tsx scripts/sweep-retire-mirrors.ts            (dry-run, all users)
//   npx tsx scripts/sweep-retire-mirrors.ts --apply    (owner only)
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { fetchAllRows } from '../lib/utils/fetch-all';
import { MIRROR_SOURCE, MIRROR_RETIRED_REASON } from '../lib/inbox/commitment-mirrors';

const APPLY = process.argv.includes('--apply');
const userArg = process.argv.includes('--user') ? process.argv[process.argv.indexOf('--user') + 1] : null;

/** The prepared-artifact keys a mirror row could carry — drafted against a row with no thread. */
const PREPARED_KEYS = ['draft', 'nudge_draft', 'prepared_invite', 'prepared_forward', 'prepared_by'] as const;

type MirrorRow = { id: string; user_id: string; source_id: string; status: string; work_state: string | null; source_data: Record<string, unknown> | null };

async function main(): Promise<void> {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
  console.log(`THE MIRROR RETIREMENT SWEEP — ${APPLY ? 'APPLY' : 'DRY-RUN (pass --apply to archive)'}`);

  let userFilter: string | null = null;
  if (userArg) {
    const { data } = await sb.auth.admin.listUsers({ perPage: 1000 });
    const u = data?.users?.find((x) => x.email === userArg);
    if (!u) { console.error(`no user ${userArg}`); process.exit(1); }
    userFilter = u.id;
  }

  // NO SILENT CAPS: paged on a stable order.
  const pending = await fetchAllRows<MirrorRow>((from, to) => {
    let q = sb.from('inbox_items').select('id, user_id, source_id, status, work_state, source_data')
      .eq('source', MIRROR_SOURCE).eq('status', 'pending');
    if (userFilter) q = q.eq('user_id', userFilter);
    return q.order('created_at', { ascending: true }).order('id', { ascending: true }).range(from, to);
  }, { maxRows: 50000 });
  console.log(`pending mirrors: ${pending.length}`);
  if (!pending.length) { console.log('nothing to retire.'); return; }

  // The commitment's fate, for the report only (the archive is unconditional — a mirror of an OPEN
  // commitment is still a second home; the commitment lane carries the fact).
  const cids = [...new Set(pending.map((m) => m.source_id))];
  const fate = new Map<string, string>();
  for (let i = 0; i < cids.length; i += 200) {
    const { data } = await sb.from('commitments').select('id, status').in('id', cids.slice(i, i + 200));
    for (const c of data ?? []) fate.set(c.id, c.status);
  }

  // Orphaned prepared artifacts — on the row and in the pool.
  const orphanOnRow: Array<{ id: string; user_id: string; keys: string[] }> = [];
  for (const m of pending) {
    const keys = PREPARED_KEYS.filter((k) => m.source_data && m.source_data[k] != null);
    if (keys.length) orphanOnRow.push({ id: m.id, user_id: m.user_id, keys });
  }
  const mirrorIds = pending.map((m) => m.id);
  const poolRows: Array<{ id: string; user_id: string; entity_id: string; type: string; title: string | null; metadata: Record<string, unknown> | null }> = [];
  for (let i = 0; i < mirrorIds.length; i += 200) {
    const { data } = await sb.from('item_deliverables').select('id, user_id, entity_id, type, title, metadata').in('entity_id', mirrorIds.slice(i, i + 200));
    for (const r of data ?? []) if (!(r.metadata as Record<string, unknown> | null)?.archived_at) poolRows.push(r);
  }

  // Per-user report.
  const byUser = new Map<string, { pending: number; ofOpen: number; ofSettled: number; missing: number; orphanRows: number; poolRows: number }>();
  for (const m of pending) {
    const u = byUser.get(m.user_id) ?? { pending: 0, ofOpen: 0, ofSettled: 0, missing: 0, orphanRows: 0, poolRows: 0 };
    u.pending++;
    const f = fate.get(m.source_id);
    if (!f) u.missing++; else if (f === 'open' || f === 'pending' || f === 'in_progress') u.ofOpen++; else u.ofSettled++;
    byUser.set(m.user_id, u);
  }
  for (const o of orphanOnRow) byUser.get(o.user_id)!.orphanRows++;
  for (const p of poolRows) { const u = byUser.get(p.user_id); if (u) u.poolRows++; }
  console.log('\nper user (pending mirrors · of an OPEN commitment · of a settled one · commitment missing · rows carrying prepared artifacts · pool rows):');
  for (const [uid, u] of [...byUser.entries()].sort((a, b) => b[1].pending - a[1].pending)) {
    console.log(`  ${uid}  ${u.pending} · ${u.ofOpen} · ${u.ofSettled} · ${u.missing} · ${u.orphanRows} · ${u.poolRows}`);
  }
  console.log(`\norphaned prepared artifacts on mirror rows: ${orphanOnRow.length}`);
  for (const o of orphanOnRow.slice(0, 40)) console.log(`  inbox_items ${o.id} — ${o.keys.join(', ')}`);
  if (orphanOnRow.length > 40) console.log(`  … ${orphanOnRow.length - 40} more`);
  console.log(`orphaned pool rows (item_deliverables) on mirrors: ${poolRows.length}`);
  for (const p of poolRows.slice(0, 40)) console.log(`  item_deliverables ${p.id} — ${p.type}${p.title ? ` "${p.title.slice(0, 50)}"` : ''} → inbox ${p.entity_id}`);

  if (!APPLY) { console.log('\nDRY-RUN — nothing written. Re-run with --apply (owner) to archive.'); return; }

  // ── APPLY: archive, conditional on the row still being pending (a race with a user deed loses). ──
  const nowIso = new Date().toISOString();
  let archived = 0, failed = 0, poolStamped = 0;
  for (const m of pending) {
    const sd = { ...(m.source_data ?? {}) };
    for (const k of PREPARED_KEYS) delete sd[k];
    const { error, data } = await sb.from('inbox_items')
      .update({
        status: 'dismissed',
        source_data: { ...sd, resolved_reason: MIRROR_RETIRED_REASON, resolution_reason: MIRROR_RETIRED_REASON, resolved_at: nowIso, mirror_retired: true },
        updated_at: nowIso,
      })
      .eq('id', m.id).eq('user_id', m.user_id).eq('source', MIRROR_SOURCE).eq('status', 'pending').select('id');
    if (error || !data?.length) failed++; else archived++;
  }
  for (const p of poolRows) {
    const { error } = await sb.from('item_deliverables')
      .update({ metadata: { ...(p.metadata ?? {}), archived_at: nowIso, archived_reason: MIRROR_RETIRED_REASON } })
      .eq('id', p.id).eq('user_id', p.user_id);
    if (!error) poolStamped++;
  }
  // The deck caches: a bust so the next Home load reflects the retirement (last-good serve stays).
  for (const uid of byUser.keys()) await sb.from('profiles').update({ home_brief: null }).eq('id', uid).then(() => {}, () => {});
  console.log(`\nAPPLIED — archived ${archived} mirror(s) (${failed} skipped: no longer pending), stamped ${poolStamped} pool row(s). Nothing deleted.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
