// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE HANDOFF SUITE (permanent — Phase B of docs/processes-plan.md). A step that waits on a HUMAN
// TEAMMATE, gated end to end on TWO real probe users in one scratch company, through `runWorkflow`
// itself (no HTTP, no mocked AI — the suite makes ~12–16 real fast-tier calls by design: a gate
// that is only unit-true is not a gate).
//   H1  THE PARK LANDS EVERYTHING — the job-profile pipeline parks at the reviewer's gate: run row
//       parked with exactly the produced draft, the ASSIGNEE gets a `commitments` ask (source
//       'handoff', due from the SLA) and an `approval` component turn carrying handoff:true.
//   H2  THE DERIVATION ACROSS VIEWERS — the owner reads waiting_on_others with the name, the
//       assignee reads needs_you; and the GUARDRAIL OUTRANKS (a blocked-verify tail before a
//       handoff step is always the owner's hold).
//   H3  THE AUTHORIZATION TRUTH TABLE — owner yes · assignee yes · stranger NO (and no leak);
//       once the run is no longer parked, the assignee's grant is gone too.
//   H4  THE ASSIGNEE APPROVES — the run completes past exactly its own gate, the commitment
//       closes with resolved_at, and their room closes its own loop.
//   H5  REJECT — the run is held back, the commitment is dismissed, the closing turn is honest.
//   H6  THE SLA CHASE + THE CAP — a handoff older than sla_hours is nudged ONCE a day (double
//       sweep proves the cap; the owner's on-demand Nudge then reports capped).
//   H7  THE HIRING LOOP — TWO handoffs in one pipeline park SEQUENTIALLY: a resume passes only
//       its OWN gate, and both commitments close.
//   H8  VERIFY-GATE COEXISTENCE — the gate corrects and the human still gets their turn; the
//       corrected text is what reached the assignee's preview.
//   H9  TEST MODE — auto-passes and creates ZERO cross-user debris.
// Fixtures (workflows, runs, threads, commitments, room turns, nudge records, the scratch company,
// probe 3) are deleted in `finally`, and the suite ASSERTS zero leftovers on both probes. An
// interrupted run is safe to repeat: every fixture is named per-run and a sweep at start drains
// any orphan left by a previous crash.
// Run: npx tsx --env-file=.env.local scripts/smoke-handoffs.ts
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { resolveProbeUser } from './probe-user';
import type { StepOutput, WorkflowStep, OutputConfig, WorkflowTrigger, GateVerdict } from '@/lib/workflows/types';
import type { RunLike } from '@/lib/workflows/process-state';

const SAY = (t: string) => `Output exactly the following text and nothing else: "${t}"`;
const FIXTURE_TAG = 'handoff smoke fixture';
const PROBE_B_EMAIL = 'smoke-probe-2@augmtd-internal.test';
const PROBE_C_EMAIL = 'smoke-probe-3@augmtd-internal.test';
const COMPANY_NAME = 'Probe Handoffs Co';
const COMPANY_SLUG = 'probe-handoffs-co';

/** Mirrors resolveProbeUser for the extra probes (probe-user.ts stays untouched — it is shared
 *  infrastructure for twelve suites). Idempotent: found or created, then given a real profile. */
async function resolveExtraProbe(sb: SupabaseClient, email: string, fullName: string): Promise<string> {
  let id: string | null = null;
  for (let page = 1; page <= 5; page++) {
    const { data } = await sb.auth.admin.listUsers({ page, perPage: 200 });
    const found = data?.users?.find((u) => u.email === email);
    if (found) { id = found.id; break; }
    if (!data?.users?.length || data.users.length < 200) break;
  }
  if (!id) {
    const { data: created, error } = await sb.auth.admin.createUser({ email, email_confirm: true });
    if (error || !created?.user) throw new Error(`cannot provision ${email}: ${error?.message}`);
    id = created.user.id;
  }
  await sb.from('profiles').upsert({ id, full_name: fullName, email }, { onConflict: 'id' }).then(() => {}, () => {});
  return id;
}

