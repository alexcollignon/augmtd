// P5 smoke — project lifecycle across users. Proves: the new 'done' status passes the CHECK constraint,
// active↔done↔archived↔reopen all persist, and Un-group (DELETE) returns items to loose via ON DELETE SET
// NULL (never destroys them) + the activity/learning writes are accepted. Self-cleaning (borrows one
// already-loose item transiently; it ends back at project_id=null, exactly where it started).
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

(async () => {
  for (const email of ['alextcollignon@gmail.com', 'rene@zeroto100.ai']) {
    const { data: p } = await sb.from('profiles').select('id').ilike('email', email).maybeSingle();
    if (!p) { console.log(`${email}: no profile`); continue; }
    const uid = p.id as string;
    console.log(`\n=== ${email} ===`);
    let projectId: string | null = null;
    let borrowedItem: string | null = null;
    let ok = true;
    try {
      // create a throwaway project
      const { data: proj, error: cErr } = await sb.from('projects').insert({ user_id: uid, name: '__p5_lifecycle_test__', status: 'active', auto: false }).select('id').single();
      if (cErr || !proj) { console.log('  create ✗', cErr?.message); continue; }
      projectId = proj.id as string;

      // status transitions (the migration's CHECK must accept done + archived + active)
      for (const status of ['done', 'archived', 'active'] as const) {
        const { error } = await sb.from('projects').update({ status }).eq('id', projectId).eq('user_id', uid);
        console.log(`  → ${status}: ${error ? '✗ ' + error.message : '✓'}`);
        ok = ok && !error;
      }
      // activity + learning writes for a lifecycle event
      const a = await sb.from('activity_events').insert({ user_id: uid, type: 'project_status', title: 'Marked done: test', entity_type: 'project', entity_id: projectId, metadata: { status: 'done' } });
      const l = await sb.from('learning_signals').insert({ user_id: uid, inbox_item_id: null, signal_type: 'action_taken', signal_data: { action: 'project_done', project_id: projectId } });
      console.log(`  activity_events ${a.error ? '✗ ' + a.error.message : '✓'} | learning_signals ${l.error ? '✗ ' + l.error.message : '✓'}`);
      ok = ok && !a.error && !l.error;

      // Un-group = DELETE → ON DELETE SET NULL. Borrow one already-loose item, attach, delete, verify null.
      const { data: loose } = await sb.from('inbox_items').select('id').eq('user_id', uid).is('project_id', null).limit(1);
      if (loose && loose[0]) {
        borrowedItem = loose[0].id as string;
        await sb.from('inbox_items').update({ project_id: projectId }).eq('id', borrowedItem).eq('user_id', uid);
        const attached = (await sb.from('inbox_items').select('project_id').eq('id', borrowedItem).maybeSingle()).data?.project_id;
        await sb.from('projects').delete().eq('id', projectId).eq('user_id', uid); // the un-group
        const after = (await sb.from('inbox_items').select('project_id').eq('id', borrowedItem).maybeSingle()).data?.project_id;
        const setNull = attached === projectId && after === null;
        console.log(`  un-group SET NULL: attached=${attached === projectId ? '✓' : '✗'}, after-delete null=${after === null ? '✓' : '✗'} ${setNull ? '✓ items returned to loose (not destroyed)' : '✗'}`);
        ok = ok && setNull;
        projectId = null; // already deleted
      } else {
        console.log('  (no loose item to test SET NULL — skipped)');
      }
      console.log(`  ${ok ? '✅ PASS' : '❌ FAIL'}`);
    } finally {
      if (borrowedItem && projectId) await sb.from('inbox_items').update({ project_id: null }).eq('id', borrowedItem);
      if (projectId) await sb.from('projects').delete().eq('id', projectId).eq('user_id', uid);
      await sb.from('activity_events').delete().eq('user_id', uid).eq('type', 'project_status').eq('title', 'Marked done: test');
      await sb.from('learning_signals').delete().eq('user_id', uid).eq('signal_data->>action', 'project_done');
    }
  }
})();
