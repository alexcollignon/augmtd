// ════════════════════════════════════════════════════════════════════════════════════════════════
// "AHK Tender Matching" — the owner's test workflow row. Idempotent: find-by-name, update in place.
//
//   npx tsx --env-file=.env.local scripts/tmp-ahk-matching-workflow.ts [--apply] [--run]
//
// THE RELAY, two readable steps: a generic source (get_pt_tenders, structured output ON) hands the
// week's announcements over the match-items fence; a generic matcher (match_to_profiles) matches
// them against the member-profile folder and writes the report. Neither step is client-branded.
//
// ⚠️ Step 2 ships with dedupe:false so the owner can run it repeatedly while testing. Before real
//    weekly operation this MUST flip to true, or the Chamber is told about the same tender forever.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const OWNER = '08fe4449-e5eb-431d-9156-02e9324e5903';
const FORBIDDEN = ['9d3921b2', 'de4e8824'];
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
      // The relay's handoff: the fence the matcher reads. Without it step 2 has nothing to match.
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
      // THE USER'S OWN NOUN for what that folder holds — it rides verbatim into the report's
      // profile-side headings ("Tenders with matching member companies").
      folder_noun: 'member companies',
      max_matches_per_item: 5,
      // THE CHAMBER'S OWN LENS, stated where a lens belongs — the user's config, not the generic
      // judge prompt. English, because this row's report language is 'en'.
      criteria:
        'Match only companies that could realistically bid: their stated activity must cover ' +
        'the tender\'s actual scope. Size must be plausible for the contract value: a company ' +
        'under 10 people is not a strong fit for contracts above roughly EUR 1 million unless ' +
        'its profile states comparable large projects; grade such cases possible at best. ' +
        'One excellent match beats five loose ones.',
      // THE LOCALE PASS: the step names its own report language, outranking output_config's.
      language: 'en',
      dedupe: false, // ⚠️ TESTING ONLY — flip to true before weekly operation
    },
  },
];

const TRIGGER = { type: 'schedule', cron: '0 8 * * 1', label: 'Every Monday at 8am', timezone: 'Europe/Lisbon' };
// Delivery (owner call, Sep 2): the report arrives as an EMAIL FROM MAX (the research coworker,
// same coworker that delivers the AHK briefing) with the document attached — no email_to set,
// so the lane defaults to the owner's login email.
const MAX_AGENT_ID = '01d60588-65da-419b-90e3-3380cf7ea07d';
const OUTPUT = { destination: 'email', email_as_attachment: true, artifact_type: 'document', report_mode: 'each_run', output_language: 'de', title_template: 'Tender Radar — {{date}}' };

/** Next Monday 08:00 Lisbon, expressed in UTC (Lisbon is UTC+1 in September). */
function nextMonday0800(): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 7, 0, 0));
  do { d.setUTCDate(d.getUTCDate() + 1); } while (d.getUTCDay() !== 1);
  return d.toISOString();
}

(async () => {
  if (FORBIDDEN.some((p) => OWNER.startsWith(p))) throw new Error('client account — refused');

  const { data: existing } = await sb.from('workflows')
    .select('id, name, status').eq('user_id', OWNER).eq('name', NAME).maybeSingle();

  const row = {
    user_id: OWNER, name: NAME,
    description:
      'Weekly matching of open Portuguese public tenders (Portal BASE) against the AHK member ' +
      'profiles in the "AHK Member companies" knowledge folder. Output: the German weekly report ' +
      'with evidence-backed member matches.',
    icon: 'bolt', color: 'emerald', status: 'active',
    steps: STEPS as never, trigger: TRIGGER as never, output_config: OUTPUT as never,
    agent_id: MAX_AGENT_ID,
    next_run_at: nextMonday0800(), skill_ids: [] as never,
    updated_at: new Date().toISOString(),
  };

  console.log(`\n═══ ${NAME} — ${APPLY ? 'APPLY' : 'dry run'} · owner ${OWNER.slice(0, 8)}`);
  console.log(existing ? `exists: ${existing.id} (${existing.status}) → update in place` : 'not found → create');
  console.log(JSON.stringify({ trigger: TRIGGER, output: OUTPUT, steps: STEPS }, null, 1));
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