async function main() {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  let pass = 0, fail = 0;
  const ok = (name: string, cond: boolean, detail?: string) => {
    if (cond) { pass++; console.log(`  ✓ ${name}`); }
    else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
  };
  const note = (t: string) => console.log(`  · ${t}`);

  const ownerId = await resolveProbeUser(admin);
  const reviewerId = await resolveExtraProbe(admin, PROBE_B_EMAIL, 'Riley Probe');
  const strangerId = await resolveExtraProbe(admin, PROBE_C_EMAIL, 'No Relation');
  console.log(`probe A (owner) ${ownerId}\nprobe B (reviewer) ${reviewerId}\nprobe C (stranger) ${strangerId}`);

  // ── the scratch company (roster realism; the engine paths key on user ids) ────────────────────
  let companyId: string | null = null;
  let companyCreated = false;
  try {
    const { data: existing } = await admin.from('companies').select('id').eq('slug', COMPANY_SLUG).maybeSingle();
    if (existing?.id) companyId = String(existing.id);
    else {
      const { data: made, error } = await admin.from('companies')
        // join_code is NOT NULL + unique (20260414_workspace_overhaul) — the scratch code is
        // deliberately un-guessable-shaped and dies with the company.
        .insert({ name: COMPANY_NAME, slug: COMPANY_SLUG, join_code: 'PROBEHND' }).select('id').single();
      if (error || !made) throw new Error(error?.message ?? 'no row');
      companyId = String(made.id); companyCreated = true;
    }
    for (const [uid, role] of [[ownerId, 'owner'], [reviewerId, 'member']] as const) {
      await admin.from('company_members')
        .upsert({ company_id: companyId, user_id: uid, role, status: 'active' }, { onConflict: 'company_id,user_id' });
    }
    note(`scratch company ${companyId}${companyCreated ? ' (created)' : ' (reused)'} — both probes active members`);
  } catch (e) {
    note(`company plumbing skipped (${(e as Error).message}) — the engine paths key on user ids, not membership`);
  }

  // ── fixture helpers ──────────────────────────────────────────────────────────────────────────
  const stamp = Date.now();
  const createdWorkflows: string[] = [];
  const makeWorkflow = async (spec: {
    name: string; steps: WorkflowStep[]; trigger?: WorkflowTrigger; output_config?: OutputConfig;
  }): Promise<string> => {
    const { data, error } = await admin.from('workflows').insert({
      user_id: ownerId, name: spec.name, description: FIXTURE_TAG,
      icon: 'users', color: 'indigo', status: 'active',
      trigger: spec.trigger ?? { type: 'manual' },
      steps: spec.steps,
      output_config: spec.output_config ?? { destination: 'message', report_mode: 'silent' },
    }).select('id').single();
    if (error || !data) throw new Error(`workflow fixture failed: ${error?.message}`);
    createdWorkflows.push(data.id as string);
    return data.id as string;
  };

  type RunRow = { id: string; workflow_id: string; user_id: string; status: string; triggered_by: string | null;
    step_outputs: StepOutput[]; error: string | null; started_at: string | null; completed_at: string | null; created_at: string };
  const runRow = async (runId: string): Promise<RunRow | null> =>
    (await admin.from('workflow_runs')
      .select('id, workflow_id, user_id, status, triggered_by, step_outputs, error, started_at, completed_at, created_at')
      .eq('id', runId).maybeSingle()).data as RunRow | null;
  const textOf = (o?: StepOutput): string => typeof o?.output === 'string' ? o.output : JSON.stringify(o?.output ?? '');

  const handoffCommitments = async (runId: string) =>
    (await admin.from('commitments')
      .select('id, user_id, direction, description, counterparty, due_date, status, resolved_at, resolved_reason, created_at, source')
      .eq('source', 'handoff').eq('source_id', runId).order('created_at', { ascending: true })).data ?? [];

  const roomTurnsOfCommitment = async (userId: string, commitmentId: string) => {
    const { roomKeyForItem } = await import('@/lib/room/turns');
    const roomKey = await roomKeyForItem(admin, userId, 'commitment', commitmentId);
    const { data } = await admin.from('room_turns').select('id, text, component, dedupe_key, created_at')
      .eq('user_id', userId).eq('room_key', roomKey).order('created_at', { ascending: true });
    return (data ?? []) as Array<{ id: string; text: string; component: { key?: string; state?: Record<string, unknown> } | null; dedupe_key: string | null }>;
  };

  /** THE ONE DOOR, faithfully: exactly the sequence app/api/workflows/runs/[id]/resume/route.ts
   *  performs (authorize → claim → settle → resume), so the gate proves the shipped path. */
  const decide = async (runId: string, callerId: string, approved: boolean, note?: string) => {
    const { canResumeRun, settleHandoffDecision } = await import('@/lib/workflows/handoffs');
    const { runWorkflow } = await import('@/lib/workflows/run-workflow');
    const auth = await canResumeRun(admin, runId, callerId);
    if (!auth.ok || !auth.run || !auth.workflow) return { refused: true as const };
    if (auth.run.status !== 'awaiting_approval') return { conflict: String(auth.run.status) };
    const wf = auth.workflow;
    const handoffGate = Boolean(auth.step);
    const settle = async () => {
      if (!handoffGate) return;
      await settleHandoffDecision(admin, {
        runId, workflow: { id: wf.id, user_id: wf.user_id, name: wf.name, agent_id: wf.agent_id ?? null },
        callerId, approved,
      });
    };
    if (!approved) {
      await admin.from('workflow_runs').update({
        status: 'rejected', completed_at: new Date().toISOString(),
        error: note ? `Rejected by the user: ${note}` : 'Rejected by the user',
      }).eq('id', runId);
      await settle();
      return { status: 'rejected' as const };
    }
    await admin.from('workflow_runs').update({ status: 'running' }).eq('id', runId);
    await settle();
    const res = await runWorkflow({
      workflowId: auth.run.workflow_id, runId, triggerSource: 'manual', resumeFromApproval: true,
    });
    return { status: res.status, error: res.error };
  };

  // ── cleanup (also the START sweep — an interrupted run leaves nothing behind for the next) ────
  const cleanupWorkflows = async (wfIds: string[]) => {
    if (!wfIds.length) return;
    const { data: runs } = await admin.from('workflow_runs').select('id').in('workflow_id', wfIds);
    const runIds = (runs ?? []).map((r) => String(r.id));
    if (runIds.length) {
      const { data: comms } = await admin.from('commitments').select('id, user_id')
        .eq('source', 'handoff').in('source_id', runIds);
      const { roomKeyForItem } = await import('@/lib/room/turns');
      for (const c of comms ?? []) {
        const roomKey = await roomKeyForItem(admin, String(c.user_id), 'commitment', String(c.id));
        await admin.from('room_turns').delete().eq('user_id', String(c.user_id)).eq('room_key', roomKey);
      }
      if (comms?.length) await admin.from('commitments').delete().in('id', comms.map((c) => String(c.id)));
      await admin.from('item_plans').delete().eq('kind', 'handoff_nudge')
        .in('entity_id', runIds.flatMap((r) => [0, 1].map((d) =>
          `${r}:${new Date(Date.now() - d * 86400_000).toISOString().slice(0, 10)}`)));
      await admin.from('activity_events').delete().eq('entity_type', 'workflow_run').in('entity_id', runIds);
    }
    // the owner's standing-binding commitments + their rooms (only if a binding was ever made)
    const { data: standing } = await admin.from('commitments').select('id, user_id')
      .eq('source', 'workflow').in('source_id', wfIds);
    if (standing?.length) {
      const { roomKeyForItem } = await import('@/lib/room/turns');
      for (const c of standing) {
        const roomKey = await roomKeyForItem(admin, String(c.user_id), 'commitment', String(c.id));
        await admin.from('room_turns').delete().eq('user_id', String(c.user_id)).eq('room_key', roomKey);
      }
      await admin.from('commitments').delete().in('id', standing.map((c) => String(c.id)));
    }
    const { data: threads } = await admin.from('work_threads').select('id').in('workflow_id', wfIds);
    if (threads?.length) {
      const ids = threads.map((t) => String(t.id));
      await admin.from('work_messages').delete().in('thread_id', ids);
      await admin.from('workflow_runs').update({ thread_id: null }).in('thread_id', ids);
      await admin.from('work_threads').delete().in('id', ids);
    }
    await admin.from('workflow_runs').delete().in('workflow_id', wfIds);
    await admin.from('workflows').delete().in('id', wfIds);
  };

  // START SWEEP — drain orphans from any interrupted previous run.
  {
    const { data: orphans } = await admin.from('workflows').select('id')
      .eq('user_id', ownerId).eq('description', FIXTURE_TAG);
    if (orphans?.length) {
      note(`draining ${orphans.length} orphan fixture workflow(s) from a previous run`);
      await cleanupWorkflows(orphans.map((w) => String(w.id)));
    }
  }

  const runIdsCreated: string[] = [];
  let h1Run = '';
  let askTextReported = '';
  let h8PreviewReported = '';

  try {
    const { runWorkflow } = await import('@/lib/workflows/run-workflow');
    const { canResumeRun, nudgeHandoff, sweepHandoffSLAs } = await import('@/lib/workflows/handoffs');
    const { parkedGateOf, deriveProcessRows } = await import('@/lib/workflows/process-state');

    const HR_ASK = 'Review the job profile for the Senior Data Analyst role';
    const jobProfileSteps: WorkflowStep[] = [
      { type: 'ai', id: 'h_draft', label: 'Draft the profile', model_tier: 'fast', output_format: 'text',
        prompt: SAY("JOB PROFILE — Senior Data Analyst. Mission: turn Acme Group's raw usage data into decisions. Requirements: SQL, dbt, stakeholder fluency.") },
      { type: 'handoff', id: 'h_review', label: 'Review the profile',
        assignee_user_id: reviewerId, assignee_name: 'Riley Probe', ask: HR_ASK, sla_hours: 24 },
      { type: 'ai', id: 'h_publish', label: 'Publish', model_tier: 'fast', output_format: 'text',
        prompt: SAY('FINAL: profile published to the hiring pack.') },
    ];
    const wfHR = await makeWorkflow({ name: `Job profiling — Acme Group [${stamp}]`, steps: jobProfileSteps });

    // ── H1 — the park lands everything ─────────────────────────────────────────────────────────
    console.log('\nH1 — the park lands everything:');
    const r1 = await runWorkflow({ workflowId: wfHR, triggerSource: 'manual', isTest: false });
    h1Run = r1.runId; runIdsCreated.push(r1.runId);
    ok('runWorkflow returns awaiting_approval', r1.status === 'awaiting_approval', `${r1.status} ${r1.error ?? ''}`);
    const row1 = await runRow(r1.runId);
    ok('the run row is parked', row1?.status === 'awaiting_approval', String(row1?.status));
    ok('exactly ONE step output snapshotted (the draft)', (row1?.step_outputs ?? []).length === 1,
      JSON.stringify((row1?.step_outputs ?? []).map((o) => o.step_id)));
    ok('the snapshotted output IS the job profile',
      /JOB PROFILE/i.test(textOf(row1?.step_outputs?.[0])), textOf(row1?.step_outputs?.[0]).slice(0, 120));

    const c1 = await handoffCommitments(r1.runId);
    const ask1 = c1[0];
    ok("the ASSIGNEE has exactly one open ask", c1.length === 1 && ask1?.status === 'open', JSON.stringify(c1.map((c) => c.status)));
    ok('the ask belongs to probe B', String(ask1?.user_id) === reviewerId, String(ask1?.user_id));
    ok("direction is you_owe (it's their debt)", ask1?.direction === 'you_owe', String(ask1?.direction));
    ok('source/source_id bind it to this run', ask1?.source === 'handoff', String(ask1?.source));
    const tomorrow = new Date(Date.now() + 86400_000).toISOString().slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    const dayAfter = new Date(Date.now() + 2 * 86400_000).toISOString().slice(0, 10);
    ok('due_date lands ~tomorrow from sla_hours 24',
      [today, tomorrow, dayAfter].includes(String(ask1?.due_date)), String(ask1?.due_date));
    askTextReported = String(ask1?.description ?? '');
    ok('the ask text carries the reviewer instruction', askTextReported.includes(HR_ASK), askTextReported);

    const turns1 = ask1 ? await roomTurnsOfCommitment(reviewerId, String(ask1.id)) : [];
    const card = turns1.find((t) => t.component?.key === 'approval');
    ok('an `approval` component turn sits in the assignee room', !!card, JSON.stringify(turns1.map((t) => t.component?.key)));
    ok('the card is marked handoff:true', card?.component?.state?.handoff === true, JSON.stringify(card?.component?.state));
    ok('the card carries THIS run', String(card?.component?.state?.runId) === r1.runId, String(card?.component?.state?.runId));
    ok('the card carries the ask as its instruction', String(card?.component?.state?.instruction) === HR_ASK,
      String(card?.component?.state?.instruction));
    ok('the card carries a preview of the produced draft',
      /JOB PROFILE/i.test(String(card?.component?.state?.preview ?? '')), String(card?.component?.state?.preview ?? '').slice(0, 80));
    console.log(`  ↳ probe B's ask: "${askTextReported}"`);
    console.log(`  ↳ probe B's room line: "${card?.text ?? ''}"`);

    const { data: binding } = await admin.from('commitments').select('id')
      .eq('user_id', ownerId).eq('source', 'workflow').eq('source_id', wfHR).eq('status', 'open').maybeSingle();
    if (binding?.id) {
      const ownerTurns = await roomTurnsOfCommitment(ownerId, String(binding.id));
      ok("the OWNER's room says who the wait is on",
        ownerTurns.some((t) => /waiting on Riley Probe/i.test(t.text)), JSON.stringify(ownerTurns.map((t) => t.text)));
    } else {
      ok('no standing binding on a manual workflow → no owner narration expected (park still landed)',
        row1?.status === 'awaiting_approval');
      note('owner standing narration SKIPPED — a manual workflow holds no standing commitment to narrate into');
    }

    // ── H2 — the derivation across viewers ─────────────────────────────────────────────────────
    console.log('\nH2 — the derivation across viewers:');
    const wfMap = new Map([[wfHR, { name: 'Job profiling — Acme Group', steps: jobProfileSteps }]]);
    const asRunLike = (r: RunRow): RunLike => ({
      id: r.id, workflow_id: r.workflow_id, status: r.status, triggered_by: r.triggered_by,
      step_outputs: r.step_outputs as unknown as RunLike['step_outputs'], error: r.error,
      started_at: r.started_at, completed_at: r.completed_at, created_at: r.created_at,
    });
    const ownerView = await deriveProcessRows(admin, ownerId, [asRunLike(row1!)], wfMap, undefined, ownerId);
    ok("the OWNER reads 'waiting_on_others'", ownerView[0]?.state === 'waiting_on_others', String(ownerView[0]?.state));
    ok('…and it names Riley Probe', ownerView[0]?.waitingOn?.name === 'Riley Probe', JSON.stringify(ownerView[0]?.waitingOn));
    const reviewerView = await deriveProcessRows(admin, ownerId, [asRunLike(row1!)], wfMap, undefined, reviewerId);
    ok("the ASSIGNEE reads 'needs_you'", reviewerView[0]?.state === 'needs_you', String(reviewerView[0]?.state));
    ok('…with no waitingOn line for them', !reviewerView[0]?.waitingOn, JSON.stringify(reviewerView[0]?.waitingOn));

    const blockedTail = [
      { step_id: 'x', step_type: 'ai', label: 'draft', output: 'x' },
      { step_id: 'g', step_type: 'verify', label: 'gate', output: 'x', verdict: { status: 'blocked' } as GateVerdict },
    ] as unknown as RunLike['step_outputs'];
    const guardrailSteps: WorkflowStep[] = [
      { type: 'ai', id: 'x', label: 'draft', model_tier: 'fast', output_format: 'text', prompt: 'x' },
      { type: 'verify', id: 'g', label: 'gate' },
      { type: 'handoff', id: 'h', label: 'review', assignee_user_id: reviewerId, assignee_name: 'Riley Probe' },
    ];
    const gate = parkedGateOf({ step_outputs: blockedTail }, guardrailSteps);
    ok('THE GUARDRAIL OUTRANKS: a blocked tail before a handoff is the OWNER\'s hold',
      gate.kind === 'guardrail' && !gate.assigneeUserId, JSON.stringify(gate));
    // …and the same tail WITHOUT the block reads the handoff it actually sits at (the law is the
    // block, not the shape): drop the verdict, keep the position.
    const cleanTail = [
      blockedTail![0],
      { step_id: 'g', step_type: 'verify', label: 'gate', output: 'x' },
    ] as unknown as RunLike['step_outputs'];
    const cleanGate = parkedGateOf({ step_outputs: cleanTail }, guardrailSteps);
    ok('…while the SAME position with a clean verdict reads handoff, named',
      cleanGate.kind === 'handoff' && cleanGate.assigneeUserId === reviewerId && cleanGate.assigneeName === 'Riley Probe',
      JSON.stringify(cleanGate));

    // ── H3 — the authorization truth table ─────────────────────────────────────────────────────
    console.log('\nH3 — the authorization truth table:');
    const authOwner = await canResumeRun(admin, h1Run, ownerId);
    ok('the OWNER may resume', authOwner.ok && authOwner.role === 'owner', JSON.stringify({ ok: authOwner.ok, role: authOwner.role }));
    ok('…and holds the handoff step', authOwner.step?.id === 'h_review', String(authOwner.step?.id));
    const authAssignee = await canResumeRun(admin, h1Run, reviewerId);
    ok('the ASSIGNEE may resume', authAssignee.ok && authAssignee.role === 'assignee', JSON.stringify({ ok: authAssignee.ok, role: authAssignee.role }));
    ok('…and holds the handoff step', authAssignee.step?.id === 'h_review', String(authAssignee.step?.id));
    const authStranger = await canResumeRun(admin, h1Run, strangerId);
    ok('a STRANGER is refused, with nothing leaked',
      authStranger.ok === false && authStranger.role === null && !authStranger.run && !authStranger.workflow,
      JSON.stringify({ ok: authStranger.ok, role: authStranger.role, run: !!authStranger.run }));

    // ── H4 — the assignee approves ─────────────────────────────────────────────────────────────
    console.log('\nH4 — the assignee approves:');
    const d4 = await decide(h1Run, reviewerId, true);
    ok('the decision resumed the run', 'status' in d4 && d4.status === 'succeeded', JSON.stringify(d4));
    const row4 = await runRow(h1Run);
    ok('the run row is succeeded', row4?.status === 'succeeded', String(row4?.status));
    ok('all three steps ran', (row4?.step_outputs ?? []).length === 3,
      JSON.stringify((row4?.step_outputs ?? []).map((o) => o.step_id)));
    const handoffOut = (row4?.step_outputs ?? []).find((o) => o.step_type === 'handoff');
    ok('the handoff step output is the approved marker', /\[Approved/i.test(textOf(handoffOut)), textOf(handoffOut));
    ok('the FINAL step delivered', /FINAL: profile published/i.test(textOf(row4?.step_outputs?.[2])),
      textOf(row4?.step_outputs?.[2]).slice(0, 120));
    const c4 = await handoffCommitments(h1Run);
    ok("the assignee's ask is CLOSED", c4[0]?.status === 'completed', String(c4[0]?.status));
    ok('…with a resolved_at stamp', !!c4[0]?.resolved_at, String(c4[0]?.resolved_at));
    const turns4 = await roomTurnsOfCommitment(reviewerId, String(c4[0]?.id));
    ok("the assignee's room closed its own loop",
      turns4.some((t) => /You approved/i.test(t.text)), JSON.stringify(turns4.map((t) => t.text)));
    const { data: binding4 } = await admin.from('commitments').select('id')
      .eq('user_id', ownerId).eq('source', 'workflow').eq('source_id', wfHR).eq('status', 'open').maybeSingle();
    if (binding4?.id) {
      const ownerTurns = await roomTurnsOfCommitment(ownerId, String(binding4.id));
      ok('the waited time is narrated to the owner',
        ownerTurns.some((t) => /approved/i.test(t.text)), JSON.stringify(ownerTurns.map((t) => t.text)));
    } else {
      note('waited-time narration SKIPPED — no standing binding on a manual workflow (the activity ledger still carries it)');
      const { data: acts } = await admin.from('activity_events').select('title, metadata')
        .eq('user_id', ownerId).eq('entity_type', 'workflow_run').eq('entity_id', h1Run);
      ok('…and the ACTIVITY LEDGER carries the decision + waited time',
        (acts ?? []).some((a) => /approved/i.test(String(a.title))), JSON.stringify(acts));
    }
    const authAfter = await canResumeRun(admin, h1Run, reviewerId);
    ok('H3 tail: once the run is no longer parked the assignee is refused',
      authAfter.ok === false && authAfter.role === null, JSON.stringify({ ok: authAfter.ok, role: authAfter.role }));

    // ── H5 — reject ────────────────────────────────────────────────────────────────────────────
    console.log('\nH5 — reject:');
    const r5 = await runWorkflow({ workflowId: wfHR, triggerSource: 'manual', isTest: false });
    runIdsCreated.push(r5.runId);
    ok('the fresh run parked again', r5.status === 'awaiting_approval', `${r5.status} ${r5.error ?? ''}`);
    const d5 = await decide(r5.runId, reviewerId, false, 'the mission line needs rework');
    ok('the decision recorded a rejection', 'status' in d5 && d5.status === 'rejected', JSON.stringify(d5));
    const row5 = await runRow(r5.runId);
    ok('the run row is rejected', row5?.status === 'rejected', String(row5?.status));
    ok('nothing beyond the draft ran', (row5?.step_outputs ?? []).length === 1, String((row5?.step_outputs ?? []).length));
    const c5 = await handoffCommitments(r5.runId);
    ok("the assignee's ask is DISMISSED", c5[0]?.status === 'dismissed', String(c5[0]?.status));
    ok('…for the honest reason', /held back/i.test(String(c5[0]?.resolved_reason ?? '')), String(c5[0]?.resolved_reason));
    const turns5 = await roomTurnsOfCommitment(reviewerId, String(c5[0]?.id));
    ok('the closing turn speaks held-back',
      turns5.some((t) => /held this back/i.test(t.text)), JSON.stringify(turns5.map((t) => t.text)));

    // ── H6 — the SLA chase + the cap ───────────────────────────────────────────────────────────
    console.log('\nH6 — the SLA chase and its cap:');
    const r6 = await runWorkflow({ workflowId: wfHR, triggerSource: 'manual', isTest: false });
    runIdsCreated.push(r6.runId);
    ok('the fresh run parked', r6.status === 'awaiting_approval', `${r6.status} ${r6.error ?? ''}`);
    const c6 = await handoffCommitments(r6.runId);
    await admin.from('commitments')
      .update({ created_at: new Date(Date.now() - 26 * 3600_000).toISOString() })
      .eq('id', String(c6[0]?.id));
    const nudgeRows = async () => (await admin.from('item_plans').select('id, entity_id')
      .eq('user_id', ownerId).eq('kind', 'handoff_nudge').eq('entity_id', `${r6.runId}:${today}`)).data ?? [];
    ok('no nudge before the sweep', (await nudgeRows()).length === 0);
    await sweepHandoffSLAs(admin);
    ok('the breached handoff was chased ONCE', (await nudgeRows()).length === 1, JSON.stringify(await nudgeRows()));
    await sweepHandoffSLAs(admin);
    ok('a second sweep the same day changes nothing (the cap)', (await nudgeRows()).length === 1, JSON.stringify(await nudgeRows()));
    const nudged = await nudgeHandoff(admin, r6.runId, { byUserId: ownerId });
    ok("the owner's on-demand Nudge reports capped", nudged.ok === false && nudged.capped === true, JSON.stringify(nudged));
    const strangerNudge = await nudgeHandoff(admin, r6.runId, { byUserId: strangerId });
    ok('a stranger cannot nudge', strangerNudge.ok === false, JSON.stringify(strangerNudge));
    await decide(r6.runId, ownerId, false, 'closing the SLA fixture');

    // ── H7 — the hiring loop, two human gates ──────────────────────────────────────────────────
    console.log('\nH7 — the hiring loop: two handoffs park sequentially:');
    const loopSteps: WorkflowStep[] = [
      { type: 'ai', id: 'l_draft', label: 'Draft the shortlist brief', model_tier: 'fast', output_format: 'text',
        prompt: SAY('SHORTLIST BRIEF: five applicants scored against the Senior Data Analyst profile.') },
      { type: 'handoff', id: 'l_screen', label: 'Screen the shortlist',
        assignee_user_id: reviewerId, assignee_name: 'Riley Probe', ask: 'Screen the shortlist' },
      { type: 'ai', id: 'l_mid', label: 'Advance the finalists', model_tier: 'fast', output_format: 'text',
        prompt: SAY('SHORTLIST: 3 candidates advanced.') },
      { type: 'handoff', id: 'l_offer', label: 'Approve the offer band',
        assignee_user_id: reviewerId, assignee_name: 'Riley Probe', ask: 'Approve the offer band' },
      { type: 'ai', id: 'l_final', label: 'Close the loop', model_tier: 'fast', output_format: 'text',
        prompt: SAY('OFFER: extended at the approved band.') },
    ];
    const wfLoop = await makeWorkflow({ name: `Data Analyst hiring — Q2 [${stamp}]`, steps: loopSteps });
    const r7 = await runWorkflow({ workflowId: wfLoop, triggerSource: 'manual', isTest: false });
    runIdsCreated.push(r7.runId);
    const row7a = await runRow(r7.runId);
    ok('gate 1 parks the run', r7.status === 'awaiting_approval' && row7a?.status === 'awaiting_approval', String(row7a?.status));
    ok('…after exactly the first step', (row7a?.step_outputs ?? []).length === 1, String((row7a?.step_outputs ?? []).length));
    ok('the parked gate is handoff #1',
      parkedGateOf({ step_outputs: row7a!.step_outputs as unknown as RunLike['step_outputs'] }, loopSteps).kind === 'handoff');
    const d7a = await decide(r7.runId, reviewerId, true);
    ok('the first approval did NOT finish the run', 'status' in d7a && d7a.status === 'awaiting_approval', JSON.stringify(d7a));
    const row7b = await runRow(r7.runId);
    ok('THE RESUME PASSES ONLY ITS OWN GATE — parked again', row7b?.status === 'awaiting_approval', String(row7b?.status));
    ok('…with three outputs behind it', (row7b?.step_outputs ?? []).length === 3,
      JSON.stringify((row7b?.step_outputs ?? []).map((o) => o.step_id)));
    ok('the middle step really ran', /SHORTLIST: 3 candidates advanced/i.test(textOf(row7b?.step_outputs?.[2])),
      textOf(row7b?.step_outputs?.[2]).slice(0, 120));
    const gate7b = parkedGateOf({ step_outputs: row7b!.step_outputs as unknown as RunLike['step_outputs'] }, loopSteps);
    ok('the parked gate is now handoff #2',
      gate7b.kind === 'handoff' && (loopSteps[(row7b!.step_outputs ?? []).length] as { id: string }).id === 'l_offer',
      JSON.stringify(gate7b));
    const c7mid = await handoffCommitments(r7.runId);
    ok('two asks exist — one closed, one open',
      c7mid.length === 2 && c7mid.filter((c) => c.status === 'open').length === 1,
      JSON.stringify(c7mid.map((c) => c.status)));
    const d7b = await decide(r7.runId, reviewerId, true);
    ok('the second approval completes the run', 'status' in d7b && d7b.status === 'succeeded', JSON.stringify(d7b));
    const row7c = await runRow(r7.runId);
    ok('all five steps ran', (row7c?.step_outputs ?? []).length === 5,
      JSON.stringify((row7c?.step_outputs ?? []).map((o) => o.step_id)));
    const c7 = await handoffCommitments(r7.runId);
    ok('BOTH asks closed', c7.length === 2 && c7.every((c) => c.status === 'completed'),
      JSON.stringify(c7.map((c) => c.status)));

    // ── H8 — verify-gate coexistence ───────────────────────────────────────────────────────────
    console.log('\nH8 — the gate corrects and the human still gets their turn:');
    const gateSteps: WorkflowStep[] = [
      { type: 'ai', id: 'v_src', label: 'Source table', model_tier: 'fast', output_format: 'text',
        prompt: SAY('Acme Group headcount: Q1 was 100 (one hundred). Q2 was 110 (one hundred and ten).') },
      { type: 'ai', id: 'v_draft', label: 'Draft the line', model_tier: 'fast', output_format: 'text',
        prompt: SAY('Acme Group headcount grew 25% from Q1 (100) to Q2 (110).') },
      { type: 'verify', id: 'v_gate', label: 'Delivery check' },
      { type: 'handoff', id: 'v_review', label: 'Sign off the figure',
        assignee_user_id: reviewerId, assignee_name: 'Riley Probe', ask: 'Sign off the headcount figure' },
      { type: 'ai', id: 'v_final', label: 'Publish', model_tier: 'fast', output_format: 'text',
        prompt: SAY('PUBLISHED: headcount note filed.') },
    ];
    const wfGate = await makeWorkflow({ name: `Headcount note — Acme Group [${stamp}]`, steps: gateSteps });
    const r8 = await runWorkflow({ workflowId: wfGate, triggerSource: 'manual', isTest: false });
    runIdsCreated.push(r8.runId);
    const row8 = await runRow(r8.runId);
    ok('the run parked (not completed)', r8.status === 'awaiting_approval', `${r8.status} ${r8.error ?? ''}`);
    ok('…with the gate behind it (3 outputs)', (row8?.step_outputs ?? []).length === 3,
      JSON.stringify((row8?.step_outputs ?? []).map((o) => o.step_type)));
    const verifyOut = (row8?.step_outputs ?? []).find((o) => o.step_type === 'verify');
    const v8 = verifyOut?.verdict as GateVerdict | undefined;
    ok('a verdict rides the verify step', !!v8, JSON.stringify(verifyOut?.verdict));
    ok('the gate CORRECTED (not blocked)', v8?.status === 'corrected', String(v8?.status));
    ok('IT PARKS AT THE HANDOFF, not the guardrail',
      parkedGateOf({ step_outputs: row8!.step_outputs as unknown as RunLike['step_outputs'] }, gateSteps).kind === 'handoff',
      JSON.stringify(parkedGateOf({ step_outputs: row8!.step_outputs as unknown as RunLike['step_outputs'] }, gateSteps)));
    const c8 = await handoffCommitments(r8.runId);
    const turns8 = await roomTurnsOfCommitment(reviewerId, String(c8[0]?.id));
    const card8 = turns8.find((t) => t.component?.key === 'approval');
    const preview8 = String(card8?.component?.state?.preview ?? '');
    h8PreviewReported = preview8;
    ok('the assignee got a preview', preview8.trim().length > 0, preview8.slice(0, 80));
    ok('THE CORRECTED TEXT is what reached them (10%, not 25%)',
      /\b10(\.0)?\s?%/.test(preview8) && !/\b25\s?%/.test(preview8), preview8.slice(0, 200));
    console.log(`  ↳ probe B's preview: "${preview8.replace(/\s+/g, ' ').slice(0, 200)}"`);
    await decide(r8.runId, ownerId, false, 'closing the gate-coexistence fixture');

    // ── H9 — test mode, zero debris ────────────────────────────────────────────────────────────
    console.log('\nH9 — test mode auto-passes and leaves no cross-user debris:');
    const countB = async () => {
      const { count: comms } = await admin.from('commitments').select('id', { count: 'exact', head: true }).eq('user_id', reviewerId);
      const { count: turns } = await admin.from('room_turns').select('id', { count: 'exact', head: true }).eq('user_id', reviewerId);
      const { count: nudges } = await admin.from('item_plans').select('id', { count: 'exact', head: true })
        .eq('user_id', ownerId).eq('kind', 'handoff_nudge');
      return { comms: comms ?? 0, turns: turns ?? 0, nudges: nudges ?? 0 };
    };
    const before = await countB();
    const r9 = await runWorkflow({ workflowId: wfHR, triggerSource: 'manual', isTest: true });
    runIdsCreated.push(r9.runId);
    ok('the test run SUCCEEDED (never parked)', r9.status === 'succeeded', `${r9.status} ${r9.error ?? ''}`);
    const row9 = await runRow(r9.runId);
    const h9Handoff = (row9?.step_outputs ?? []).find((o) => o.step_type === 'handoff');
    ok('the handoff auto-passed in test mode',
      /auto-passed in test mode/i.test(textOf(h9Handoff)), textOf(h9Handoff));
    ok('the final step still delivered', /FINAL: profile published/i.test(textOf(row9?.step_outputs?.[2])),
      textOf(row9?.step_outputs?.[2]).slice(0, 120));
    const after = await countB();
    ok('ZERO new commitments for the teammate', after.comms === before.comms, `${before.comms} → ${after.comms}`);
    ok('ZERO new room turns for the teammate', after.turns === before.turns, `${before.turns} → ${after.turns}`);
    ok('ZERO new nudge records', after.nudges === before.nudges, `${before.nudges} → ${after.nudges}`);
    ok('no handoff commitment exists for the test run', (await handoffCommitments(r9.runId)).length === 0);
  } catch (e) {
    fail++;
    console.log(`\n  ✗ SUITE THREW — ${(e as Error).message}\n${(e as Error).stack}`);
  } finally {
    console.log('\nCleanup:');
    await cleanupWorkflows(createdWorkflows);
    // best-effort: the coworker-email audit rows the park's notification may have written
    await admin.from('email_sends').delete().eq('user_id', ownerId).contains('recipients', [PROBE_B_EMAIL])
      .then(() => {}, () => {});

    // ZERO LEFTOVERS, asserted on BOTH probes.
    const { count: wfLeft } = await admin.from('workflows').select('id', { count: 'exact', head: true })
      .eq('user_id', ownerId).eq('description', FIXTURE_TAG);
    ok('no fixture workflows left', (wfLeft ?? 0) === 0, String(wfLeft));
    if (runIdsCreated.length) {
      const { count: runsLeft } = await admin.from('workflow_runs').select('id', { count: 'exact', head: true })
        .in('id', runIdsCreated);
      ok('no fixture runs left', (runsLeft ?? 0) === 0, String(runsLeft));
      const { count: commsLeft } = await admin.from('commitments').select('id', { count: 'exact', head: true })
        .eq('source', 'handoff').in('source_id', runIdsCreated);
      ok('no handoff commitments left on either probe', (commsLeft ?? 0) === 0, String(commsLeft));
      const { count: nudgeLeft } = await admin.from('item_plans').select('id', { count: 'exact', head: true })
        .eq('user_id', ownerId).eq('kind', 'handoff_nudge');
      ok('no nudge records left', (nudgeLeft ?? 0) === 0, String(nudgeLeft));
      const { count: actsLeft } = await admin.from('activity_events').select('id', { count: 'exact', head: true })
        .eq('entity_type', 'workflow_run').in('entity_id', runIdsCreated);
      ok('no activity receipts left', (actsLeft ?? 0) === 0, String(actsLeft));
    }
    const { count: bTurns } = await admin.from('room_turns').select('id', { count: 'exact', head: true }).eq('user_id', reviewerId);
    ok('probe B carries no room turns', (bTurns ?? 0) === 0, String(bTurns));
    const { count: bComms } = await admin.from('commitments').select('id', { count: 'exact', head: true }).eq('user_id', reviewerId);
    ok('probe B carries no commitments', (bComms ?? 0) === 0, String(bComms));

    // the scratch company + probe C are ours only when we made them.
    if (companyId) {
      await admin.from('company_members').delete().eq('company_id', companyId);
      if (companyCreated) await admin.from('companies').delete().eq('id', companyId);
      const { count: memLeft } = await admin.from('company_members').select('id', { count: 'exact', head: true })
        .eq('company_id', companyId);
      ok('scratch membership cleared', (memLeft ?? 0) === 0, String(memLeft));
    }
    await admin.auth.admin.deleteUser(strangerId).then(() => {}, () => {});
    const { data: cGone } = await admin.auth.admin.getUserById(strangerId);
    ok('probe C (the stranger) is gone', !cGone?.user, String(cGone?.user?.id));

    console.log(`\n${pass}/${pass + fail} passed`);
    if (askTextReported) console.log(`ASK (H1): "${askTextReported}"`);
    if (h8PreviewReported) console.log(`PREVIEW (H8): "${h8PreviewReported.replace(/\s+/g, ' ').slice(0, 240)}"`);
    process.exit(fail === 0 ? 0 : 1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
