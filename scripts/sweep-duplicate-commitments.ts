// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE OPEN-DUPLICATE MERGE REPORT (stabilization W3.4 · THE OPEN-DUPLICATE LAW). DETERMINISTIC.
//
// Groups LIVE commitments (open / suggested) that are ONE obligation by the write door's own
// predicate (`isOpenDuplicate` + `isNearDuplicate` — imported, never re-implemented): same
// direction, the shared 0.6 Jaccard bar, and a shared context — the same thread, the same source
// meeting, or the same counterparty within 14 days. Union-find over the pairs; the OLDEST row of a
// group is the keeper (it carries the history), the rest are the merge candidates.
//
// Dry-run by default — a REPORT. --apply (owner-gated) dismisses the non-keepers with
// resolved_reason 'duplicate' (a status flip — undoable via /api/restore), guarded on status.
//   npx tsx scripts/sweep-duplicate-commitments.ts [--apply] [--user email] [--all]
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { isOpenDuplicate } from '../lib/commitments/extraction-truth';
import { isNearDuplicate } from '../lib/commitments/extract';
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const APPLY = process.argv.includes('--apply');
const ALL = process.argv.includes('--all');
const userArg = process.argv.includes('--user') ? process.argv[process.argv.indexOf('--user') + 1] : null;

type Row = { id: string; description: string; direction: string; counterparty: string | null; thread_id: string | null; source_id: string | null; created_at: string; status: string };

(async () => {
  if (!ALL && !userArg) { console.log('usage: --user <email> | --all  [--apply]'); process.exit(1); }
  const { data: users } = await sb.auth.admin.listUsers({ perPage: 1000 });
  const targets = ALL ? users!.users : users!.users.filter((u) => u.email === userArg);
  let groupsTotal = 0, rowsInGroups = 0, dismissed = 0;

  for (const u of targets) {
    const { data } = await sb.from('commitments')
      .select('id, description, direction, counterparty, thread_id, source_id, created_at, status')
      .eq('user_id', u.id).in('status', ['open', 'suggested']).order('created_at', { ascending: true }).limit(3000);
    const rows = (data ?? []) as Row[];
    if (rows.length < 2) continue;
    const parent = rows.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
      if (isOpenDuplicate(rows[i], rows[j], (a, b) => isNearDuplicate(a, b))) parent[find(j)] = find(i);
    }
    const groups = new Map<number, number[]>();
    rows.forEach((_, i) => { const r = find(i); (groups.get(r) ?? groups.set(r, []).get(r)!).push(i); });
    for (const g of groups.values()) {
      if (g.length < 2) continue;
      groupsTotal++; rowsInGroups += g.length;
      const [keep, ...rest] = g; // oldest first (ordered query)
      console.log(`  ▸ ${u.email} · keep "${rows[keep].description.slice(0, 70)}" (${rows[keep].created_at.slice(0, 10)} · ${rows[keep].counterparty ?? '∅'})`);
      for (const k of rest) {
        console.log(`      merge "${rows[k].description.slice(0, 70)}" (${rows[k].created_at.slice(0, 10)} · ${rows[k].status})`);
        if (APPLY) {
          const nowIso = new Date().toISOString();
          const { error } = await sb.from('commitments')
            .update({ status: 'dismissed', resolved_reason: 'duplicate', resolved_at: nowIso, updated_at: nowIso })
            .eq('id', rows[k].id).eq('user_id', u.id).in('status', ['open', 'suggested']);
          if (error) console.log(`    ✗ write failed: ${error.message}`); else dismissed++;
        }
      }
    }
    if (APPLY && dismissed) await sb.from('profiles').update({ home_brief: null }).eq('id', u.id);
  }
  console.log(`\nduplicate groups=${groupsTotal} · rows in groups=${rowsInGroups} · merge candidates=${rowsInGroups - groupsTotal} · dismissed=${dismissed}${APPLY ? '' : ' (dry-run — pass --apply)'}`);
})();
