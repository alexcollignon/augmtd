// Smoke test for the persistent-task-thread + auto-pause arc (July 2026).
// Creates a synthetic single-step task for the target user, runs it 3× as a
// scheduled run through the REAL runWorkflow, and asserts:
//   1. all 3 runs share ONE thread, titled with the task name
//   2. 3 report-back messages append to it (+ notifications, all unseen)
//   3. run 3 auto-pauses the task (status/auto_paused_at/next_run_at=null,
//      in-character pause message + pause notification)
//   4. the unique index rejects a duplicate active thread (23505)
//   5. the review stamp + guarded resume update (route-equivalent statements)
//      flip it back to active with a recomputed next_run_at
// Then deletes the synthetic task (FK CASCADE removes runs + thread + notifs).
//
//   npx tsx scripts/smoke-task-threads.ts --email=you@example.com
//
// Cost/side effects: 3 small real AI calls (one per run). No Slack/email sends —
// the task's home is 'message'. If profiles.slack_dm_reports is on, up to 4
// short Slack DMs from the coworker may arrive (the report-back DM path).

import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { runWorkflow } from '@/lib/workflows/run-workflow';
import { nextRunFromTrigger } from '@/lib/workflows/schedule';

const emailArg = process.argv.find((a) => a.startsWith('--email='))?.split('=')[1];
if (!emailArg) { console.error('Usage: npx tsx scripts/smoke-task-threads.ts --email=<user email>'); process.exit(1); }

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

