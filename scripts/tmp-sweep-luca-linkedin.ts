// TEMP — push Luca's LinkedIn Expert repositioning to EXISTING custom_agents rows (the seed is
// insert-only; the 085e40e lesson). Dry-run default; --apply executes. Never committed.
import { createClient } from '@supabase/supabase-js';
import { buildWorkers } from '../lib/workers/seed';

async function main() {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const apply = process.argv.includes('--apply');
  const def = buildWorkers('_').find((w) => w.worker_role === 'branding_expert');
  if (!def) { console.error('no branding_expert def in seed'); process.exit(1); }
  const { data: rows } = await sb.from('custom_agents')
    .select('id, user_id, name, description')
    .in('worker_role', ['branding_expert', 'linkedin_drafter']).eq('is_worker', true);
  console.log(`${apply ? 'APPLYING to' : 'DRY RUN over'} ${(rows ?? []).length} live rows`);
  for (const r of rows ?? []) console.log(`  · ${r.id.slice(0, 8)} (${r.name}) — "${String(r.description).slice(0, 60)}"`);
  if (apply) {
    const { error } = await sb.from('custom_agents')
      .update({ description: def.description, instructions: def.instructions, conversation_starters: def.conversation_starters })
      .in('worker_role', ['branding_expert', 'linkedin_drafter']).eq('is_worker', true);
    console.log(error ? `FAILED: ${error.message}` : 'updated all');
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
