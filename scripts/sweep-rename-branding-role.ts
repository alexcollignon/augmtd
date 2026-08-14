// THE ROLE-KEY RENAME (Aug 14): linkedin_drafter → branding_expert on live rows. Run in the SAME
// release as the code rename (the AgentOS bridge routes /agents/{worker_role}/runs — DB rows and
// the box's workers.py ids must agree). Render maps keep the legacy alias for persisted turns.
// Dry-run by default; --apply to execute.
import { createClient } from '@supabase/supabase-js';
const APPLY = process.argv.includes('--apply');
async function main() {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: rows } = await sb.from('custom_agents').select('id, user_id, is_active')
    .eq('worker_role', 'linkedin_drafter').eq('is_worker', true);
  console.log(`${APPLY ? 'APPLY' : 'DRY-RUN'} — ${rows?.length ?? 0} row(s) to rename`);
  if (APPLY && rows?.length) {
    const { error } = await sb.from('custom_agents').update({ worker_role: 'branding_expert' })
      .eq('worker_role', 'linkedin_drafter').eq('is_worker', true);
    console.log(error ? `! ${error.message}` : `renamed ${rows.length} row(s)`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