let failures = 0;
function check(label: string, ok: boolean, detail?: string) {
  console.log(`  ${ok ? '✓' : '✗ FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

async function main() {
  // Resolve user
  const { data: users } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const user = users?.users.find((u) => u.email?.toLowerCase() === emailArg!.toLowerCase());
  if (!user) { console.error(`No user with email ${emailArg}`); process.exit(1); }
  console.log(`[smoke] user ${user.id} (${emailArg})`);

  const { data: prof } = await admin.from('profiles').select('slack_dm_reports').eq('id', user.id).maybeSingle();
  if (prof?.slack_dm_reports) console.log('[smoke] note: slack_dm_reports is ON — a few short coworker DMs may arrive.');

  // Attribute to a worker if one exists (persona for the pause message)
  const { data: agent } = await admin.from('custom_agents')
    .select('id, name').eq('user_id', user.id).eq('is_worker', true).eq('worker_role', 'research_analyst').maybeSingle();

  // Synthetic task: one trivial AI step, message home (no external delivery)
  const trigger = { type: 'schedule', cron: '0 9 * * 1', timezone: 'UTC' };
  const { data: wf, error: wfErr } = await admin.from('workflows').insert({
    user_id: user.id,
    name: 'SMOKE — task thread test',
    description: 'Synthetic task created by scripts/smoke-task-threads.ts; safe to delete.',
    status: 'active',
    trigger,
    steps: [{ id: 'smoke-1', type: 'ai', label: 'Say ok', prompt: 'Reply with exactly: "Smoke test output." and nothing else.', model_tier: 'fast' }],
    output_config: {},          // → home 'message', report_mode 'each_run'
    agent_id: agent?.id ?? null,
  }).select('id').single();
  if (wfErr || !wf) { console.error('Failed to create synthetic workflow:', wfErr?.message); process.exit(1); }
  const wfId = wf.id as string;
  console.log(`[smoke] created synthetic task ${wfId}${agent ? ` (attributed to ${agent.name})` : ''}`);

  try {
    // ── 3 scheduled runs through the real engine ──
    const threadIds: (string | null)[] = [];
    for (let i = 1; i <= 3; i++) {
      const res = await runWorkflow({ workflowId: wfId, triggerSource: 'schedule' });
      threadIds.push(res.threadId);
      console.log(`[smoke] run ${i}: ${res.status} thread=${res.threadId}`);
      check(`run ${i} succeeded`, res.status === 'succeeded', res.error);
    }
    check('all 3 runs share one thread', !!threadIds[0] && threadIds.every((t) => t === threadIds[0]));
    const threadId = threadIds[0]!;

    const { data: thread } = await admin.from('work_threads').select('title, status, artifacts').eq('id', threadId).single();
    check('thread title = task name', thread?.title === 'SMOKE — task thread test', `got "${thread?.title}"`);

    // ── auto-pause on run 3 ──
    const { data: wfAfter } = await admin.from('workflows')
      .select('status, auto_paused_at, next_run_at').eq('id', wfId).single();
    check('task auto-paused after 3 unreviewed runs', wfAfter?.status === 'paused' && !!wfAfter?.auto_paused_at,
      `status=${wfAfter?.status} auto_paused_at=${wfAfter?.auto_paused_at}`);
    check('next_run_at cleared on pause', wfAfter?.next_run_at === null, `got ${wfAfter?.next_run_at}`);

    const { data: msgs } = await admin.from('work_messages')
      .select('content').eq('thread_id', threadId).eq('role', 'assistant').order('created_at');
    const pauseMsg = (msgs ?? []).find((m) => (m.content as string).includes("I'm pausing"));
    check('4 assistant messages in the shared thread (3 reports + pause)', (msgs ?? []).length === 4, `got ${msgs?.length}`);
    check('in-character pause message present', !!pauseMsg);

    const { data: notifs } = await admin.from('workflow_notifications')
      .select('id, seen').eq('workflow_id', wfId);
    check('4 notifications (3 reports + pause), all unseen', (notifs ?? []).length === 4 && (notifs ?? []).every((n) => !n.seen), `got ${notifs?.length}`);

    // ── unique index rejects a duplicate active thread ──
    const { error: dupErr } = await admin.from('work_threads')
      .insert({ user_id: user.id, title: 'dup', workflow_id: wfId, status: 'active' });
    check('unique index rejects duplicate active thread (23505)', dupErr?.code === '23505', `got ${dupErr?.code ?? 'no error'}`);

    // ── review stamp + auto-resume (route-equivalent statements) ──
    await admin.from('workflow_runs').update({ reviewed_at: new Date().toISOString() })
      .eq('workflow_id', wfId).eq('user_id', user.id).eq('status', 'succeeded').is('reviewed_at', null);
    await admin.from('workflow_notifications').update({ seen: true })
      .eq('workflow_id', wfId).eq('user_id', user.id).eq('seen', false);
    const nextRun = nextRunFromTrigger(trigger, new Date());
    const { data: resumed } = await admin.from('workflows')
      .update({ status: 'active', auto_paused_at: null, next_run_at: nextRun ? nextRun.toISOString() : null })
      .eq('id', wfId).eq('status', 'paused').not('auto_paused_at', 'is', null)
      .select('status, auto_paused_at, next_run_at');
    check('guarded resume update matched the auto-paused row', (resumed ?? []).length === 1);
    check('resumed: active + marker cleared + next_run_at recomputed',
      resumed?.[0]?.status === 'active' && resumed?.[0]?.auto_paused_at === null && !!resumed?.[0]?.next_run_at);

    const { data: unreviewed } = await admin.from('workflow_runs')
      .select('id').eq('workflow_id', wfId).is('reviewed_at', null);
    check('no unreviewed runs left after stamp', (unreviewed ?? []).length === 0, `got ${unreviewed?.length}`);
  } finally {
    // ── cleanup: delete the synthetic task; FKs cascade runs, thread, notifs ──
    await admin.from('workflows').delete().eq('id', wfId);
    const { data: leftoverThreads } = await admin.from('work_threads').select('id').eq('workflow_id', wfId);
    const { data: leftoverRuns } = await admin.from('workflow_runs').select('id').eq('workflow_id', wfId);
    console.log(`[smoke] cleanup: workflow deleted; leftover threads=${leftoverThreads?.length ?? 0} runs=${leftoverRuns?.length ?? 0}`);
  }

  console.log(failures === 0 ? '\n[smoke] ALL CHECKS PASSED' : `\n[smoke] ${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
