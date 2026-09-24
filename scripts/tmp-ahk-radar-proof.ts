// Email-free proof: for each target's tender workflow, clone it onto a throwaway message/silent
// row, run it in test mode, confirm a real English match report is produced, and confirm NO email
// was sent (email_sends count unchanged). The live rows are never executed. Delete the clone after.
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const TARGETS = [
  { name: 'Thorsten', uid: '9d3921b2-5a52-4b5b-9815-bc49d37ce0a7', wf: '8355952a-c2e8-4cb7-98f6-4c4af4a43e42' },
  { name: 'Dummy',    uid: 'de4e8824-9795-4876-995c-c0740b8f07ee', wf: '583d18a9' }, // prefix; resolve below
];

async function proveOne(t: { name: string; uid: string; wf: string }) {
  // resolve the live row (dummy wf is a prefix)
  const { data: live } = await sb.from('workflows').select('*').eq('user_id', t.uid).ilike('name', '%Tender Matching%').limit(1).maybeSingle();
  if (!live) { console.log(`✗ ${t.name}: no tender workflow`); return; }

  const { count: before } = await sb.from('email_sends').select('id', { count: 'exact', head: true }).eq('user_id', t.uid);

  // clone → message/silent (never email), dedupe already false
  const steps = JSON.parse(JSON.stringify(live.steps));
  const { data: clone, error: ce } = await sb.from('workflows').insert({
    user_id: t.uid, name: `${live.name} — proof (delete)`, description: 'email-free proof',
    icon: 'shield', color: 'indigo', status: 'active', trigger: { type: 'manual' }, steps,
    output_config: { destination: 'message', report_mode: 'silent', output_language: 'en' },
    agent_id: (live as { agent_id?: string }).agent_id ?? null,
  }).select('id').single();
  if (ce || !clone) { console.log(`✗ ${t.name}: clone failed ${ce?.message}`); return; }
  const cloneId = clone.id as string;

  try {
    const { runWorkflow } = await import('../lib/workflows/run-workflow');
    const t0 = Date.now();
    const run = await runWorkflow({ workflowId: cloneId, triggerSource: 'manual', isTest: true });
    const { data: rr } = await sb.from('workflow_runs').select('status, step_outputs, error').eq('id', run.runId).maybeSingle();
    const outs = (rr?.step_outputs ?? []) as Array<{ output?: string }>;
    const report = String(outs[outs.length - 1]?.output ?? '');
    const header = report.split('\n').filter(Boolean).slice(0, 4).join(' / ');
    const matchLines = (report.match(/^- \*\*\[/gm) || []).length;

    const { count: after } = await sb.from('email_sends').select('id', { count: 'exact', head: true }).eq('user_id', t.uid);

    console.log(`\n═══ ${t.name} ═══`);
    console.log(`  run: ${run.status} in ${Math.round((Date.now() - t0) / 1000)}s${run.error ? ' · ' + run.error : ''}`);
    console.log(`  report header: ${header.slice(0, 180)}`);
    console.log(`  match lines: ${matchLines}`);
    console.log(`  email_sends: before ${before} / after ${after}  → ${before === after ? 'NO EMAIL SENT ✓' : 'EMAIL SENT ✗✗✗'}`);
    console.log(`  english check: ${/checked from the previous step|matching member companies|assessed/i.test(report) ? 'EN ✓' : 'not detected'}`);
  } finally {
    // delete the clone + its runs/threads
    const { data: threads } = await sb.from('work_threads').select('id').eq('workflow_id', cloneId);
    if (threads?.length) { const ids = threads.map(x => x.id); await sb.from('work_messages').delete().in('thread_id', ids); await sb.from('work_threads').delete().in('id', ids); }
    await sb.from('workflow_runs').delete().eq('workflow_id', cloneId);
    await sb.from('workflows').delete().eq('id', cloneId);
    console.log(`  (proof clone ${cloneId.slice(0, 8)} deleted)`);
  }
}

(async () => { for (const t of TARGETS) await proveOne(t); })().catch(e => { console.error('FAILED', e); process.exit(1); });
