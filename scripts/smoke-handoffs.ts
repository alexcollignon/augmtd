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
// Phase B2 — THE PEOPLE SLICE (owner + reassign) and THE METRICS TAB:
//   H10 THE OWNER SPLIT — owner ≠ creator: the store moves accountability while `workflows.user_id`
//       (the execution identity) never moves; the standing debt follows the owner (the old row
//       closes 'ownership moved'); a dismissal STICKS across the move; both creator and
//       accountability owner hold owner rights on a parked run, a stranger holds none.
//   H11 REASSIGN, THE FULL TRUTH TABLE — the per-run override moves the gate WITHOUT touching the
//       authored steps (byte-identical); the old ask dies honestly, the new person gets the same
//       ask a park would have given them; authorization flips; the SERVED ledger row speaks the
//       current holder; same-person and non-owner callers are refused.
//   H12 REASSIGN BACK — the rev law: handing a step back to someone who already held it opens a
//       FRESH ask (dedupe :r2), never an overwrite of the closed one.
//   H13 SLA + NUDGE FOLLOW THE OVERRIDE — the chase names the CURRENT holder; the person it left
//       hears nothing new.
//   H14 THE METRICS ROUTE — source + honesty floors (the route is auth'd, so its SUBSTANCE is
//       gated: real usage columns, the one gateDeltaOf derivation, an authored-never-guessed
//       baseline, the null-usage degradation, and the client's "your estimate" labelling).
// Fixtures (workflows, runs, threads, commitments, room turns, nudge records, owner/override
// stores, the scratch company, probe 3) are deleted in `finally`, and the suite ASSERTS zero
// leftovers on all three probes. An
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
  // Probe C plays TWO parts, in this order: the OUTSIDER of H3 (no grant of any kind — the
  // authorization gate is about grants, never about names), then the person a gate is REASSIGNED
  // to from H11 on. One extra user, both stories.
  const strangerId = await resolveExtraProbe(admin, PROBE_C_EMAIL, 'Jordan Probe');
  console.log(`probe A (creator) ${ownerId}\nprobe B (reviewer) ${reviewerId}\nprobe C (outsider → reassignee) ${strangerId}`);

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
    // Probe C joins the roster too: B2's reassign can only move a gate INSIDE the workspace (the
    // team boundary the reassign ROUTE enforces — see the H11 source floor).
    // BACKDATED MEMBERSHIPS: the workspace pick is now deterministic (oldest active membership
    // wins — the picker and the name-resolver share it), and the probes carry debris memberships
    // from other suites. Backdating makes THIS company the deterministic primary without ever
    // touching another suite's fixtures.
    for (const [uid, role] of [[ownerId, 'owner'], [reviewerId, 'member'], [strangerId, 'member']] as const) {
      await admin.from('company_members')
        .upsert({ company_id: companyId, user_id: uid, role, status: 'active', joined_at: '2020-01-01T00:00:00Z' }, { onConflict: 'company_id,user_id' });
    }
    note(`scratch company ${companyId}${companyCreated ? ' (created)' : ' (reused)'} — all three probes active members`);
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
      // B2 — the per-run assignee overrides (kind='handoff_override', entity_id `<runId>:<stepId>`,
      // keyed under the CREATOR). Every generation of a reassign shares the one row per step.
      for (const rid of runIds) {
        await admin.from('item_plans').delete()
          .eq('kind', 'handoff_override').like('entity_id', `${rid}:%`);
      }
    }
    // B2 — the owner store + its ledger receipt (kind='workflow_owner', entity_id = workflow id).
    await admin.from('item_plans').delete().eq('kind', 'workflow_owner').in('entity_id', wfIds);
    await admin.from('activity_events').delete().eq('entity_type', 'workflow').in('entity_id', wfIds);
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

    // ══ PHASE B2 — THE PEOPLE SLICE ═════════════════════════════════════════════════════════════
    const { ownerOf, ownersFor, setWorkflowOwner } = await import('@/lib/workflows/owner');
    const { overrideFor, overrideKey, reassignHandoff } = await import('@/lib/workflows/handoffs');
    const { syncStandingCommitment } = await import('@/lib/workflows/standing');

    type StandingRow = { id: string; user_id: string; status: string; resolved_reason: string | null; due_date: string | null };
    const standingRows = async (wfId: string): Promise<StandingRow[]> =>
      ((await admin.from('commitments').select('id, user_id, status, resolved_reason, due_date')
        .eq('source', 'workflow').eq('source_id', wfId)
        .order('created_at', { ascending: true })).data ?? []) as StandingRow[];
    /** The workflow row shaped exactly as the standing door reads it. */
    const wfRowFor = async (wfId: string) => (await admin.from('workflows')
      .select('id, user_id, name, status, trigger, next_run_at, agent_id').eq('id', wfId).maybeSingle()).data as
      { id: string; user_id: string; name: string; status: string; trigger: { type?: string } | null; next_run_at: string | null; agent_id: string | null };

    // ── H10 — THE OWNER SPLIT ──────────────────────────────────────────────────────────────────
    console.log('\nH10 — the owner split: accountability moves, execution identity does not:');
    const ownSteps: WorkflowStep[] = [
      { type: 'ai', id: 'o_draft', label: 'Draft the weekly note', model_tier: 'fast', output_format: 'text',
        prompt: SAY('WEEKLY NOTE: Acme Group pipeline steady; two renewals land next week.') },
      { type: 'approval', id: 'o_gate', label: 'Approve the note', instruction: 'Approve before it goes out' },
    ];
    const wfOwn = await makeWorkflow({
      name: `Weekly note — Acme Group [${stamp}]`, steps: ownSteps,
      trigger: { type: 'schedule', label: 'Weekly on Monday', cron: '0 9 * * 1' } as WorkflowTrigger,
    });
    await admin.from('workflows')
      .update({ next_run_at: new Date(Date.now() + 7 * 86400_000).toISOString() }).eq('id', wfOwn);

    const own0 = await ownerOf(admin, wfOwn, ownerId);
    ok('with no store row the CREATOR owns, and says so (explicit:false)',
      own0.userId === ownerId && own0.explicit === false, JSON.stringify(own0));
    await syncStandingCommitment(admin, await wfRowFor(wfOwn));
    const st0 = await standingRows(wfOwn);
    ok('the standing binding opens under the creator first',
      st0.length === 1 && st0[0].user_id === ownerId && st0[0].status === 'open',
      JSON.stringify(st0.map((s) => [s.user_id === ownerId ? 'A' : s.user_id === reviewerId ? 'B' : '?', s.status])));

    const moved = await setWorkflowOwner(admin, {
      workflowId: wfOwn, creatorUserId: ownerId, byUserId: ownerId,
      newOwnerUserId: reviewerId, newOwnerName: 'Riley Probe',
    });
    ok('setWorkflowOwner succeeds', moved.ok === true, JSON.stringify(moved));
    const own1 = await ownerOf(admin, wfOwn, ownerId);
    ok('ownerOf now resolves probe B, EXPLICITLY',
      own1.userId === reviewerId && own1.explicit === true, JSON.stringify(own1));
    const { data: wfAfterMove } = await admin.from('workflows').select('user_id').eq('id', wfOwn).maybeSingle();
    ok('THE SPLIT LAW: workflows.user_id (the execution identity) is UNTOUCHED',
      String((wfAfterMove as { user_id?: string } | null)?.user_id) === ownerId,
      String((wfAfterMove as { user_id?: string } | null)?.user_id));
    const ownersBatch = await ownersFor(admin, [{ id: wfOwn, user_id: ownerId }]);
    ok('the batch read agrees with the single read',
      ownersBatch.get(wfOwn)?.userId === reviewerId && ownersBatch.get(wfOwn)?.explicit === true,
      JSON.stringify(ownersBatch.get(wfOwn)));

    const st1 = await standingRows(wfOwn);
    const aRow = st1.find((s) => s.user_id === ownerId);
    const bRow = st1.find((s) => s.user_id === reviewerId);
    ok("THE DEBT FOLLOWS THE OWNER: probe B now carries the OPEN standing row",
      !!bRow && bRow.status === 'open', JSON.stringify(bRow));
    ok("…and the creator's row closed honestly ('ownership moved')",
      aRow?.status !== 'open' && aRow?.resolved_reason === 'ownership moved',
      JSON.stringify(aRow));
    if (aRow) {
      const aTurns = await roomTurnsOfCommitment(ownerId, String(aRow.id));
      ok('the room LOSING it was told (never a silent transfer)',
        aTurns.some((t) => /moved to Riley Probe/i.test(t.text)), JSON.stringify(aTurns.map((t) => t.text)));
    } else ok('the room LOSING it was told (never a silent transfer)', false, 'no creator standing row found');
    if (bRow) {
      const bTurns = await roomTurnsOfCommitment(reviewerId, String(bRow.id));
      ok('the room GAINING it was told, in the accountability words',
        bTurns.some((t) => /You now own/i.test(t.text) && /accountability/i.test(t.text)),
        JSON.stringify(bTurns.map((t) => t.text)));
    } else ok('the room GAINING it was told, in the accountability words', false, 'no owner standing row found');

    // the parked run: BOTH the creator and the accountability owner hold owner rights.
    const r10 = await runWorkflow({ workflowId: wfOwn, triggerSource: 'manual', isTest: false });
    runIdsCreated.push(r10.runId);
    ok('the owned workflow parks at its approval gate', r10.status === 'awaiting_approval', `${r10.status} ${r10.error ?? ''}`);
    const a10 = await canResumeRun(admin, r10.runId, ownerId);
    ok('THE CREATOR KEEPS OWNER RIGHTS', a10.ok && a10.role === 'owner', JSON.stringify({ ok: a10.ok, role: a10.role }));
    const b10 = await canResumeRun(admin, r10.runId, reviewerId);
    ok('THE ACCOUNTABILITY OWNER GAINS THEM', b10.ok && b10.role === 'owner', JSON.stringify({ ok: b10.ok, role: b10.role }));
    const c10 = await canResumeRun(admin, r10.runId, strangerId);
    ok('everyone else is still refused, with nothing leaked',
      c10.ok === false && c10.role === null && !c10.run && !c10.workflow, JSON.stringify({ ok: c10.ok, role: c10.role }));
    await decide(r10.runId, ownerId, false, 'closing the owner-split fixture');

    // THE DISMISSAL STICKS ACROSS THE MOVE — a human decision outranks the convergent door.
    if (bRow) {
      await admin.from('commitments').update({
        status: 'dismissed', resolved_reason: 'not mine to carry', resolved_at: new Date().toISOString(),
      }).eq('id', bRow.id);
      await syncStandingCommitment(admin, await wfRowFor(wfOwn));
      const st2 = await standingRows(wfOwn);
      const bAfter = st2.filter((s) => s.user_id === reviewerId);
      ok("the owner's dismissal STICKS — no resurrection on re-sync",
        bAfter.length === 1 && bAfter[0].status === 'dismissed', JSON.stringify(bAfter.map((s) => s.status)));
      ok('…and the move never re-opens a row for the creator either',
        st2.filter((s) => s.user_id === ownerId && s.status === 'open').length === 0,
        JSON.stringify(st2.map((s) => [s.user_id === ownerId ? 'A' : 'B', s.status])));
    } else {
      ok("the owner's dismissal STICKS — no resurrection on re-sync", false, 'no owner standing row to dismiss');
      ok('…and the move never re-opens a row for the creator either', false, 'no owner standing row to dismiss');
    }

    // ── H11 — REASSIGN, the full truth table ───────────────────────────────────────────────────
    console.log('\nH11 — reassign: the gate moves, the authored workflow does not:');
    const REASSIGN_ASK = 'Sign off the vendor security review';
    const reassignSteps: WorkflowStep[] = [
      { type: 'ai', id: 'x_draft', label: 'Draft the review', model_tier: 'fast', output_format: 'text',
        prompt: SAY('VENDOR REVIEW: Acme Group supplier passes SOC2; two low findings tracked.') },
      { type: 'handoff', id: 'x_sign', label: 'Sign off',
        assignee_user_id: reviewerId, assignee_name: 'Riley Probe', ask: REASSIGN_ASK, sla_hours: 24 },
      { type: 'ai', id: 'x_file', label: 'File it', model_tier: 'fast', output_format: 'text',
        prompt: SAY('FILED: vendor review archived.') },
    ];
    const wfReassign = await makeWorkflow({ name: `Vendor review — Acme Group [${stamp}]`, steps: reassignSteps });
    const stepsBefore = JSON.stringify((await admin.from('workflows').select('steps').eq('id', wfReassign).maybeSingle()).data?.steps);

    const r11 = await runWorkflow({ workflowId: wfReassign, triggerSource: 'manual', isTest: false });
    runIdsCreated.push(r11.runId);
    ok('the run parked at probe B\'s gate', r11.status === 'awaiting_approval', `${r11.status} ${r11.error ?? ''}`);
    const bAsk11 = (await handoffCommitments(r11.runId)).find((c) => String(c.user_id) === reviewerId);
    ok('probe B holds the open ask before the move', bAsk11?.status === 'open', String(bAsk11?.status));

    // (7a) a NON-owner cannot move a gate — not even the person currently holding it.
    const badByB = await reassignHandoff(admin, { runId: r11.runId, byUserId: reviewerId, newAssigneeUserId: strangerId });
    ok('the ASSIGNEE cannot reassign their own gate (non-owner, nothing leaked)',
      badByB.ok === false && 'status' in badByB && badByB.status === 404, JSON.stringify(badByB));

    const move11 = await reassignHandoff(admin, { runId: r11.runId, byUserId: ownerId, newAssigneeUserId: strangerId });
    ok('the OWNER may move it', move11.ok === true, JSON.stringify(move11));
    ok('…and it is the FIRST generation (rev 1)', move11.ok === true && move11.rev === 1, JSON.stringify(move11));

    // (1) the override store + the untouched authoring
    const ov11 = await overrideFor(admin, ownerId, r11.runId, 'x_sign');
    ok('the override row exists, keyed `<runId>:<stepId>`',
      !!ov11 && ov11.assigneeUserId === strangerId, JSON.stringify(ov11));
    ok('…at rev 1, stamped with who moved it', ov11?.rev === 1 && ov11?.by === ownerId, JSON.stringify(ov11));
    const { data: ovRaw } = await admin.from('item_plans').select('entity_id')
      .eq('user_id', ownerId).eq('kind', 'handoff_override').eq('entity_id', overrideKey(r11.runId, 'x_sign')).maybeSingle();
    ok('…stored under the CREATOR (the execution identity keeps the bookkeeping)', !!ovRaw?.entity_id, JSON.stringify(ovRaw));
    const stepsAfter = JSON.stringify((await admin.from('workflows').select('steps').eq('id', wfReassign).maybeSingle()).data?.steps);
    ok('THE AUTHORED WORKFLOW IS BYTE-IDENTICAL (a per-run decision is not an authoring change)',
      stepsAfter === stepsBefore, `${stepsBefore?.length} → ${stepsAfter?.length}`);

    // (2) the old ask dies with its work
    const c11 = await handoffCommitments(r11.runId);
    const bClosed = c11.find((c) => String(c.user_id) === reviewerId);
    ok("probe B's ask CLOSED with the honest reason",
      bClosed?.status === 'completed' && bClosed?.resolved_reason === 'reassigned',
      JSON.stringify({ status: bClosed?.status, reason: bClosed?.resolved_reason }));
    const bMovedTurns = bClosed ? await roomTurnsOfCommitment(reviewerId, String(bClosed.id)) : [];
    ok("…and probe B's room says it moved on (never a row that silently vanishes)",
      bMovedTurns.some((t) => /moved to Jordan/i.test(t.text)), JSON.stringify(bMovedTurns.map((t) => t.text)));

    // (3) the new person gets exactly the ask a park would have given them
    const cAsk11 = c11.find((c) => String(c.user_id) === strangerId);
    ok('probe C has a FRESH open ask', cAsk11?.status === 'open' && cAsk11?.direction === 'you_owe',
      JSON.stringify({ status: cAsk11?.status, direction: cAsk11?.direction }));
    ok('…carrying the step\'s ask', String(cAsk11?.description ?? '').includes(REASSIGN_ASK), String(cAsk11?.description));
    const cTurns11 = cAsk11 ? await roomTurnsOfCommitment(strangerId, String(cAsk11.id)) : [];
    const cCard11 = cTurns11.find((t) => t.component?.key === 'approval');
    ok('…and the same `approval` card the park writes, marked handoff:true',
      cCard11?.component?.state?.handoff === true && String(cCard11?.component?.state?.runId) === r11.runId,
      JSON.stringify(cCard11?.component?.state));
    ok("…whose dedupe key carries the generation (':r1')",
      cCard11?.dedupe_key === `handoff:${r11.runId}:x_sign:r1`, String(cCard11?.dedupe_key));
    ok('…with the produced draft as its preview',
      /VENDOR REVIEW/i.test(String(cCard11?.component?.state?.preview ?? '')),
      String(cCard11?.component?.state?.preview ?? '').slice(0, 80));

    // (4) the authorization truth table flips
    const authC11 = await canResumeRun(admin, r11.runId, strangerId);
    ok('probe C may now resume, as the ASSIGNEE', authC11.ok && authC11.role === 'assignee',
      JSON.stringify({ ok: authC11.ok, role: authC11.role }));
    ok('…and canResumeRun names them as the current holder',
      authC11.assignee?.userId === strangerId && authC11.override?.rev === 1,
      JSON.stringify({ assignee: authC11.assignee, rev: authC11.override?.rev }));
    const authB11 = await canResumeRun(admin, r11.runId, reviewerId);
    ok('probe B — who held it a moment ago — is REFUSED',
      authB11.ok === false && authB11.role === null, JSON.stringify({ ok: authB11.ok, role: authB11.role }));
    const authA11 = await canResumeRun(admin, r11.runId, ownerId);
    ok('the owner still holds owner rights', authA11.ok && authA11.role === 'owner',
      JSON.stringify({ ok: authA11.ok, role: authA11.role }));

    // (5) THE SERVED LEDGER ROW speaks the CURRENT holder — the route's own patch shape,
    //     replicated over the pure pieces (the derivation stays override-free by design).
    const servedRow = async (viewerId: string) => {
      const row = (await runRow(r11.runId))!;
      const wfMapR = new Map([[wfReassign, { name: `Vendor review — Acme Group [${stamp}]`, steps: reassignSteps }]]);
      const rows = await deriveProcessRows(admin, ownerId, [asRunLike(row)], wfMapR, undefined, viewerId);
      const ov = await overrideFor(admin, ownerId, r11.runId, 'x_sign');
      const gate = parkedGateOf({ step_outputs: row.step_outputs as unknown as RunLike['step_outputs'] }, reassignSteps, ov);
      if (gate.kind !== 'handoff' || !gate.assigneeUserId) return rows[0];
      return gate.assigneeUserId === viewerId
        ? { ...rows[0], state: 'needs_you' as const, waitingOn: null }
        : { ...rows[0], state: 'waiting_on_others' as const, reason: undefined, waitingOn: { name: gate.assigneeName ?? 'a teammate' } };
    };
    const ownerServed = await servedRow(ownerId);
    ok("the ledger row the OWNER is served says waiting_on_others",
      ownerServed?.state === 'waiting_on_others', String(ownerServed?.state));
    ok('…naming probe C, NOT the person authored into the step',
      /Jordan/i.test(String(ownerServed?.waitingOn?.name ?? '')) && !/Riley/i.test(String(ownerServed?.waitingOn?.name ?? '')),
      JSON.stringify(ownerServed?.waitingOn));
    const cServed = await servedRow(strangerId);
    ok("the row probe C is served reads needs_you", cServed?.state === 'needs_you', String(cServed?.state));
    const bServed = await servedRow(reviewerId);
    ok("probe B is no longer told anything is on them",
      bServed?.state === 'waiting_on_others' && !/Riley/i.test(String(bServed?.waitingOn?.name ?? '')),
      JSON.stringify({ state: bServed?.state, waitingOn: bServed?.waitingOn }));
    console.log(`  ↳ served to the owner: "waiting on ${ownerServed?.waitingOn?.name}" (step still authored to Riley Probe)`);

    // (6) + (7b) the refusals
    const same11 = await reassignHandoff(admin, { runId: r11.runId, byUserId: ownerId, newAssigneeUserId: strangerId });
    ok('reassigning to the CURRENT holder is refused (409, honest words)',
      same11.ok === false && 'status' in same11 && same11.status === 409 && /already hold/i.test(same11.error),
      JSON.stringify(same11));
    const badByC = await reassignHandoff(admin, { runId: r11.runId, byUserId: strangerId, newAssigneeUserId: reviewerId });
    ok('the NEW assignee cannot reassign it onward either',
      badByC.ok === false && 'status' in badByC && badByC.status === 404, JSON.stringify(badByC));
    const routeSrc = await (await import('node:fs/promises')).readFile('app/api/workflows/runs/[id]/reassign/route.ts', 'utf8');
    ok('THE TEAM BOUNDARY is enforced at the one HTTP door (same active workspace, both people)',
      /company_members/.test(routeSrc) && /they are not in your workspace/.test(routeSrc));

    // the new holder decides, through the faithful resume sequence
    const d11 = await decide(r11.runId, strangerId, true);
    ok('probe C approves and the run completes', 'status' in d11 && d11.status === 'succeeded', JSON.stringify(d11));
    const c11done = await handoffCommitments(r11.runId);
    const cClosed = c11done.find((c) => String(c.user_id) === strangerId);
    ok("probe C's ask closed on approval", cClosed?.status === 'completed' && !!cClosed?.resolved_at,
      JSON.stringify({ status: cClosed?.status, at: cClosed?.resolved_at }));
    ok('…and probe B\'s reassigned row was never touched again',
      (await handoffCommitments(r11.runId)).find((c) => String(c.user_id) === reviewerId)?.resolved_reason === 'reassigned');

    // ── H12 — REASSIGN BACK (the rev law) ──────────────────────────────────────────────────────
    console.log('\nH12 — reassign back: a second generation, never an overwrite:');
    const r12 = await runWorkflow({ workflowId: wfReassign, triggerSource: 'manual', isTest: false });
    runIdsCreated.push(r12.runId);
    ok('a fresh run parks at probe B again (the authoring never changed)',
      r12.status === 'awaiting_approval', `${r12.status} ${r12.error ?? ''}`);
    const m12a = await reassignHandoff(admin, { runId: r12.runId, byUserId: ownerId, newAssigneeUserId: strangerId });
    ok('B → C is rev 1', m12a.ok === true && m12a.rev === 1, JSON.stringify(m12a));
    const m12b = await reassignHandoff(admin, { runId: r12.runId, byUserId: ownerId, newAssigneeUserId: reviewerId });
    ok('C → B (back again) is rev 2', m12b.ok === true && m12b.rev === 2, JSON.stringify(m12b));
    const ov12 = await overrideFor(admin, ownerId, r12.runId, 'x_sign');
    ok('the ONE override row now names probe B at rev 2',
      ov12?.assigneeUserId === reviewerId && ov12?.rev === 2, JSON.stringify(ov12));
    const c12 = await handoffCommitments(r12.runId);
    const bRows12 = c12.filter((c) => String(c.user_id) === reviewerId);
    ok('probe B has TWO rows — the closed one and a FRESH open ask', bRows12.length === 2,
      JSON.stringify(bRows12.map((c) => c.status)));
    ok("…the first closed 'reassigned', the second open",
      bRows12[0]?.status === 'completed' && bRows12[0]?.resolved_reason === 'reassigned' && bRows12[1]?.status === 'open',
      JSON.stringify(bRows12.map((c) => [c.status, c.resolved_reason])));
    const cRow12 = c12.find((c) => String(c.user_id) === strangerId);
    ok("probe C's middle ask closed 'reassigned' too",
      cRow12?.status === 'completed' && cRow12?.resolved_reason === 'reassigned',
      JSON.stringify({ status: cRow12?.status, reason: cRow12?.resolved_reason }));
    const bTurns12 = await roomTurnsOfCommitment(reviewerId, String(bRows12[1]?.id));
    const bCard12 = bTurns12.find((t) => t.component?.key === 'approval');
    ok("THE REV LAW: the new card is a NEW turn, dedupe ':r2' (no in-place overwrite)",
      bCard12?.dedupe_key === `handoff:${r12.runId}:x_sign:r2`, String(bCard12?.dedupe_key));
    const authB12 = await canResumeRun(admin, r12.runId, reviewerId);
    ok('probe B may resume again', authB12.ok && authB12.role === 'assignee', JSON.stringify({ ok: authB12.ok, role: authB12.role }));
    const authC12 = await canResumeRun(admin, r12.runId, strangerId);
    ok('probe C is refused again', authC12.ok === false && authC12.role === null,
      JSON.stringify({ ok: authC12.ok, role: authC12.role }));
    await decide(r12.runId, ownerId, false, 'closing the rev-law fixture');

    // ── H13 — SLA + NUDGE follow the override ──────────────────────────────────────────────────
    console.log('\nH13 — the chase names the CURRENT holder:');
    const slaSteps: WorkflowStep[] = [
      { type: 'ai', id: 's_draft', label: 'Draft the renewal note', model_tier: 'fast', output_format: 'text',
        prompt: SAY('RENEWAL NOTE: Acme Group contract renews next quarter.') },
      { type: 'handoff', id: 's_sign', label: 'Approve the renewal note',
        assignee_user_id: reviewerId, assignee_name: 'Riley Probe', ask: 'Approve the renewal note', sla_hours: 24 },
    ];
    const wfSla = await makeWorkflow({
      name: `Renewal note — Acme Group [${stamp}]`, steps: slaSteps,
      trigger: { type: 'schedule', label: 'Weekly on Friday', cron: '0 9 * * 5' } as WorkflowTrigger,
    });
    await admin.from('workflows')
      .update({ next_run_at: new Date(Date.now() + 5 * 86400_000).toISOString() }).eq('id', wfSla);
    await syncStandingCommitment(admin, await wfRowFor(wfSla));
    const slaStanding = (await standingRows(wfSla)).find((s) => s.status === 'open');
    ok('the SLA fixture has a standing room to narrate into', !!slaStanding && slaStanding.user_id === ownerId,
      JSON.stringify(slaStanding));

    const r13 = await runWorkflow({ workflowId: wfSla, triggerSource: 'manual', isTest: false });
    runIdsCreated.push(r13.runId);
    ok('the run parked at probe B', r13.status === 'awaiting_approval', `${r13.status} ${r13.error ?? ''}`);
    const m13 = await reassignHandoff(admin, { runId: r13.runId, byUserId: ownerId, newAssigneeUserId: strangerId });
    ok('the gate moved to probe C', m13.ok === true, JSON.stringify(m13));
    const cAsk13 = (await handoffCommitments(r13.runId)).find((c) => String(c.user_id) === strangerId && c.status === 'open');
    ok('probe C holds the open ask', !!cAsk13, JSON.stringify(cAsk13));
    // Backdate the CURRENT holder's ask past the SLA (their own clock — they were asked, then waited).
    await admin.from('commitments')
      .update({ created_at: new Date(Date.now() - 26 * 3600_000).toISOString() }).eq('id', String(cAsk13?.id));
    const bBefore13 = (await roomTurnsOfCommitment(reviewerId,
      String((await handoffCommitments(r13.runId)).find((c) => String(c.user_id) === reviewerId)?.id ?? ''))).length;
    const nudge13 = async () => (await admin.from('item_plans').select('id')
      .eq('user_id', ownerId).eq('kind', 'handoff_nudge').eq('entity_id', `${r13.runId}:${today}`)).data ?? [];
    ok('no nudge before the sweep', (await nudge13()).length === 0);
    await sweepHandoffSLAs(admin);
    ok('the breached, REASSIGNED handoff was chased once', (await nudge13()).length === 1, JSON.stringify(await nudge13()));
    const ownerSlaTurns = await roomTurnsOfCommitment(ownerId, String(slaStanding?.id));
    ok('THE CHASE NAMES THE CURRENT HOLDER (probe C), not the authored assignee',
      ownerSlaTurns.some((t) => /I nudged Jordan/i.test(t.text)) &&
      !ownerSlaTurns.some((t) => /I nudged Riley/i.test(t.text)),
      JSON.stringify(ownerSlaTurns.map((t) => t.text)));
    const bAfter13 = (await roomTurnsOfCommitment(reviewerId,
      String((await handoffCommitments(r13.runId)).find((c) => String(c.user_id) === reviewerId)?.id ?? ''))).length;
    ok('the person it LEFT hears nothing new', bAfter13 === bBefore13, `${bBefore13} → ${bAfter13}`);
    await decide(r13.runId, ownerId, false, 'closing the SLA-override fixture');

    // ── H14 — THE METRICS ROUTE: source + honesty floors ───────────────────────────────────────
    console.log('\nH14 — the metrics receipt (the route is auth\'d; its SUBSTANCE is the gate):');
    const readSrc = async (p: string) => (await import('node:fs/promises')).readFile(p, 'utf8');
    const metricsSrc = await readSrc('app/api/workflows/[id]/metrics/route.ts');
    const detailSrc = await readSrc('components/workflows/workflow-detail.tsx');
    const typesSrc = await readSrc('lib/workflows/types.ts');
    ok('the receipt reads the REAL usage columns off ai_usage_events',
      /from\('ai_usage_events'\)/.test(metricsSrc) &&
      /prompt_tokens, completion_tokens, cost_eur/.test(metricsSrc), 'columns not selected verbatim');
    ok('ONE DERIVATION: the gate read imports gateDeltaOf from process-state',
      /import \{ gateDeltaOf \} from '@\/lib\/workflows\/process-state'/.test(metricsSrc) &&
      /gateDeltaOf\(outs\)/.test(metricsSrc), 'gateDeltaOf not imported/used');
    ok('…and re-derives nothing locally (no second verdict scan in the route)',
      !/const gateDelta\s*=/.test(metricsSrc), 'a local gate derivation exists');
    ok('THE BASELINE IS AUTHORED: served from output_config.estimated_manual_minutes',
      /estimated_manual_minutes/.test(metricsSrc) && /baselineMinutes/.test(metricsSrc));
    ok('…with NO default (an absent baseline is null, never a fabricated 15)',
      /:\s*null;?/.test(metricsSrc) && !/\?\?\s*15\b/.test(metricsSrc) && !/baselineMinutes\s*=\s*\d/.test(metricsSrc));
    ok('HONEST DEGRADATION: a failed usage read serves `usage: null`, not a broken receipt',
      /usage[^\n]*\|\s*null = null/.test(metricsSrc) && /if \(usageError\)/.test(metricsSrc));
    ok('the time-saved number is labelled as the USER\'S ESTIMATE, client-side',
      /based on your estimate/.test(detailSrc));
    ok('…and a null baseline INVITES the input instead of inventing a number',
      /How long does this take you manually\?/.test(detailSrc) &&
      /m\.baselineMinutes !== null \?/.test(detailSrc) && /setBaselineDraft/.test(detailSrc));
    ok('OutputConfig carries estimated_manual_minutes (one existing save path, no migration)',
      /estimated_manual_minutes\?: number/.test(typesSrc));

    // ══ H15 — THE COLLABORATIVE SHAPE IS SAYABLE ════════════════════════════════════════════════
    // A pipeline with a human gate must be reachable from plain words: the model names the person,
    // CODE resolves them, and an unresolvable name is SAID, never silently shipped as an empty gate.
    // (b/c/d assert OUTCOMES — step presence, order, ids — never phrasings.)
    console.log('\nH15 — the collaborative shape is sayable:');
    const { generateWorkflowConfig } = await import('@/lib/workflows/generate-config');
    type GenCfg = Awaited<ReturnType<typeof generateWorkflowConfig>>;
    type GenStep = Record<string, unknown>;

    // ── H15a — the resolution ladder, pure (no AI, no DB) ──────────────────────────────────────
    const { matchMemberByName } = await import('@/lib/workflows/resolve-member');
    const roster = [
      { userId: 'u-riley-probe', name: 'Riley Probe', email: 'riley@fixture.test' },
      { userId: 'u-riley-stone', name: 'Riley Stone', email: 'rs@fixture.test' },
      { userId: 'u-jordan-vale', name: 'Jordan Vale', email: 'jv@fixture.test' },
      { userId: 'u-sam-lee', name: 'Sam Lee', email: 'sam.lee@fixture.test' },
    ];
    const m = (n: string) => matchMemberByName(roster, n)?.userId ?? null;
    ok('H15a exact full name wins', m('Riley Probe') === 'u-riley-probe', String(m('Riley Probe')));
    ok('H15a AMBIGUITY IS A REFUSAL: "Riley" alone → null (never a looser tier)',
      m('Riley') === null, String(m('Riley')));
    ok('H15a a unique first name resolves', m('Jordan') === 'u-jordan-vale', String(m('Jordan')));
    ok('H15a tier 3: a unique distinctive token ("lee") reaches its one person',
      m('lee') === 'u-sam-lee', String(m('lee')));
    // RE-POINTED (Aug 19, with the CONFIDENT-WRONG FLOOR): under the every-token law a scrambled
    // full name ("stone riley") legitimately resolves — every token lands on ONE person. The
    // refusal the floor guarantees is the PARTIAL hit across DIFFERENT humans.
    ok('H15a a scrambled full name still reaches its one person (order-insensitive)',
      m('stone riley') === 'u-riley-stone', String(m('stone riley')));
    ok('H15a THE CONFIDENT-WRONG FLOOR: a multi-token name splitting across two humans REFUSES',
      m('Sam Stone') === null, String(m('Sam Stone')));
    ok('H15a an unknown person → null', m('Marisol Vexley') === null, String(m('Marisol Vexley')));
    ok('H15a case/whitespace insensitive', m('  riLEY   probe ') === 'u-riley-probe', String(m('  riLEY   probe ')));
    ok('H15a empty name → null, and an empty roster → null',
      m('') === null && matchMemberByName([], 'Riley Probe') === null);
    // THE CONFIDENT-WRONG CLASS: the person named is NOT on the roster, but one of their name
    // tokens is shared by somebody else ("Sam Lee" asked for, only "Lee Chan" present). The
    // module's own law is "we never guess who holds a gate" — a partial token hit on a DIFFERENT
    // human must refuse, not authorize them.
    const otherRoster = [
      { userId: 'u-lee-chan', name: 'Lee Chan', email: 'lc@fixture.test' },
      { userId: 'u-jordan-vale', name: 'Jordan Vale', email: 'jv@fixture.test' },
    ];
    ok('H15a a spoken FULL NAME never lands on someone who shares only one token',
      matchMemberByName(otherRoster, 'Sam Lee') === null,
      JSON.stringify(matchMemberByName(otherRoster, 'Sam Lee')));

    // ── AI-gate harness: one retry on a flake, never a softened assertion ───────────────────────
    let aiCalls = 0;
    const genTwice = async (desc: string, primary: (c: GenCfg) => boolean, canRetry = true): Promise<GenCfg> => {
      let cfg = await generateWorkflowConfig(desc, ownerId, admin, { companyName: COMPANY_NAME });
      aiCalls++;
      if (!primary(cfg) && canRetry) {
        note('primary shape missed — re-running this generation ONCE (flake policy)');
        cfg = await generateWorkflowConfig(desc, ownerId, admin, { companyName: COMPANY_NAME });
        aiCalls++;
      }
      return cfg;
    };
    const stepsOf = (c: GenCfg): GenStep[] => (c?.steps ?? []) as GenStep[];
    const shapeOf = (c: GenCfg) => stepsOf(c).map((s) =>
      `${String(s.type)}${s.type === 'tool' ? `:${String(s.tool)}` : ''}(${String(s.label ?? '')})`).join(' → ');
    const textBlob = (s: GenStep) => [s.label, s.prompt, s.ask, s.instruction, JSON.stringify(s.config ?? {})]
      .map((v) => (typeof v === 'string' ? v : '')).join(' ');
    // A generation must never touch the workflows table — generateWorkflowConfig DRAFTS, the
    // create door inserts. Counted around the whole AI block.
    const wfCount = async () => (await admin.from('workflows')
      .select('id', { count: 'exact', head: true }).eq('user_id', ownerId)).count ?? 0;
    const wfBeforeGen = await wfCount();

    // ── H15b — the hiring loop generates with a REAL member ────────────────────────────────────
    // THE PRECONDITION, ASSERTED FIRST: the roster the resolver will read must carry probe B.
    // listWorkspaceMembers picks ONE active membership with no ordering — a user who belongs to
    // two workspaces gets an arbitrary roster, so this is a real read hazard, stated not assumed.
    const { listWorkspaceMembers } = await import('@/lib/workflows/resolve-member');
    const liveRoster = await listWorkspaceMembers(admin, ownerId);
    const rosterHasB = matchMemberByName(liveRoster, 'Riley Probe')?.userId === reviewerId;
    console.log(`  ↳ roster the resolver saw: ${JSON.stringify(liveRoster.map((r) => r.name))}`);
    ok('H15b precondition: the resolver reads the scratch roster (probe B is in it)',
      rosterHasB, `listWorkspaceMembers picked a workspace without probe B: ${JSON.stringify(liveRoster.map((r) => r.name))}`);
    const cfgB = await genTwice(
      'When I ask, screen data analyst applicants into a shortlist, then Riley Probe approves the shortlist, then draft interview invitations.',
      (c) => stepsOf(c).some((s) => s.type === 'handoff' && s.assignee_user_id === reviewerId),
      rosterHasB, // a wrong roster is not a model flake — re-running the model cannot fix it
    );
    const bSteps = stepsOf(cfgB);
    const bHandoffs = bSteps.filter((s) => s.type === 'handoff');
    console.log(`  ↳ H15b pipeline: ${shapeOf(cfgB) || '(none)'}`);
    ok('H15b the request produced a pipeline with at least one handoff', bHandoffs.length >= 1,
      JSON.stringify(bSteps.map((s) => s.type)));
    ok('H15b THE NAME BECAME AN ID: assignee_user_id is probe B, code-resolved',
      bHandoffs.some((s) => s.assignee_user_id === reviewerId),
      JSON.stringify(bHandoffs.map((s) => [s.assignee_name, s.assignee_user_id])));
    ok("H15b …and assignee_name is the ROSTER's spelling",
      bHandoffs.some((s) => s.assignee_user_id === reviewerId && s.assignee_name === 'Riley Probe'),
      JSON.stringify(bHandoffs.map((s) => s.assignee_name)));
    const bGateIdx = bSteps.findIndex((s) => s.type === 'handoff');
    ok('H15b the gate sits AFTER the screening work (never first)', bGateIdx > 0, String(bGateIdx));
    ok('H15b …and BEFORE the remaining work (something follows it)',
      bGateIdx >= 0 && bGateIdx < bSteps.length - 1, `${bGateIdx} of ${bSteps.length}`);
    ok('H15b …with the invitation work on the far side of the gate',
      bGateIdx >= 0 && bSteps.slice(bGateIdx + 1).some((s) => /invit/i.test(textBlob(s))),
      JSON.stringify(bSteps.slice(Math.max(bGateIdx, 0) + 1).map((s) => s.label)));
    ok('H15b the ask is grounded in the request (it names the shortlist)',
      bHandoffs.some((s) => /short\s?list/i.test(`${String(s.ask ?? '')} ${String(s.label ?? '')}`)),
      JSON.stringify(bHandoffs.map((s) => s.ask)));
    ok('H15b APPROVAL-VS-HANDOFF: no approval step (the user never asked to self-review)',
      !bSteps.some((s) => s.type === 'approval'), JSON.stringify(bSteps.map((s) => s.type)));
    ok('H15b no fabricated baseline anywhere in output_config',
      !('estimated_manual_minutes' in (cfgB?.output_config ?? {})),
      JSON.stringify(cfgB?.output_config));
    ok('H15b every handoff carries a resolved-or-empty id (never a model uuid)',
      bHandoffs.every((s) => s.assignee_user_id === '' || s.assignee_user_id === reviewerId || s.assignee_user_id === strangerId || s.assignee_user_id === ownerId),
      JSON.stringify(bHandoffs.map((s) => s.assignee_user_id)));

    // ── H15c — approval vs handoff: the user reviewing themself is NOT a handoff ────────────────
    const cfgC = await genTwice(
      'Every Monday summarize my inbox, and send it to me for approval before it emails out.',
      (c) => stepsOf(c).some((s) => s.type === 'approval'),
    );
    const cSteps = stepsOf(cfgC);
    console.log(`  ↳ H15c pipeline: ${shapeOf(cfgC) || '(none)'}`);
    ok('H15c an approval step exists (the user themself reviews)',
      cSteps.some((s) => s.type === 'approval'), JSON.stringify(cSteps.map((s) => s.type)));
    ok('H15c …and NO handoff step was invented',
      !cSteps.some((s) => s.type === 'handoff'), JSON.stringify(cSteps.map((s) => s.type)));
    ok('H15c no unresolved-person note on a self-review pipeline',
      !cfgC?.needs_person_note, String(cfgC?.needs_person_note));

    // ── H15d — the honest unresolved ───────────────────────────────────────────────────────────
    const cfgD = await genTwice(
      'When I ask, draft the client brief, and Marisol Vexley reviews the brief before it goes out.',
      (c) => stepsOf(c).some((s) => s.type === 'handoff'),
    );
    const dSteps = stepsOf(cfgD);
    const dHandoffs = dSteps.filter((s) => s.type === 'handoff');
    console.log(`  ↳ H15d pipeline: ${shapeOf(cfgD) || '(none)'} · note="${cfgD?.needs_person_note ?? ''}"`);
    ok('H15d a named outsider still produces the handoff gate', dHandoffs.length >= 1,
      JSON.stringify(dSteps.map((s) => s.type)));
    ok('H15d the assignee is EMPTY, never guessed',
      dHandoffs.every((s) => s.assignee_user_id === ''), JSON.stringify(dHandoffs.map((s) => s.assignee_user_id)));
    ok('H15d the gap is SAID: needs_person_note names her',
      /marisol/i.test(String(cfgD?.needs_person_note ?? '')), String(cfgD?.needs_person_note));
    ok('H15d …and the spoken name survives on the step for the Studio to resolve',
      dHandoffs.some((s) => /marisol/i.test(String(s.assignee_name ?? ''))),
      JSON.stringify(dHandoffs.map((s) => s.assignee_name)));
    ok('H15 A GENERATION INSERTS NOTHING (generateWorkflowConfig drafts; the create door saves)',
      (await wfCount()) === wfBeforeGen, `${wfBeforeGen} → ${await wfCount()}`);

    // ── H15e — the floors, in the landed source ────────────────────────────────────────────────
    const genSrc = await readSrc('lib/workflows/generate-config.ts');
    const workerTasksSrc = await readSrc('lib/tools/worker-tasks.ts');
    ok('H15e the prompt FORBIDS a model-emitted id',
      /NEVER emit "assignee_user_id"/.test(genSrc), 'prohibition missing');
    ok('H15e …and code deletes any id BEFORE resolving (a hallucinated uuid cannot survive)',
      /delete \(s as \{ assignee_user_id\?: unknown \}\)\.assignee_user_id;/.test(genSrc),
      'delete-before-resolve line missing');
    ok('H15e THE APPROVAL-VS-HANDOFF RULE is stated, by WHO reviews',
      /THE APPROVAL-VS-HANDOFF RULE \(decide by WHO reviews\)/.test(genSrc), 'rule missing');
    ok('H15e rule 9 forbids guessing a manual-time baseline',
      /NEVER estimate how long this work takes a human/.test(genSrc), 'rule 9 missing');
    ok('H15e …and code strips estimated_manual_minutes whatever the model says',
      /delete outputConfig\.estimated_manual_minutes;/.test(genSrc), 'strip missing');
    ok('H15e the runaway ceiling exists (MAX_HANDOFFS = 4)',
      /const MAX_HANDOFFS = 4;/.test(genSrc) && /handoffs\.length > MAX_HANDOFFS/.test(genSrc), 'cap missing');
    ok('H15e a roster-read failure still tells the truth (never a lost draft)',
      /couldn\\'t check your workspace roster/.test(genSrc), 'failure note missing');
    ok('H15e worker-tasks rides needs_person_note ON THE MARKER',
      /needs_person_note: generated\.needs_person_note \?\? null,/.test(workerTasksSrc), 'marker field missing');
    ok('H15e …AND speaks it in the sentence (personLine)',
      /const personLine = generated\.needs_person_note \?/.test(workerTasksSrc) &&
      /\$\{overlapLine\}\$\{personLine\}/.test(workerTasksSrc), 'personLine not spoken');
    note(`H15 made ${aiCalls} real generation call(s)`);
  } catch (e) {
    fail++;
    console.log(`\n  ✗ SUITE THREW — ${(e as Error).message}\n${(e as Error).stack}`);
  } finally {
    console.log('\nCleanup:');
    await cleanupWorkflows(createdWorkflows);
    // best-effort: the coworker-email audit rows the park's notification may have written
    for (const addr of [PROBE_B_EMAIL, PROBE_C_EMAIL]) {
      await admin.from('email_sends').delete().eq('user_id', ownerId).contains('recipients', [addr])
        .then(() => {}, () => {});
    }

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
    // B2 leftovers: probe C carried real asks and rooms too, and the two stores are ours.
    const { count: cTurns } = await admin.from('room_turns').select('id', { count: 'exact', head: true }).eq('user_id', strangerId);
    ok('probe C carries no room turns', (cTurns ?? 0) === 0, String(cTurns));
    const { count: cComms } = await admin.from('commitments').select('id', { count: 'exact', head: true }).eq('user_id', strangerId);
    ok('probe C carries no commitments', (cComms ?? 0) === 0, String(cComms));
    const { count: ownerStores } = await admin.from('item_plans').select('id', { count: 'exact', head: true })
      .eq('user_id', ownerId).eq('kind', 'workflow_owner');
    ok('no owner-store rows left', (ownerStores ?? 0) === 0, String(ownerStores));
    const { count: overrideStores } = await admin.from('item_plans').select('id', { count: 'exact', head: true })
      .eq('user_id', ownerId).eq('kind', 'handoff_override');
    ok('no reassign-override rows left', (overrideStores ?? 0) === 0, String(overrideStores));
    if (createdWorkflows.length) {
      const { count: ownerActs } = await admin.from('activity_events').select('id', { count: 'exact', head: true })
        .eq('entity_type', 'workflow').in('entity_id', createdWorkflows);
      ok('no ownership receipts left', (ownerActs ?? 0) === 0, String(ownerActs));
    }

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
