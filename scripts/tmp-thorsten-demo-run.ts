// Produce a PERSISTED demo run on Thorsten's tender radar (results kept in his account to show),
// WITHOUT emailing the real client: the demo run's email goes to the OWNER; the standing config is
// then set to deliver to Thorsten's own email for real weekly operation.
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const THORSTEN = '9d3921b2-5a52-4b5b-9815-bc49d37ce0a7';
const WF = '8355952a-c2e8-4cb7-98f6-4c4af4a43e42';
const OWNER_EMAIL = 'alextcollignon@gmail.com';
const THORSTEN_EMAIL = 'thorsten-koetschau@ccila-portugal.com';
const APPLY = process.argv.includes('--apply');

(async () => {
  const { data: wf } = await sb.from('workflows').select('output_config').eq('id', WF).single();
  const base = wf!.output_config as Record<string, unknown>;
  // Identical delivery shape to the dummy (document attachment), recipient swapped per phase.
  const demoOut = { ...base, destination: 'email', email_as_attachment: true, artifact_type: 'document',
    report_mode: 'each_run', output_language: 'en', title_template: 'Tender Radar — {{date}}',
    email_to: [OWNER_EMAIL] };
  const standingOut = { ...demoOut, email_to: [THORSTEN_EMAIL] };

  console.log('demo-run recipient :', OWNER_EMAIL, '(safe — not the client)');
  console.log('standing recipient :', THORSTEN_EMAIL, '(his own email, for real Monday ops)');
  if (!APPLY) { console.log('\n(dry run — pass --apply to run)'); return; }

  const { count: before } = await sb.from('email_sends').select('id', { count: 'exact', head: true }).eq('user_id', THORSTEN);

  // Phase 1 — point the demo run at the owner, run it (persisted, KEPT).
  await sb.from('workflows').update({ output_config: demoOut }).eq('id', WF);
  const { runWorkflow } = await import('../lib/workflows/run-workflow');
  const t0 = Date.now();
  const run = await runWorkflow({ workflowId: WF, triggerSource: 'manual' });
  const { data: rr } = await sb.from('workflow_runs').select('status, step_outputs, error').eq('id', run.runId).maybeSingle();
  const outs = (rr?.step_outputs ?? []) as Array<{ output?: string }>;
  const report = String(outs[outs.length - 1]?.output ?? '');
  const header = report.split('\n').filter(Boolean).slice(0, 3).join(' / ');
  const matchLines = (report.match(/^- \*\*\[/gm) || []).length;

  // Phase 2 — set the STANDING config to Thorsten's own email for real weekly delivery.
  await sb.from('workflows').update({ output_config: standingOut }).eq('id', WF);

  const { count: after } = await sb.from('email_sends').select('id', { count: 'exact', head: true }).eq('user_id', THORSTEN);
  const { data: wfNow } = await sb.from('workflows').select('output_config, next_run_at, status').eq('id', WF).single();

  console.log('\n═══ RESULT ═══');
  console.log('run:', run.status, 'in', Math.round((Date.now() - t0) / 1000) + 's', run.error ? '· ' + run.error : '');
  console.log('run id (kept in history):', run.runId);
  console.log('report header:', header.slice(0, 170));
  console.log('match lines:', matchLines);
  console.log('email_sends under Thorsten:', before, '->', after, '(the demo email went to the OWNER, not the client)');
  console.log('standing delivery now:', JSON.stringify((wfNow!.output_config as Record<string, unknown>).email_to),
    '| status', wfNow!.status, '| next_run', wfNow!.next_run_at);
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
