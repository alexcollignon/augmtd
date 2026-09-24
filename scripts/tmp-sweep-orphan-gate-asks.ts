// TEMP sweep — settle workflow-sourced commitments whose work no longer exists. Never committed.
// Dry-run default; --execute settles. Run: npx tsx --env-file=.env.local scripts/tmp-sweep-orphan-gate-asks.ts [--execute]
import { createClient } from '@supabase/supabase-js';

async function main() {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const execute = process.argv.includes('--execute');
  const { data: open } = await sb.from('commitments')
    .select('id, user_id, description, source, source_id')
    .in('source', ['handoff', 'workflow']).eq('status', 'open').limit(500);
  const zombies: Array<{ id: string; why: string; desc: string }> = [];
  for (const c of open ?? []) {
    if (!c.source_id) continue;
    if (c.source === 'workflow') {
      const { data: wf } = await sb.from('workflows').select('id').eq('id', c.source_id).maybeSingle();
      if (!wf) zombies.push({ id: c.id, why: 'workflow gone', desc: c.description });
    } else {
      const { data: run } = await sb.from('workflow_runs').select('id, workflow_id, status').eq('id', c.source_id).maybeSingle();
      if (!run) { zombies.push({ id: c.id, why: 'run gone', desc: c.description }); continue; }
      const { data: wf } = await sb.from('workflows').select('id').eq('id', run.workflow_id).maybeSingle();
      if (!wf) zombies.push({ id: c.id, why: 'run\'s workflow gone', desc: c.description });
      else if (['cancelled', 'failed', 'rejected', 'succeeded'].includes(String(run.status)))
        zombies.push({ id: c.id, why: `run ${run.status} (ask should have settled)`, desc: c.description });
    }
  }
  console.log(`open workflow-sourced commitments: ${(open ?? []).length}; zombies: ${zombies.length}`);
  for (const z of zombies) console.log(`  · [${z.why}] ${z.desc.slice(0, 90)}`);
  if (execute && zombies.length) {
    for (const z of zombies) {
      await sb.from('commitments').update({
        status: 'dismissed', resolved_at: new Date().toISOString(), resolved_reason: 'orphan_sweep_workflow_gone',
      }).eq('id', z.id);
    }
    console.log(`settled ${zombies.length}`);
  } else if (!execute) console.log('(dry run — re-run with --execute)');
}
main().catch((e) => { console.error(e); process.exit(1); });
