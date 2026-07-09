// Re-baseline resolution timestamps so the Day-cleared ring counts only genuine same-day resolutions.
//
// WHY: the ring used to count resolved items whose updated_at fell in today's window. updated_at bumps
// on ANY write (sync, label reconcile, reclassification, backfill scripts), so old resolutions got
// pulled into "today" and the ring filled passively. The ring now counts by a REAL resolution
// timestamp: inbox_items.source_data.resolved_at (jsonb) + commitments.resolved_at (column). Existing
// resolved rows that predate this change have NO such timestamp — so they'd never count (fine), but
// we set a PAST proxy so the data is coherent and a later resolve on the same row is unambiguous.
//
// Proxy choice (conservative — never over-count today):
//   inbox_items (status completed|dismissed, missing source_data.resolved_at):
//     → existing source_data.resolved_at (already correct) — skip
//     → else source_data.deleted_at / archived_at (real action timestamps) if present
//     → else created_at  (NOT updated_at, which is polluted by maintenance writes)
//   commitments (status done|dismissed, resolved_at IS NULL):
//     → created_at
//
//   npx tsx scripts/rebaseline-resolved-at.ts                 # dry-run, ALL users
//   npx tsx scripts/rebaseline-resolved-at.ts --user=<id>     # dry-run, one user
//   npx tsx scripts/rebaseline-resolved-at.ts --user=<id> --apply
//
// Guarded: dry-run by default; --apply writes. Non-destructive: only fills a MISSING resolved_at,
// never overwrites an existing one, never touches status.

import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const APPLY = process.argv.includes('--apply');
const userArg = process.argv.find((a) => a.startsWith('--user='))?.split('=')[1] || null;

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

interface InboxRow { id: string; created_at: string; source_data: Record<string, unknown> | null; }
interface CommitRow { id: string; created_at: string; resolved_at: string | null; }

async function main() {
  console.log(`[rebaseline-resolved-at] mode=${APPLY ? 'APPLY' : 'DRY-RUN'} user=${userArg ?? 'ALL'}`);

  // ── inbox_items ────────────────────────────────────────────────────────────────
  let q = supabase.from('inbox_items')
    .select('id, created_at, source_data')
    .in('status', ['completed', 'dismissed']);
  if (userArg) q = q.eq('user_id', userArg);
  const { data: items, error: itemsErr } = await q.limit(100000);
  if (itemsErr) throw itemsErr;

  let inboxFilled = 0, inboxSkipped = 0;
  for (const row of (items ?? []) as InboxRow[]) {
    const sd = (row.source_data ?? {}) as Record<string, unknown>;
    if (typeof sd.resolved_at === 'string' && sd.resolved_at) { inboxSkipped++; continue; } // already has it
    const proxy =
      (typeof sd.deleted_at === 'string' && sd.deleted_at) ||
      (typeof sd.archived_at === 'string' && sd.archived_at) ||
      row.created_at;
    if (!proxy) { inboxSkipped++; continue; }
    inboxFilled++;
    if (APPLY) {
      const { error } = await supabase.from('inbox_items')
        .update({ source_data: { ...sd, resolved_at: proxy } })
        .eq('id', row.id);
      if (error) console.error(`  ✗ inbox ${row.id}: ${error.message}`);
    } else if (inboxFilled <= 20) {
      console.log(`  [dry] inbox ${row.id} → resolved_at=${proxy}`);
    }
  }

  // ── commitments ────────────────────────────────────────────────────────────────
  let cq = supabase.from('commitments')
    .select('id, created_at, resolved_at')
    .in('status', ['done', 'dismissed'])
    .is('resolved_at', null);
  if (userArg) cq = cq.eq('user_id', userArg);
  const { data: commits, error: cErr } = await cq.limit(100000);
  let commitFilled = 0, commitSkipped = 0, commitColumnAbsent = false;
  if (cErr) {
    // resolved_at column may be absent on older schemas — nothing to re-baseline then.
    console.warn(`  (commitments resolved_at query failed — column may be absent: ${cErr.message})`);
    commitColumnAbsent = true;
  } else {
    for (const c of (commits ?? []) as CommitRow[]) {
      if (c.resolved_at) { commitSkipped++; continue; }
      commitFilled++;
      if (APPLY) {
        const { error } = await supabase.from('commitments')
          .update({ resolved_at: c.created_at, resolved_reason: 'rebaselined' })
          .eq('id', c.id);
        if (error) console.error(`  ✗ commitment ${c.id}: ${error.message}`);
      } else if (commitFilled <= 20) {
        console.log(`  [dry] commitment ${c.id} → resolved_at=${c.created_at}`);
      }
    }
  }

  console.log('');
  console.log(`inbox_items:  ${inboxFilled} ${APPLY ? 'filled' : 'would fill'}, ${inboxSkipped} skipped (already stamped)`);
  if (commitColumnAbsent) console.log('commitments:  skipped (resolved_at column absent)');
  else console.log(`commitments:  ${commitFilled} ${APPLY ? 'filled' : 'would fill'}, ${commitSkipped} skipped`);

  // Bust the brief cache so the ring recomputes on next load.
  if (APPLY && userArg) {
    await supabase.from('profiles').update({ home_brief: null }).eq('id', userArg);
    console.log(`brief cache busted for ${userArg}`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
