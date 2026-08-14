// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE SOFIA RETIREMENT SWEEP (owner, Aug 14 — document production is THE ONE PRODUCTION DOOR's
// job; a persona whose identity IS the capability every actor shares was roster noise).
//
// Per user, for every custom_agents row with worker_role='content_manager' AND is_worker:
//   1. DEACTIVATE the row (is_active=false — never a hard delete: her past turns/threads keep
//      their attribution, and the roster/pickers filter on is_active).
//   2. RE-HOME her workflows to the user's Clara (personal_assistant) — a standing task must
//      never silently lose its owner.
//   3. Remove her agent_skills assignments (an inactive worker holds no skills).
//   4. Drop slack-sofia integration_connections rows (the app itself is deleted owner-side).
//
// ⚠️ RUN ONLY AFTER the retirement code is DEPLOYED — the old produce-default looks Sofia up by
// name, and deactivating her under the old code turns the exhaustion hand-off into a dead end.
// Dry-run by default; --apply to execute.
// Run: npx tsx --env-file=.env.local scripts/sweep-retire-sofia.ts [--apply]
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { createClient } from '@supabase/supabase-js';

const APPLY = process.argv.includes('--apply');

async function main() {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: sofias } = await sb.from('custom_agents').select('id, user_id, name, is_active')
    .eq('worker_role', 'content_manager').eq('is_worker', true);
  console.log(`${APPLY ? 'APPLY' : 'DRY-RUN'} — ${sofias?.length ?? 0} Sofia row(s) across users`);
  let deactivated = 0, rehomed = 0, skillsDropped = 0, slackDropped = 0;
  for (const sofia of sofias ?? []) {
    const { data: clara } = await sb.from('custom_agents').select('id')
      .eq('user_id', sofia.user_id).eq('worker_role', 'personal_assistant').eq('is_worker', true)
      .eq('is_active', true).limit(1).maybeSingle();
    const { data: wfs } = await sb.from('workflows').select('id, name').eq('agent_id', sofia.id);
    const { data: skills } = await sb.from('agent_skills').select('skill_id').eq('agent_id', sofia.id);
    console.log(`  user ${String(sofia.user_id).slice(0, 8)}: active=${sofia.is_active} workflows=${wfs?.length ?? 0} skills=${skills?.length ?? 0} clara=${clara ? 'yes' : 'MISSING'}`);
    if (!APPLY) continue;
    if (wfs?.length && clara) {
      const { error } = await sb.from('workflows').update({ agent_id: clara.id }).eq('agent_id', sofia.id);
      if (!error) rehomed += wfs.length; else console.log(`    ! workflow re-home failed: ${error.message}`);
    }
    if (skills?.length) {
      const { error } = await sb.from('agent_skills').delete().eq('agent_id', sofia.id);
      if (!error) skillsDropped += skills.length; else console.log(`    ! skills drop failed: ${error.message}`);
    }
    const { error: deErr } = await sb.from('custom_agents').update({ is_active: false }).eq('id', sofia.id);
    if (!deErr) deactivated++; else console.log(`    ! deactivate failed: ${deErr.message}`);
  }
  if (APPLY) {
    const { data: conns, error } = await sb.from('integration_connections').delete()
      .eq('provider', 'slack-sofia').select('id');
    if (!error) slackDropped = conns?.length ?? 0; else console.log(`  ! slack rows: ${error.message}`);
  }
  // ── THE LUCA REBRAND REACHES EXISTING ROWS (the seed is insert-only — without this, every
  // existing user's Luca keeps the LinkedIn-era instructions/description in the DB, which the
  // UI and the native loop read; worker instructions are not user-editable, so overwrite-safe). ──
  const { buildWorkers } = await import('@/lib/workers/seed');
  const luca = buildWorkers('x').find((w) => w.worker_role === 'branding_expert')!;
  const { data: lucas, error: lucaErr } = APPLY
    ? await sb.from('custom_agents')
        .update({ instructions: luca.instructions, description: luca.description, conversation_starters: luca.conversation_starters })
        .in('worker_role', ['linkedin_drafter', 'branding_expert']).eq('is_worker', true).select('id')
    : { data: [], error: null };
  if (lucaErr) console.log(`  ! luca rebrand: ${lucaErr.message}`);
  else if (APPLY) console.log(`  luca rows rebranded: ${lucas?.length ?? 0}`);
  console.log(`${APPLY ? 'APPLIED' : 'WOULD APPLY'}: deactivated=${deactivated} workflowsRehomed=${rehomed} skillsDropped=${skillsDropped} slackConnectionsDropped=${slackDropped}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
