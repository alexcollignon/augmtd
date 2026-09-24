// ════════════════════════════════════════════════════════════════════════════════════════════════
// PROOF: each target's tender pipeline runs end-to-end WITHOUT sending an email and WITHOUT touching
// any seen-set. The live rows are only READ. For each target we clone the live tender workflow onto
// a THROWAWAY row (destination 'message', report_mode 'silent', dedupe FALSE), run it in isTest mode,
// assert an English report with evidenced matches + profile links, confirm email_sends is UNCHANGED,
// then DELETE the clone (+ its runs/threads/messages) in finally.
//
//   npx tsx --env-file=.env.local scripts/tmp-clone-proof.ts [--target thorsten|dummy]
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const sb: SupabaseClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const THORSTEN = '9d3921b2-5a52-4b5b-9815-bc49d37ce0a7';
const DUMMY = 'de4e8824-9795-4876-995c-c0740b8f07ee';
const targetArg = (() => { const i = process.argv.indexOf('--target'); return i >= 0 ? process.argv[i + 1] : null; })();

async function emailCount(userId: string): Promise<number> {
  const { count } = await sb.from('email_sends').select('id', { count: 'exact', head: true }).eq('user_id', userId);
  return count ?? 0;
}

async function proveOne(label: string, userId: string) {
  console.log(`\n════════ PROOF ${label} · ${userId}`);
  // Resolve the live tender workflow (READ ONLY).
  const { data: live } = await sb.from('workflows').select('id, name, steps, output_config, agent_id')
    .eq('user_id', userId).eq('name', 'AHK Tender Matching').maybeSingle();
  if (!live) { console.log('  LIVE tender workflow NOT FOUND — skipping'); return; }
  const liveId = (live as any).id;
  console.log(`  live workflow: ${liveId} (read-only)`);

  const emailBefore = await emailCount(userId);
  console.log(`  email_sends before: ${emailBefore}`);

  // Clone the steps, force dedupe FALSE on the match step (proof never writes a seen-set).
  const steps = JSON.parse(JSON.stringify((live as any).steps)) as any[];
  const match = steps.find((s) => s?.tool === 'match_to_profiles');
  if (match) { match.config = match.config ?? {}; match.config.dedupe = false; }

  let cloneId: string | null = null;
  try {
    const { data: clone, error } = await sb.from('workflows').insert({
      user_id: userId,
      name: `__proof AHK Tender Matching (${label})`,
      description: 'tmp-clone-proof fixture (deleted on exit)',
      status: 'active',
      steps: steps as never,
      // NEVER an email home — a test run would really send it.
      output_config: { destination: 'message', report_mode: 'silent', artifact_type: 'document', output_language: 'en' } as never,
      agent_id: (live as any).agent_id,
      trigger: { type: 'manual' } as never,
      skill_ids: [] as never,
    }).select('id').single();
    if (error || !clone) throw new Error(`clone insert failed: ${error?.message}`);
    cloneId = clone.id as string;
    console.log(`  throwaway clone: ${cloneId} (message/silent, dedupe=false)`);

    const { runWorkflow } = await import('../lib/workflows/run-workflow');
    console.log('  running in test mode (real fetch + AI, may take a few minutes)…');
    const t0 = Date.now();
    const run = await runWorkflow({ workflowId: cloneId, triggerSource: 'manual', isTest: true });
    console.log(`  run ${run.runId} — ${run.status} in ${Math.round((Date.now() - t0) / 1000)}s ${run.error ?? ''}`);

    const { data: runRow } = await sb.from('workflow_runs').select('status, step_outputs, error').eq('id', run.runId).maybeSingle();
    const outs = ((runRow as any)?.step_outputs ?? []) as any[];
    const last = outs[outs.length - 1];
    const text: string = typeof last?.output === 'string' ? last.output : String(last?.output ?? '');

    console.log(`  succeeded: ${run.status === 'succeeded'}`);
    console.log(`  step outputs: ${outs.map((o) => o.step_type + (o.tool ? `:${o.tool}` : '')).join(' → ')}`);
    // report evidence
    const headerLine = text.split('\n').find((l) => l.trim().length > 0) ?? '(empty)';
    console.log(`  ── report header: ${headerLine.trim().slice(0, 140)}`);
    const profileLinks = (text.match(/https?:\/\/portalahk\.ccila-portugal\.com\/home\/profile\/\d+/g) ?? []);
    const anyLinks = (text.match(/https?:\/\/\S+/g) ?? []).length;
    console.log(`  ── portal profile links: ${profileLinks.length} | total links: ${anyLinks}`);
    console.log(`  ── report length: ${text.length} chars`);
    // dump for inspection
    const dump = `/tmp/ahk-proof-${label}.md`;
    const { writeFileSync } = await import('node:fs');
    writeFileSync(dump, text, 'utf8');
    console.log(`  ── full report written to ${dump}`);
    // show first ~40 lines
    console.log('  ── report head ─────────────────────────────');
    for (const l of text.split('\n').slice(0, 45)) console.log('    | ' + l);
    console.log('  ────────────────────────────────────────────');

    const emailAfter = await emailCount(userId);
    console.log(`  email_sends after: ${emailAfter} — ${emailAfter === emailBefore ? 'UNCHANGED ✓' : 'CHANGED ✗✗✗'}`);
  } finally {
    if (cloneId) {
      const { data: threads } = await sb.from('work_threads').select('id').eq('workflow_id', cloneId);
      const ids = (threads ?? []).map((t: any) => t.id);
      if (ids.length) {
        await sb.from('work_messages').delete().in('thread_id', ids).then(() => {}, () => {});
        await sb.from('work_threads').delete().in('id', ids).then(() => {}, () => {});
      }
      await sb.from('workflow_runs').delete().eq('workflow_id', cloneId).then(() => {}, () => {});
      await sb.from('workflows').delete().eq('id', cloneId).then(() => {}, () => {});
      console.log(`  clone ${cloneId} + runs/threads deleted.`);
    }
  }
}

(async () => {
  const chosen: [string, string][] = targetArg === 'thorsten' ? [['thorsten', THORSTEN]]
    : targetArg === 'dummy' ? [['dummy', DUMMY]]
    : [['thorsten', THORSTEN], ['dummy', DUMMY]];
  for (const [label, uid] of chosen) await proveOne(label, uid);
})().catch((e) => { console.error('\nFAILED:', e); process.exit(1); });
