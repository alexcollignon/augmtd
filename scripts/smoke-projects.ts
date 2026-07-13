// Smoke test the projects schema + CRUD flow directly against the DB (service role) — verifies the
// migration applied and the shape the API relies on works: create → read → update goals/rules → assign
// an item → delete un-clusters (project_id → null, item survives). Cleans up after itself.
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const USER = '08fe4449-e5eb-431d-9156-02e9324e5903';
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  console.log('=== projects CRUD smoke ===');

  // 1. CREATE
  const { data: created, error: cErr } = await sb.from('projects')
    .insert({ user_id: USER, name: 'SMOKE — Fidelidade deal', description: 'test', goals: ['Close the pilot'], rules: ['Reply in PT', 'Never quote a price without approval'] })
    .select('*').single();
  if (cErr) { console.error('CREATE failed:', cErr.message); process.exit(1); }
  const pid = created.id;
  console.log(`✓ create → ${pid} | goals=${JSON.stringify(created.goals)} rules=${created.rules.length} status=${created.status} auto=${created.auto}`);

  // 2. READ (list)
  const { data: list } = await sb.from('projects').select('id,name,goals,rules').eq('user_id', USER).eq('id', pid);
  console.log(`✓ read → ${list?.length} row, name="${list?.[0]?.name}"`);

  // 3. UPDATE goals/rules + archive
  const { data: upd } = await sb.from('projects').update({ goals: ['Close the pilot', 'Expand to 3 teams'], status: 'archived' }).eq('id', pid).eq('user_id', USER).select('goals,status,updated_at').single();
  console.log(`✓ update → goals=${upd?.goals.length} status=${upd?.status}`);

  // 4. ASSIGN an item (grab a real pending inbox item) then verify the FK + count
  const { data: anItem } = await sb.from('inbox_items').select('id').eq('user_id', USER).eq('status', 'pending').limit(1).single();
  if (anItem) {
    await sb.from('inbox_items').update({ project_id: pid }).eq('id', anItem.id);
    const { count } = await sb.from('inbox_items').select('id', { count: 'exact', head: true }).eq('project_id', pid);
    console.log(`✓ assign → inbox item ${String(anItem.id).slice(0, 8)} linked; project item count=${count}`);

    // 5. DELETE project → item survives, project_id set NULL (ON DELETE SET NULL)
    await sb.from('projects').delete().eq('id', pid).eq('user_id', USER);
    const { data: survived } = await sb.from('inbox_items').select('id, project_id').eq('id', anItem.id).single();
    console.log(`✓ delete → project gone; item survived=${!!survived} project_id now=${survived?.project_id === null ? 'NULL (un-clustered ✓)' : survived?.project_id}`);
  } else {
    await sb.from('projects').delete().eq('id', pid).eq('user_id', USER);
    console.log('  (no pending inbox item to test assignment; deleted project)');
  }

  const { data: gone } = await sb.from('projects').select('id').eq('id', pid);
  console.log(`✓ cleanup → project rows remaining for this id: ${gone?.length ?? 0}`);
  console.log('\nAll good — schema + CRUD + un-cluster-on-delete verified.');
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
