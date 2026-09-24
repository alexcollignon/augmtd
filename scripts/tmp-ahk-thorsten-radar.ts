// ════════════════════════════════════════════════════════════════════════════════════════════════
// "AHK Tender Matching" — Thorsten's (AHK Portugal) weekly tender radar. A DELIBERATE, owner-
// authorized provisioning of a CLIENT account (9d3921b2). Idempotent: find-by-name, update in place.
//
//   npx tsx --env-file=.env.local scripts/tmp-ahk-thorsten-radar.ts [--apply] [--run]
//
// Mirrors the owner's reference radar (wf 5d820321 on 08fe4449) EXACTLY, except the account-specific
// bits: this is the AHK Chamber's real German deliverable, so the report language is 'de' and the
// seen-set dedupe is TRUE (a tender must surface once — real weekly operation, not the owner's
// testing loop). Delivery is an EMAIL FROM MAX (his research coworker) with the document attached;
// no email_to is set, so the lane defaults to his login email.
//
// ⚠️ dedupe:true means the proof --run marks its tenders SEEN — correct for weekly operation.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// The provisioning target: Thorsten, AHK Portugal. A CLIENT account — this script's whole purpose.
const USER = '9d3921b2-5a52-4b5b-9815-bc49d37ce0a7';
// The OTHER client account can NEVER be the target of this script, under any edit.
const NEVER = 'de4e8824';
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
      // profile-side German headings ("Ausschreibungen mit passenden Mitgliedsunternehmen").
      // German here, because this row's report language is 'de' (unlike the owner's EN test row,
      // whose noun was "member companies").
      folder_noun: 'Mitgliedsunternehmen',
      max_matches_per_item: 5,
      // THE CHAMBER'S OWN LENS — the owner's fairness-corrected criteria, VERBATIM (capability +
      // scale, NO German preference: every member is German-linked by membership, so stating it as
      // a preference only re-ranks the surface signal — the bias audit, Sep 2).
      criteria:
        'Match only companies that could realistically bid: their stated activity must cover ' +
        'the tender\'s actual scope. Size must be plausible for the contract value: a company ' +
        'under 10 people is not a strong fit for contracts above roughly EUR 1 million unless ' +
        'its profile states comparable large projects; grade such cases possible at best. ' +
        'One excellent match beats five loose ones.',
      // THE LOCALE PASS: the step names its own report language, outranking output_config's. GERMAN
      // — this is the AHK Chamber's deliverable.
      language: 'de',
      // ⚠️ REAL WEEKLY OPERATION: a tender surfaces once. The proof run marks its tenders seen.
      dedupe: true,
    },
  },
];

const TRIGGER = { type: 'schedule', cron: '0 8 * * 1', label: 'Every Monday at 8am', timezone: 'Europe/Lisbon' };
// Delivery: EMAIL FROM MAX (Thorsten's research coworker, the same one that delivers his AHK
// briefings) with the document attached — no email_to set, so the lane defaults to his login email.
const MAX_AGENT_ID = 'bd7461ab-9509-44c0-91b1-32720bd74571';
const OUTPUT = { destination: 'email', email_as_attachment: true, artifact_type: 'document', report_mode: 'each_run', output_language: 'de', title_template: 'Tender Radar — {{date}}' };

/** Next Monday 08:00 Lisbon, expressed in UTC (Lisbon is UTC+1 in September). */
function nextMonday0800(): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 7, 0, 0));
  do { d.setUTCDate(d.getUTCDate() + 1); } while (d.getUTCDay() !== 1);
  return d.toISOString();
}

(async () => {
  if (USER.startsWith(NEVER)) throw new Error('the hard-forbidden client account — refused');
  if (!USER.startsWith('9d3921b2')) throw new Error('this script provisions ONLY AHK Portugal (9d3921b2)');

  const { data: existing } = await sb.from('workflows')
    .select('id, name, status').eq('user_id', USER).eq('name', NAME).maybeSingle();

  const row = {
    user_id: USER, name: NAME,
    description:
      'Wöchentlicher Abgleich offener portugiesischer öffentlicher Ausschreibungen (Portal BASE) ' +
      'mit den AHK-Mitgliedsprofilen im Wissensordner "AHK Member companies". Ergebnis: der ' +
      'deutsche Wochenbericht mit belegten Mitglieder-Zuordnungen.',
    icon: 'bolt', color: 'emerald', status: 'active',
    steps: STEPS as never, trigger: TRIGGER as never, output_config: OUTPUT as never,
    agent_id: MAX_AGENT_ID,
    next_run_at: nextMonday0800(), skill_ids: [] as never,
    updated_at: new Date().toISOString(),
  };

  console.log(`\n═══ ${NAME} — ${APPLY ? 'APPLY' : 'dry run'} · user ${USER.slice(0, 8)} (AHK Portugal / Thorsten)`);
  console.log(existing ? `exists: ${existing.id} (${existing.status}) → update in place` : 'not found → create');
  console.log(JSON.stringify({ trigger: TRIGGER, output: OUTPUT, agent_id: MAX_AGENT_ID, steps: STEPS }, null, 1));
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
