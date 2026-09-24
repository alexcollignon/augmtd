// ════════════════════════════════════════════════════════════════════════════════════════════════
// "AHK Tender Matching" — the DUMMY/DEMO account (de4e8824) weekly tender radar. Mirrors Thorsten's
// reference radar (wf 8355952a on 9d3921b2) EXACTLY, except:
//   • dedupe = FALSE — this is a demo account; a run must be REPEATABLE (never marks tenders seen).
//   • delivery is an EMAIL FROM the DUMMY's own Max (research coworker); no email_to → login email.
//
//   npx tsx --env-file=.env.local scripts/tmp-ahk-dummy-radar.ts [--apply] [--run]
//
// Idempotent: find-by-name, update in place. Report language 'de', German folder noun.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// The DEMO target. This script provisions ONLY the dummy account.
const USER = 'de4e8824-9795-4876-995c-c0740b8f07ee';
const NAME = 'AHK Tender Matching';
const APPLY = process.argv.includes('--apply');
const RUN = process.argv.includes('--run');

const sb: SupabaseClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const STEPS = [
  {
    id: 'step_001',
    type: 'tool',
    tool: 'get_pt_tenders',
    label: 'Fetch open tenders (Portal BASE)',
    config: {
      days: 7,
      endpoint: 'announcements',
      min_value: 500000,
      structured_output: true,
    },
  },
  {
    id: 'step_002',
    type: 'tool',
    tool: 'match_to_profiles',
    label: 'Match to member profiles',
    config: {
      profiles_folder: 'AHK Member companies',
      // ENGLISH form (owner call) — headings read "Tenders with matching member companies".
      folder_noun: 'member companies',
      max_matches_per_item: 5,
      // THE CHAMBER'S OWN LENS — the owner's fairness-corrected criteria, VERBATIM.
      criteria:
        'Match only companies that could realistically bid: their stated activity must cover ' +
        'the tender\'s actual scope. Size must be plausible for the contract value: a company ' +
        'under 10 people is not a strong fit for contracts above roughly EUR 1 million unless ' +
        'its profile states comparable large projects; grade such cases possible at best. ' +
        'One excellent match beats five loose ones.',
      // ENGLISH report (owner call).
      language: 'en',
      // dedupe FALSE (owner call — both rows): the run is REPEATABLE, never marks tenders seen.
      dedupe: false,
    },
  },
];

const TRIGGER = { type: 'schedule', cron: '0 8 * * 1', label: 'Every Monday at 8am', timezone: 'Europe/Lisbon' };
// Delivery: EMAIL FROM the dummy's own Max, document attached; no email_to → login email.
const MAX_AGENT_ID = '39be0460-2a6d-4783-ac8a-7ff880ac7807';
const OUTPUT = { destination: 'email', email_as_attachment: true, artifact_type: 'document', report_mode: 'each_run', output_language: 'en', title_template: 'Tender Radar — {{date}}' };

/** Next Monday 08:00 Lisbon, expressed in UTC (Lisbon is UTC+1 in September). */
function nextMonday0800(): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 7, 0, 0));
  do { d.setUTCDate(d.getUTCDate() + 1); } while (d.getUTCDay() !== 1);
  return d.toISOString();
}

(async () => {
  if (!USER.startsWith('de4e8824')) throw new Error('this script provisions ONLY the dummy account (de4e8824)');

  // Confirm the dummy's Max exists (research_analyst worker)
  const { data: max } = await sb.from('custom_agents').select('id')
    .eq('user_id', USER).eq('worker_role', 'research_analyst').eq('is_worker', true).maybeSingle();
  if (!max || (max as { id: string }).id !== MAX_AGENT_ID) {
    throw new Error(`dummy Max mismatch — expected ${MAX_AGENT_ID}, got ${JSON.stringify(max)}`);
  }

  const { data: existing } = await sb.from('workflows')
    .select('id, name, status').eq('user_id', USER).eq('name', NAME).maybeSingle();

  const row = {
    user_id: USER, name: NAME,
    description:
      'Weekly match of open Portuguese public tenders (Portal BASE) against the AHK member ' +
      'profiles in the "AHK Member companies" knowledge folder. Output: the English weekly ' +
      'report with evidenced member matches. (Demo account: repeatable.)',
    icon: 'bolt', color: 'emerald', status: 'active',
    steps: STEPS as never, trigger: TRIGGER as never, output_config: OUTPUT as never,
    agent_id: MAX_AGENT_ID,
    next_run_at: nextMonday0800(), skill_ids: [] as never,
    updated_at: new Date().toISOString(),
  };

  console.log(`\n═══ ${NAME} — ${APPLY ? 'APPLY' : 'dry run'} · user ${USER.slice(0, 8)} (DUMMY/DEMO)`);
  console.log(existing ? `exists: ${existing.id} (${existing.status}) → update in place` : 'not found → create');
  console.log(JSON.stringify({ trigger: TRIGGER, output: OUTPUT, agent_id: MAX_AGENT_ID, dedupe: false, steps: STEPS }, null, 1));
  if (!APPLY) { console.log('\n(dry run — nothing written)\n'); return; }

  let id: string;
  if (existing) {
    const { error } = await sb.from('workflows').update(row).eq('id', existing.id);
    if (error) throw new Error(error.message);
    id = existing.id;
  } else {
    const { data, error } = await sb.from('workflows').insert(row).select('id').single();
    if (error || !data) throw new Error(error?.message ?? 'insert failed');
    id = data.id;
  }
  console.log(`\nworkflow: ${id}\nnext run: ${row.next_run_at}\n`);

  if (RUN) {
    const { runWorkflow } = await import('../lib/workflows/run-workflow');
    const t0 = Date.now();
    const res = await runWorkflow({ workflowId: id, triggerSource: 'manual' });
    console.log(`\nrun ${res.runId} — ${res.status} in ${Math.round((Date.now() - t0) / 1000)}s` +
      `${res.error ? ` · ${res.error}` : ''} · thread ${res.threadId ?? '—'}`);
  }
})().catch((e) => { console.error('\nFAILED:', e); process.exit(1); });
