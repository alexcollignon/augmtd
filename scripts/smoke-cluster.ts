// Smoke test AI auto-clustering (S3.2): run suggestProjects on real data → print suggested initiatives,
// then simulate accept for the FIRST suggestion (create auto project + assign atoms + verify project_id),
// then clean up (delete project → items un-cluster). READ-mostly; the accept sim is reverted at the end.
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { suggestProjects } from '../lib/projects/cluster';

const USER = '08fe4449-e5eb-431d-9156-02e9324e5903';
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  console.log('=== S3.2 auto-clustering smoke ===\n');
  const suggestions = await suggestProjects(sb, USER);
  console.log(`suggestProjects → ${suggestions.length} clusters\n`);
  suggestions.forEach((s, i) => {
    console.log(`  ${i + 1}. "${s.name}"  (${s.items.length} items${s.purpose ? ` · ${s.purpose}` : ''})`);
    s.items.slice(0, 4).forEach((it) => console.log(`       - [${it.table.replace('_items', '')}] ${it.who ? it.who + ' — ' : ''}${it.title.slice(0, 50)}`));
  });

  if (!suggestions.length) { console.log('\n(no clusters — nothing to accept-sim)'); return; }

  // ── Simulate accept of the first suggestion ──
  const s = suggestions[0];
  console.log(`\n--- accept-sim: "${s.name}" ---`);
  const { data: proj } = await sb.from('projects').insert({ user_id: USER, name: `SMOKE — ${s.name}`, auto: true, description: s.purpose || null }).select('id').single();
  const pid = proj!.id;
  const byTable: Record<string, string[]> = {};
  for (const it of s.items) (byTable[it.table] ??= []).push(it.id);
  let assigned = 0;
  for (const [table, ids] of Object.entries(byTable)) {
    const { count } = await sb.from(table).update({ project_id: pid }, { count: 'exact' }).in('id', ids).eq('user_id', USER);
    assigned += count ?? 0;
    console.log(`  assigned ${count} ${table}`);
  }
  console.log(`  total assigned = ${assigned}`);

  // verify re-run excludes now-clustered items (they shouldn't reappear)
  const after = await suggestProjects(sb, USER);
  const stillThere = after.find((x) => x.name === s.name);
  console.log(`  re-run suggestions: ${after.length}; same cluster still suggested? ${stillThere ? 'YES (some items remained unclustered)' : 'no (clustered items excluded ✓)'}`);

  // ── cleanup ──
  await sb.from('projects').delete().eq('id', pid).eq('user_id', USER);
  const { count: leftover } = await sb.from('inbox_items').select('id', { count: 'exact', head: true }).eq('project_id', pid);
  const { count: leftoverC } = await sb.from('commitments').select('id', { count: 'exact', head: true }).eq('project_id', pid);
  console.log(`  cleanup → project deleted; residual project_id refs: inbox=${leftover} commit=${leftoverC} (should be 0/0)`);
  console.log('\nDone.');
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
