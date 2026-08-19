// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE RUN-RECORD SUITE (permanent — THE MOCKUP-FIDELITY WAVE, docs/processes-plan.md §141-180).
// The wave's laws become gates in the same release (laws-need-gates): the read-only story of one
// run must never fabricate a decider, borrow an SLA it cannot own, chip on an unknown, or grow a
// second comment store.
//
// A. THE PURE TABLE (no database — fixtures through the real module, exact outputs asserted):
//   A1  WAITED / OVER TARGET is arithmetic — 2h39m vs sla 2 is over, vs sla 3 is not, and a wait
//       that has not ended (waitedMs null) is NEVER over target.
//   A2  'Rejected' iff the run's own status says so.
//   A3  'Handoff over SLA' iff some decision is over target.
//   A4  'Review step skipped' — the PREVIOUS run's review labels this run's executed labels lack.
//       NO previous run → no claim (an unknown is never a chip).
//   A4b THE FALLBACK-COHERENCE FLOOR — an UNLABELED review step renders the SAME fallback in
//       reviewStepLabels as in executedStepLabels ('Step 3'), so two identical unlabeled runs
//       never chip 'Review step skipped' at each other. (The diverging-fallback trap.)
//   A5  'Owner changed' iff the caller's ledger read says true; undefined/false are not chips.
//   A6  vsPrevious — no previous is null (nothing to compare is not a delta of zero); duration
//       delta signs; steps added/removed set arithmetic; findings + decisions deltas.
//   A7  DECISION HONESTY on approval gates — an approval marker is `approved: true` with a NULL
//       decider and a NULL timestamp (neither is stored, so neither is invented); a test-mode
//       auto-pass is NOT a human decision (approved null / 'auto_passed'); a rejected run parked
//       AT its gate reads held back at the run's own end; a LATER gate that never ran is never
//       spoken for.
//
// B. THE LIVE GATES (the probe host + probes 2/3, real rows):
//   B1  waitedMs = resolved_at − created_at EXACTLY; one handoff step claims its SLA, TWO handoff
//       steps claim NONE (the never-borrow-an-SLA law) even on a long wait.
//   B2  A REASSIGN IS NOT AN APPROVAL — resolved_reason 'reassigned' reads approved null.
//   B3  THE AUTHORIZATION TRUTH TABLE (canReadRunRecord) — creator · run executor · accountability
//       owner → owner; current gate holder · PAST gate holder → holder; stranger → nothing; a
//       missing run → nothing (a refusal and an absence are indistinguishable). Plus the two HTTP
//       wrappers' source floor: one predicate, 404 never 403.
//   B4  THE ONE-ROOM FLOOR — a user comment and an engine narration share the creator's `run:<id>`
//       room; the reader's role filter returns ONLY the comment. Source floor: exactly ONE file
//       under app/ writes user turns into a run room.
//   B5  THE CREATOR-KEYED NARRATION FLOOR — both narrateInRunRoom call sites in handoffs.ts pass
//       `wf.user_id`, never an ownerOf resolution (ownership moves; the trail must not split).
//   B6  THE PREVIOUS RUN IS A FINISHED RUN — a still-running run is never the comparison.
//
// C. THE SURFACE SOURCE FLOORS (source only — the laws a runtime gate cannot reach):
//   C1  THE COMPOSER ONLY WITH A BINDING — no standing room, no composer (the honest hide), and
//       no fallback binding invented inside it.
//   C2  THE FACEPILE IS SERVED — the people derivation never touches authored steps (a raw
//       derivation would forget every reassign the server already patched in).
//   C3  ONE STATE DERIVATION — exactly one processStateOf call site, served-guarded.
//   C4  THE LOG DOOR — 'N steps' opens the RECEIPTS tab: the prop exists, seeds the state, and
//       the cell asks for it.
//   C5  A NAMELESS DECIDER IS NOT YOU — 'You' is claimed only for approval gates.
//   C6  THE BADGE POINTS AT ITS ROWS — the nav count and the ledger's per-row pills are ONE fact
//       (identical predicate both routes; served share; every reviewing deed hits the one stamp).
//
// Every inserted row is deleted in `finally` and ZERO LEFTOVERS is asserted. Fixtures are tagged
// (`run-record smoke fixture`) so a crashed run's debris is identifiable, and a sweep at start
// drains it. Rerunnable, idempotent, no AI calls.
// Run: npx tsx scripts/smoke-run-record.ts
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { resolveProbeUser } from './probe-user';
import {
  decisionsOf, summarizeRun, driftChipsOf, vsPrevious, canReadRunRecord,
  DRIFT_REJECTED, DRIFT_OVER_SLA, DRIFT_REVIEW_SKIPPED, DRIFT_OWNER_CHANGED,
  type RunSummary, type Decision,
} from '@/lib/workflows/run-record';
import type { StepOutput, WorkflowStep } from '@/lib/workflows/types';

const FIXTURE_TAG = 'run-record smoke fixture';
const PROBE_B_EMAIL = 'smoke-probe-2@augmtd-internal.test';
const PROBE_C_EMAIL = 'smoke-probe-3@augmtd-internal.test';

// The suite is run bare (`npx tsx scripts/smoke-run-record.ts`) — load .env.local ourselves so the
// command in the header is the whole command.
async function loadEnv() {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  try {
    const raw = await (await import('node:fs/promises')).readFile('.env.local', 'utf8');
    for (const line of raw.split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (!m) continue;
      const v = m[2].trim().replace(/^["']|["']$/g, '');
      if (!process.env[m[1]]) process.env[m[1]] = v;
    }
  } catch { /* the client construction below will say what is missing */ }
}

/** Mirrors resolveProbeUser for the extra probes (probe-user.ts stays untouched — shared
 *  infrastructure for a dozen suites). Reports whether WE provisioned the user, so cleanup only
 *  deletes what this suite created. */
async function resolveExtraProbe(
  sb: SupabaseClient, email: string, fullName: string,
): Promise<{ id: string; created: boolean }> {
  let id: string | null = null;
  for (let page = 1; page <= 5; page++) {
    const { data } = await sb.auth.admin.listUsers({ page, perPage: 200 });
    const found = data?.users?.find((u) => u.email === email);
    if (found) { id = found.id; break; }
    if (!data?.users?.length || data.users.length < 200) break;
  }
  let created = false;
  if (!id) {
    const { data: made, error } = await sb.auth.admin.createUser({ email, email_confirm: true });
    if (error || !made?.user) throw new Error(`cannot provision ${email}: ${error?.message}`);
    id = made.user.id; created = true;
  }
  await sb.from('profiles').upsert({ id, full_name: fullName, email }, { onConflict: 'id' }).then(() => {}, () => {});
  return { id, created };
}

// ── THE STUB CLIENT (section A) ────────────────────────────────────────────────────────────────
// decisionsOf reads commitments (and profiles) through the client; the ARITHMETIC it runs on those
// rows is pure. A per-table fixture reader lets the laws be table-tested with no database at all —
// the module under test is the real one, only its input is a fixture.
function stubAdmin(tables: Record<string, unknown[]>): SupabaseClient {
  const thenable = (data: unknown) => ({
    then: (res: (v: { data: unknown; error: null }) => unknown) => Promise.resolve(res({ data, error: null })),
  });
  const query = (table: string) => {
    const rows = tables[table] ?? [];
    const self: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in', 'is', 'not', 'gt', 'gte', 'lt', 'lte', 'like', 'filter', 'contains', 'order', 'limit']) {
      self[m] = () => self;
    }
    self.maybeSingle = () => thenable(rows[0] ?? null);
    self.single = () => thenable(rows[0] ?? null);
    self.then = (res: (v: { data: unknown; error: null }) => unknown) => Promise.resolve(res({ data: rows, error: null }));
    return self;
  };
  return { from: (t: string) => query(t) } as unknown as SupabaseClient;
}

// ── FIXTURE BUILDERS (section A) ───────────────────────────────────────────────────────────────
// The intersection keeps the fixture assignable BOTH ways: as a real `StepOutput` (the run rows we
// insert) and as the loose `StepOutputLike` the derivation reads.
const out = (over: Partial<StepOutput> & { step_id: string }): StepOutput & Record<string, unknown> => ({
  step_type: 'ai', label: 'Step', output: '', ...over,
} as StepOutput & Record<string, unknown>);

const mkSummary = (over: Partial<RunSummary>): RunSummary => ({
  runId: 'r', workflowId: 'w', status: 'succeeded',
  startedAt: '2026-08-19T09:00:00.000Z', endedAt: '2026-08-19T09:10:00.000Z',
  durationMs: 600_000, executedStepLabels: [], reviewStepLabels: [],
  gateFindings: 0, decisions: [], ...over,
});

const mkDecision = (over: Partial<Decision>): Decision => ({
  kind: 'handoff', label: 'Review', deciderName: null, decidedAt: null,
  approved: true, waitedMs: null, overTarget: false, ...over,
});

const H = 3_600_000;
const WAIT_2H39 = 2 * H + 39 * 60_000; // 9_540_000 ms — the mockup's own example wait

async function main() {
  await loadEnv();
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  let pass = 0, fail = 0;
  const ok = (name: string, cond: boolean, detail?: string) => {
    if (cond) { pass++; console.log(`  ✓ ${name}`); }
    else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
  };
  const note = (t: string) => console.log(`  · ${t}`);
  const readSrc = async (p: string) => (await import('node:fs/promises')).readFile(p, 'utf8');

  const creatorId = await resolveProbeUser(admin);
  const holder = await resolveExtraProbe(admin, PROBE_B_EMAIL, 'Riley Probe');
  const outsider = await resolveExtraProbe(admin, PROBE_C_EMAIL, 'Jordan Probe');
  const holderId = holder.id, strangerId = outsider.id;
  console.log(`probe A (creator) ${creatorId}\nprobe B (gate holder) ${holderId}\nprobe C (stranger → owner) ${strangerId}`);

  const createdWorkflows: string[] = [];
  const createdRuns: string[] = [];
  const roomKeys: string[] = [];

  // A crashed previous run leaves tagged workflows behind — drain them before we start, so the
  // zero-leftover audit at the end means what it says.
  const sweepFixtures = async () => {
    const { data: wfs } = await admin.from('workflows').select('id')
      .eq('user_id', creatorId).eq('description', FIXTURE_TAG);
    const ids = (wfs ?? []).map((w) => String(w.id));
    if (!ids.length) return 0;
    const { data: runs } = await admin.from('workflow_runs').select('id').in('workflow_id', ids);
    const runIds = (runs ?? []).map((r) => String(r.id));
    if (runIds.length) {
      await admin.from('commitments').delete().eq('source', 'handoff').in('source_id', runIds);
      await admin.from('room_turns').delete().eq('user_id', creatorId)
        .in('room_key', runIds.map((r) => `run:${r}`));
      await admin.from('workflow_runs').delete().in('id', runIds);
    }
    await admin.from('item_plans').delete().eq('user_id', creatorId)
      .eq('kind', 'workflow_owner').in('entity_id', ids);
    await admin.from('activity_events').delete().eq('entity_type', 'workflow').in('entity_id', ids);
    await admin.from('workflows').delete().in('id', ids);
    return ids.length;
  };
  const drained = await sweepFixtures();
  if (drained) note(`drained ${drained} orphan fixture workflow(s) from a previous run`);

  const makeWorkflow = async (name: string, steps: WorkflowStep[]): Promise<string> => {
    const { data, error } = await admin.from('workflows').insert({
      user_id: creatorId, name, description: FIXTURE_TAG,
      icon: 'users', color: 'indigo', status: 'active',
      trigger: { type: 'manual' }, steps,
      output_config: { destination: 'message', report_mode: 'silent' },
    }).select('id').single();
    if (error || !data) throw new Error(`workflow fixture failed: ${error?.message}`);
    createdWorkflows.push(String(data.id));
    return String(data.id);
  };

  const makeRun = async (spec: {
    workflowId: string; userId?: string; status?: string; outputs?: StepOutput[];
    createdAt?: string; completedAt?: string | null;
  }): Promise<string> => {
    const createdAt = spec.createdAt ?? new Date().toISOString();
    const { data, error } = await admin.from('workflow_runs').insert({
      workflow_id: spec.workflowId, user_id: spec.userId ?? creatorId,
      status: spec.status ?? 'succeeded', triggered_by: 'manual',
      step_outputs: spec.outputs ?? [], started_at: createdAt,
      completed_at: spec.completedAt === undefined ? createdAt : spec.completedAt,
      created_at: createdAt,
    }).select('id').single();
    if (error || !data) throw new Error(`run fixture failed: ${error?.message}`);
    createdRuns.push(String(data.id));
    return String(data.id);
  };

  const makeHandoffCommitment = async (spec: {
    runId: string; userId: string; description: string; waitedMs: number | null;
    status?: string; resolvedReason?: string | null;
  }): Promise<string> => {
    const created = new Date(Date.now() - 5 * 24 * H);
    const resolved = spec.waitedMs == null ? null : new Date(created.getTime() + spec.waitedMs);
    const { data, error } = await admin.from('commitments').insert({
      user_id: spec.userId, direction: 'you_owe', description: spec.description,
      counterparty: 'Probe', source: 'handoff', source_id: spec.runId,
      status: spec.status ?? (resolved ? 'completed' : 'open'),
      resolved_at: resolved ? resolved.toISOString() : null,
      resolved_reason: spec.resolvedReason ?? null,
      created_at: created.toISOString(),
    }).select('id').single();
    if (error || !data) throw new Error(`commitment fixture failed: ${error?.message}`);
    return String(data.id);
  };

  const runRow = async (id: string) => (await admin.from('workflow_runs')
    .select('id, workflow_id, user_id, status, triggered_by, step_outputs, error, started_at, completed_at, created_at')
    .eq('id', id).maybeSingle()).data as never;

  try {
    // ══ A — THE PURE TABLE (no database) ═════════════════════════════════════════════════════
    console.log('\nA — the pure table (fixtures, no database):');

    const oneHandoffWf = { steps: [{ type: 'handoff', id: 's1', label: 'Review', ask: 'Approve the draft', sla_hours: 2 }] as unknown as WorkflowStep[] };
    const threeHourWf = { steps: [{ type: 'handoff', id: 's1', label: 'Review', ask: 'Approve the draft', sla_hours: 3 }] as unknown as WorkflowStep[] };
    const commitRow = (waitedMs: number | null) => {
      const created = new Date('2026-08-18T08:00:00.000Z');
      return {
        id: 'c1', user_id: 'u1', description: 'Approve the draft — Weekly brief',
        status: waitedMs == null ? 'open' : 'completed', resolved_reason: null,
        resolved_at: waitedMs == null ? null : new Date(created.getTime() + waitedMs).toISOString(),
        created_at: created.toISOString(),
      };
    };
    const pureRun = { id: 'run-fixture', status: 'succeeded', step_outputs: [], completed_at: null };

    // A1 — waited / over-target arithmetic.
    const a1over = await decisionsOf(stubAdmin({ commitments: [commitRow(WAIT_2H39)] }), { run: pureRun, workflow: oneHandoffWf });
    ok('A1 waited is the exact resolved−created span (2h39m)', a1over[0]?.waitedMs === WAIT_2H39, String(a1over[0]?.waitedMs));
    ok('A1 2h39m vs sla 2 → over target', a1over[0]?.overTarget === true, JSON.stringify(a1over[0]));
    const a1under = await decisionsOf(stubAdmin({ commitments: [commitRow(WAIT_2H39)] }), { run: pureRun, workflow: threeHourWf });
    ok('A1 2h39m vs sla 3 → NOT over target', a1under[0]?.overTarget === false, JSON.stringify(a1under[0]));
    const a1open = await decisionsOf(stubAdmin({ commitments: [commitRow(null)] }), { run: pureRun, workflow: oneHandoffWf });
    ok('A1 a wait that has not ended is waitedMs null…', a1open[0]?.waitedMs === null, String(a1open[0]?.waitedMs));
    ok('A1 …and NEVER over target (an open ask has not missed anything yet)',
      a1open[0]?.overTarget === false && a1open[0]?.approved === null && a1open[0]?.outcome === 'pending',
      JSON.stringify(a1open[0]));

    // A2 — 'Rejected' is the run's own status, nothing else.
    ok('A2 rejected status → Rejected chip',
      driftChipsOf(mkSummary({ status: 'rejected' })).includes(DRIFT_REJECTED));
    ok('A2 succeeded status → no Rejected chip',
      !driftChipsOf(mkSummary({ status: 'succeeded' })).includes(DRIFT_REJECTED));
    ok('A2 failed status → no Rejected chip (a failure is not a refusal)',
      !driftChipsOf(mkSummary({ status: 'failed' })).includes(DRIFT_REJECTED));

    // A3 — 'Handoff over SLA' iff a decision is over target.
    ok('A3 one over-target decision → the SLA chip',
      driftChipsOf(mkSummary({ decisions: [mkDecision({ overTarget: false }), mkDecision({ overTarget: true })] }))
        .includes(DRIFT_OVER_SLA));
    ok('A3 no over-target decision → no SLA chip',
      !driftChipsOf(mkSummary({ decisions: [mkDecision({ overTarget: false })] })).includes(DRIFT_OVER_SLA));

    // A4 — the skipped review, and the silence of an unknown.
    const prevWithReview = mkSummary({ executedStepLabels: ['Draft', 'Compliance check'], reviewStepLabels: ['Compliance check'] });
    ok('A4 previous ran a review this run lacks → Review step skipped',
      driftChipsOf(mkSummary({ executedStepLabels: ['Draft'] }), prevWithReview).includes(DRIFT_REVIEW_SKIPPED));
    ok('A4 the review is still executed → no chip',
      !driftChipsOf(mkSummary({ executedStepLabels: ['Draft', 'Compliance check'] }), prevWithReview)
        .includes(DRIFT_REVIEW_SKIPPED));
    ok('A4 NO previous run → no claim (an unknown is never a chip)',
      !driftChipsOf(mkSummary({ executedStepLabels: ['Draft'] }), null).includes(DRIFT_REVIEW_SKIPPED));

    // A4b — THE FALLBACK-COHERENCE FLOOR: an unlabeled review renders the SAME word in both lists.
    const unlabeledOutputs: StepOutput[] = [
      out({ step_id: 'a', step_type: 'tool', label: 'Fetch' }),
      out({ step_id: 'b', step_type: 'ai', label: 'Draft' }),
      out({ step_id: 'c', step_type: 'approval', label: '' }),
    ];
    const mkUnlabeledRun = (id: string) => ({
      id, workflow_id: 'w', status: 'succeeded', step_outputs: unlabeledOutputs,
      started_at: '2026-08-19T09:00:00.000Z', completed_at: '2026-08-19T09:10:00.000Z',
      created_at: '2026-08-19T09:00:00.000Z',
    });
    const emptyDb = stubAdmin({ commitments: [] });
    const sumA = await summarizeRun(emptyDb, mkUnlabeledRun('ua') as never, { steps: [] });
    const sumB = await summarizeRun(emptyDb, mkUnlabeledRun('ub') as never, { steps: [] });
    ok('A4b an unlabeled step renders its positional fallback',
      sumA.executedStepLabels[2] === 'Step 3', JSON.stringify(sumA.executedStepLabels));
    ok('A4b …and the review list uses the SAME rendering (never a second fallback vocabulary)',
      JSON.stringify(sumA.reviewStepLabels) === JSON.stringify(['Step 3']), JSON.stringify(sumA.reviewStepLabels));
    ok('A4b two identical unlabeled runs chip NOTHING (the diverging-fallback trap stays shut)',
      !driftChipsOf(sumB, sumA).includes(DRIFT_REVIEW_SKIPPED), JSON.stringify(driftChipsOf(sumB, sumA)));

    // A5 — the ledger read, passed in. Unknown is silence.
    ok('A5 ownerChangedBetween true → Owner changed',
      driftChipsOf(mkSummary({}), mkSummary({}), { ownerChangedBetween: true }).includes(DRIFT_OWNER_CHANGED));
    ok('A5 ownerChangedBetween false → no chip',
      !driftChipsOf(mkSummary({}), mkSummary({}), { ownerChangedBetween: false }).includes(DRIFT_OWNER_CHANGED));
    ok('A5 no options at all → no chip (an unread ledger is never a claim)',
      !driftChipsOf(mkSummary({}), mkSummary({})).includes(DRIFT_OWNER_CHANGED));

    // A6 — vsPrevious arithmetic.
    ok('A6 no previous run → null, never a zero-delta object', vsPrevious(mkSummary({}), null) === null);
    ok('A6 no previous (undefined) → null', vsPrevious(mkSummary({})) === null);
    const slower = vsPrevious(mkSummary({ durationMs: 900_000 }), mkSummary({ durationMs: 600_000 }));
    ok('A6 a slower run reads a POSITIVE duration delta', slower?.durationDeltaMs === 300_000, String(slower?.durationDeltaMs));
    const faster = vsPrevious(mkSummary({ durationMs: 400_000 }), mkSummary({ durationMs: 600_000 }));
    ok('A6 a faster run reads a NEGATIVE duration delta', faster?.durationDeltaMs === -200_000, String(faster?.durationDeltaMs));
    ok('A6 an unmeasurable duration on either side → null delta',
      vsPrevious(mkSummary({ durationMs: null }), mkSummary({ durationMs: 600_000 }))?.durationDeltaMs === null &&
      vsPrevious(mkSummary({ durationMs: 600_000 }), mkSummary({ durationMs: null }))?.durationDeltaMs === null);
    const sets = vsPrevious(
      mkSummary({ executedStepLabels: ['Fetch', 'Draft', 'Publish'], gateFindings: 5, decisions: [mkDecision({}), mkDecision({})] }),
      mkSummary({ executedStepLabels: ['Fetch', 'Compliance check'], gateFindings: 2, decisions: [mkDecision({})] }),
    );
    ok('A6 stepsAdded = current minus previous', JSON.stringify(sets?.stepsAdded) === JSON.stringify(['Draft', 'Publish']),
      JSON.stringify(sets?.stepsAdded));
    ok('A6 stepsRemoved = previous minus current', JSON.stringify(sets?.stepsRemoved) === JSON.stringify(['Compliance check']),
      JSON.stringify(sets?.stepsRemoved));
    ok('A6 gateFindingsDelta is signed arithmetic', sets?.gateFindingsDelta === 3, String(sets?.gateFindingsDelta));
    ok('A6 decisionsDelta is signed arithmetic', sets?.decisionsDelta === 1, String(sets?.decisionsDelta));

    // A7 — decision honesty on approval gates.
    const approvalSteps = [
      { type: 'ai', id: 'p0', label: 'Draft' },
      { type: 'approval', id: 'p1', label: 'Your approval' },
      { type: 'approval', id: 'p2', label: 'Second sign-off' },
    ] as unknown as WorkflowStep[];
    const approved = await decisionsOf(emptyDb, {
      run: { id: 'r-a', status: 'succeeded', completed_at: '2026-08-19T10:00:00.000Z',
        step_outputs: [out({ step_id: 'p0' }), out({ step_id: 'p1', step_type: 'approval', label: 'Your approval', output: '[Approved by the user — 2026-08-19T09:58:00Z]' })] },
      workflow: { steps: approvalSteps },
    });
    ok('A7 the approval marker reads approved', approved[0]?.approved === true && approved[0]?.outcome === 'approved',
      JSON.stringify(approved[0]));
    ok('A7 …with a NULL decider (no approval gate stores WHO — a name would be invented)',
      approved[0]?.deciderName === null, String(approved[0]?.deciderName));
    ok('A7 …and a NULL timestamp (no approval gate stores WHEN — "now" would be a lie)',
      approved[0]?.decidedAt === null, String(approved[0]?.decidedAt));
    ok('A7 a LATER gate that never executed is never spoken for', approved.length === 1,
      JSON.stringify(approved.map((d) => d.label)));

    const autoPassed = await decisionsOf(emptyDb, {
      run: { id: 'r-t', status: 'succeeded', completed_at: null,
        step_outputs: [out({ step_id: 'p0' }), out({ step_id: 'p1', step_type: 'approval', label: 'Your approval', output: 'Gate auto-passed in test mode.' })] },
      workflow: { steps: approvalSteps },
    });
    ok('A7 a test-mode auto-pass is NOT a human decision (approved null)', autoPassed[0]?.approved === null,
      JSON.stringify(autoPassed[0]));
    ok('A7 …and says so by name (outcome auto_passed)', autoPassed[0]?.outcome === 'auto_passed', String(autoPassed[0]?.outcome));

    const rejected = await decisionsOf(emptyDb, {
      run: { id: 'r-r', status: 'rejected', completed_at: '2026-08-19T11:00:00.000Z',
        step_outputs: [out({ step_id: 'p0' })] },
      workflow: { steps: approvalSteps },
    });
    ok('A7 a rejected run parked AT its gate reads held back',
      rejected.length === 1 && rejected[0].approved === false && rejected[0].outcome === 'held_back',
      JSON.stringify(rejected));
    ok('A7 …dated at the run\'s own end (the only timestamp the run actually carries)',
      rejected[0]?.decidedAt === '2026-08-19T11:00:00.000Z', String(rejected[0]?.decidedAt));
    ok('A7 …and the gate BEYOND the park is still never spoken for',
      !rejected.some((d) => d.label === 'Second sign-off'), JSON.stringify(rejected.map((d) => d.label)));

    // ══ B — THE LIVE GATES ═══════════════════════════════════════════════════════════════════
    console.log('\nB — the live gates (real rows on the probe host):');

    const handoffStep = (id: string, sla?: number): WorkflowStep => ({
      type: 'handoff', id, label: 'Review', assignee_user_id: holderId, assignee_name: 'Riley Probe',
      ask: 'Approve the client brief', ...(sla ? { sla_hours: sla } : {}),
    } as unknown as WorkflowStep);

    // B1 — the exact wait, and the SLA a run may claim.
    const wfOne = await makeWorkflow('Probe · one handoff', [handoffStep('h1', 2)]);
    const runOne = await makeRun({ workflowId: wfOne });
    await makeHandoffCommitment({ runId: runOne, userId: holderId, description: 'Approve the client brief — Weekly brief', waitedMs: WAIT_2H39 });
    const wfOneRow = { steps: [handoffStep('h1', 2)] };
    const dOne = await decisionsOf(admin, { run: await runRow(runOne), workflow: wfOneRow });
    ok('B1 waitedMs = resolved_at − created_at, to the millisecond', dOne[0]?.waitedMs === WAIT_2H39,
      `${dOne[0]?.waitedMs} vs ${WAIT_2H39}`);
    ok('B1 a SINGLE handoff step lets the run claim its SLA', dOne[0]?.slaHours === 2, String(dOne[0]?.slaHours));
    ok('B1 …so the long wait is over target', dOne[0]?.overTarget === true, JSON.stringify(dOne[0]));
    ok('B1 the decider is the real person the row belongs to', dOne[0]?.deciderName === 'Riley Probe', String(dOne[0]?.deciderName));
    ok('B1 the ask is the step\'s own words', dOne[0]?.label === 'Approve the client brief', String(dOne[0]?.label));

    const twoSteps = [handoffStep('h1', 2), handoffStep('h2', 2)];
    const wfTwo = await makeWorkflow('Probe · two handoffs', twoSteps);
    const runTwo = await makeRun({ workflowId: wfTwo });
    await makeHandoffCommitment({ runId: runTwo, userId: holderId, description: 'Approve the client brief — Weekly brief', waitedMs: WAIT_2H39 });
    const dTwo = await decisionsOf(admin, { run: await runRow(runTwo), workflow: { steps: twoSteps } });
    ok('B1 TWO handoff steps → the SLA is NULL (never borrowed from the wrong step)',
      dTwo[0]?.slaHours === null, String(dTwo[0]?.slaHours));
    ok('B1 …and over target is false EVEN on the same long wait (no SLA, no verdict)',
      dTwo[0]?.overTarget === false && dTwo[0]?.waitedMs === WAIT_2H39, JSON.stringify(dTwo[0]));
    ok('B1 …and the ask falls back to the row\'s OWN description, never the wrong step\'s',
      dTwo[0]?.label === 'Approve the client brief', String(dTwo[0]?.label));

    // B2 — a reassign closes a row without deciding anything.
    const runReassign = await makeRun({ workflowId: wfOne });
    await makeHandoffCommitment({
      runId: runReassign, userId: holderId, description: 'Approve the client brief — Weekly brief',
      waitedMs: 30 * 60_000, status: 'completed', resolvedReason: 'reassigned',
    });
    const dRe = await decisionsOf(admin, { run: await runRow(runReassign), workflow: wfOneRow });
    ok('B2 a reassigned row is NOT an approval (approved null)', dRe[0]?.approved === null, JSON.stringify(dRe[0]));
    ok('B2 …and says what actually happened (outcome reassigned)', dRe[0]?.outcome === 'reassigned', String(dRe[0]?.outcome));

    // B3 — the authorization truth table.
    const runExec = await makeRun({ workflowId: wfOne, userId: holderId });
    const wfOwned = await makeWorkflow('Probe · owned elsewhere', [handoffStep('h1', 2)]);
    const runOwned = await makeRun({ workflowId: wfOwned });
    const runOpen = await makeRun({ workflowId: wfOne });
    await makeHandoffCommitment({ runId: runOpen, userId: holderId, description: 'Approve the client brief — Weekly brief', waitedMs: null });

    const aCreator = await canReadRunRecord(admin, runOne, creatorId);
    ok('B3 the CREATOR reads the record, as owner', aCreator.ok && aCreator.role === 'owner', JSON.stringify(aCreator.role));
    ok('B3 …and the creator id rides back (the room\'s one owner)', aCreator.creatorUserId === creatorId, String(aCreator.creatorUserId));
    const aExec = await canReadRunRecord(admin, runExec, holderId);
    ok('B3 the RUN EXECUTOR reads their own run, as owner', aExec.ok && aExec.role === 'owner', JSON.stringify(aExec.role));
    const aStranger = await canReadRunRecord(admin, runOne, strangerId);
    ok('B3 a STRANGER gets nothing', aStranger.ok === false && aStranger.role === null, JSON.stringify(aStranger));
    ok('B3 …and nothing leaks with the refusal (no run, no workflow)',
      aStranger.run === undefined && aStranger.workflow === undefined, JSON.stringify(Object.keys(aStranger)));
    const aMissing = await canReadRunRecord(admin, '00000000-0000-4000-8000-000000000000', creatorId);
    ok('B3 a MISSING run is indistinguishable from a refusal',
      aMissing.ok === false && aMissing.role === null && JSON.stringify(aMissing) === JSON.stringify(aStranger),
      JSON.stringify(aMissing));

    const { setWorkflowOwner } = await import('@/lib/workflows/owner');
    const moved = await setWorkflowOwner(admin, {
      workflowId: wfOwned, creatorUserId: creatorId, byUserId: creatorId,
      newOwnerUserId: strangerId, newOwnerName: 'Jordan Probe',
    });
    ok('B3 the accountability owner store accepted the move', moved.ok === true, JSON.stringify(moved));
    const aOwner = await canReadRunRecord(admin, runOwned, strangerId);
    ok('B3 the ACCOUNTABILITY OWNER reads the record, as owner', aOwner.ok && aOwner.role === 'owner', JSON.stringify(aOwner.role));
    const aCreatorStill = await canReadRunRecord(admin, runOwned, creatorId);
    ok('B3 …and the creator keeps their rights after the move', aCreatorStill.ok && aCreatorStill.role === 'owner',
      JSON.stringify(aCreatorStill.role));

    const aCurrentHolder = await canReadRunRecord(admin, runOpen, holderId);
    ok('B3 the CURRENT gate holder reads it, as holder', aCurrentHolder.ok && aCurrentHolder.role === 'holder',
      JSON.stringify(aCurrentHolder.role));
    const aPastHolder = await canReadRunRecord(admin, runOne, holderId);
    ok('B3 a PAST gate holder keeps their history (they decided; the record is theirs)',
      aPastHolder.ok && aPastHolder.role === 'holder', JSON.stringify(aPastHolder.role));

    const recordSrc = await readSrc('app/api/workflows/runs/[id]/record/route.ts');
    const commentsSrc = await readSrc('app/api/workflows/runs/[id]/comments/route.ts');
    ok('B3 both routes authorize through THE ONE predicate (no second truth table)',
      /canReadRunRecord\(admin, runId, user\.id\)/.test(recordSrc) &&
      /canReadRunRecord\(admin, runId, user\.id\)/.test(commentsSrc), 'a route resolves access itself');
    ok('B3 …and refuse with 404, never 403 (a refusal must not confirm a run exists)',
      /status: 404/.test(recordSrc) && /status: 404/.test(commentsSrc) &&
      !/status: 403/.test(recordSrc) && !/status: 403/.test(commentsSrc), 'a 403 exists');

    // B4 — THE ONE-ROOM FLOOR.
    const { writeRoomTurn, readRoomTurns } = await import('@/lib/room/turns');
    const { narrateInRunRoom } = await import('@/lib/workflows/owner');
    const roomKey = `run:${runOne}`;
    roomKeys.push(roomKey);
    await writeRoomTurn(admin, creatorId, roomKey, {
      role: 'user', text: 'Checked the figures — good to go.',
      author: { kind: 'coworker', id: holderId, name: 'Riley' },
    });
    await narrateInRunRoom(admin, creatorId, runOne, 'Riley approved "Probe · one handoff" after 2h 39m.', `handoff-decided:${runOne}`);
    const turns = await readRoomTurns(admin, creatorId, roomKey, 200);
    const comments = turns.filter((t) => t.role === 'user');
    ok('B4 the comment and the narration share ONE room', turns.length === 2, String(turns.length));
    ok('B4 the role filter serves EXACTLY the comment (narrations are not comments)',
      comments.length === 1 && comments[0].text === 'Checked the figures — good to go.', JSON.stringify(comments));
    ok('B4 …carrying WHO spoke (the room\'s only attribution channel)',
      comments[0]?.author?.name === 'Riley', JSON.stringify(comments[0]?.author));
    ok('B4 the narration stays a system turn, unattributed (the one-narrator law)',
      turns.some((t) => t.role === 'system' && !t.author), JSON.stringify(turns.map((t) => t.role)));

    // …and exactly ONE door writes user turns into a run room.
    const walk = async (dir: string): Promise<string[]> => {
      const fs = await import('node:fs/promises');
      const ents = await fs.readdir(dir, { withFileTypes: true });
      const files: string[] = [];
      for (const e of ents) {
        const p = `${dir}/${e.name}`;
        if (e.isDirectory()) files.push(...await walk(p));
        else if (/\.tsx?$/.test(e.name)) files.push(p);
      }
      return files;
    };
    const appFiles = await walk('app');
    const runRoomWriters: string[] = [];
    for (const f of appFiles) {
      const src = await readSrc(f);
      if (/writeRoomTurn\(/.test(src) && /`run:\$\{/.test(src) && /role: 'user'/.test(src)) runRoomWriters.push(f);
    }
    ok('B4 SOURCE FLOOR: exactly ONE file under app/ writes user turns into a run room',
      runRoomWriters.length === 1 && runRoomWriters[0] === 'app/api/workflows/runs/[id]/comments/route.ts',
      JSON.stringify(runRoomWriters));

    // B5 — THE CREATOR-KEYED NARRATION FLOOR.
    const handoffsSrc = await readSrc('lib/workflows/handoffs.ts');
    const handoffLines = handoffsSrc.split('\n');
    const callIdx = handoffLines
      .map((l, i) => (/await narrateInRunRoom\(/.test(l) ? i : -1))
      .filter((i) => i >= 0);
    ok('B5 handoffs.ts narrates into the run room at BOTH decision doors', callIdx.length === 2, String(callIdx.length));
    const creatorKeyed = callIdx.every((i) => /wf\.user_id/.test(handoffLines.slice(i, i + 3).join('\n')));
    ok('B5 every call keys the room on the CREATOR (wf.user_id) — ownership moves, the trail does not',
      creatorKeyed, JSON.stringify(callIdx.map((i) => handoffLines.slice(i, i + 3).join(' ').trim().slice(0, 90))));
    const ownerResolved = callIdx.some((i) => /\bownerOf\(/.test(handoffLines.slice(Math.max(0, i - 5), i).join('\n')));
    ok('B5 …and none of them resolves an owner first (that split the trail across two rooms)',
      !ownerResolved, 'an ownerOf resolution sits above a narrateInRunRoom call');

    // B6 — the previous run is a FINISHED run.
    const wfHistory = await makeWorkflow('Probe · history', [handoffStep('h1', 2)]);
    const t0 = Date.now();
    const iso = (msAgo: number) => new Date(t0 - msAgo).toISOString();
    const prevSucceeded = await makeRun({
      workflowId: wfHistory, status: 'succeeded', createdAt: iso(3 * H), completedAt: iso(3 * H - 60_000),
      outputs: [out({ step_id: 'h0', label: 'Fetch', step_type: 'tool' }), out({ step_id: 'h1', label: 'Compliance check', step_type: 'approval' })],
    });
    const midRunning = await makeRun({
      workflowId: wfHistory, status: 'running', createdAt: iso(2 * H), completedAt: null,
      outputs: [out({ step_id: 'h0', label: 'Fetch', step_type: 'tool' })],
    });
    const current = await makeRun({
      workflowId: wfHistory, status: 'succeeded', createdAt: iso(1 * H), completedAt: iso(1 * H - 120_000),
      outputs: [out({ step_id: 'h0', label: 'Fetch', step_type: 'tool' })],
    });
    const currentRow = await runRow(current) as { created_at: string };
    const { data: picked } = await admin.from('workflow_runs')
      .select('id, workflow_id, user_id, status, triggered_by, step_outputs, error, started_at, completed_at, created_at')
      .eq('workflow_id', wfHistory)
      .in('status', ['succeeded', 'failed', 'rejected'])
      .lt('created_at', currentRow.created_at)
      .order('created_at', { ascending: false }).limit(1);
    const prevPicked = (picked ?? [])[0] as { id: string } | undefined;
    ok('B6 the comparison is the previous FINISHED run…', prevPicked?.id === prevSucceeded,
      `${prevPicked?.id} (running was ${midRunning})`);
    ok('B6 …a still-running run is never the comparison', prevPicked?.id !== midRunning, String(prevPicked?.id));
    const curSum = await summarizeRun(admin, await runRow(current), { steps: [handoffStep('h1', 2)] });
    const prevSum = await summarizeRun(admin, prevPicked as never, { steps: [handoffStep('h1', 2)] });
    const delta = vsPrevious(curSum, prevSum);
    ok('B6 the pair reads the drop of the review step as removed',
      JSON.stringify(delta?.stepsRemoved) === JSON.stringify(['Compliance check']), JSON.stringify(delta?.stepsRemoved));
    ok('B6 …and the drift chip says it out loud',
      driftChipsOf(curSum, prevSum).includes(DRIFT_REVIEW_SKIPPED), JSON.stringify(driftChipsOf(curSum, prevSum)));
    ok('B6 …with the duration delta measured against THAT run (a slower current reads positive)',
      delta?.durationDeltaMs === 60_000, String(delta?.durationDeltaMs));

    // ══ C — THE SURFACE SOURCE FLOORS (pure source reads: no database, no probe) ══════════════
    // The wave's surface half carries laws a runtime gate cannot reach (a composer that must not
    // render, a derivation that must not fork the server's truth, a door that must land on the
    // right tab). They are cheap regex floors, and they fail loud the moment a second door opens.
    console.log('\nC — the surface source floors (source only):');

    const detailSrc = await readSrc('components/workflows/workflow-detail.tsx');
    const drawerSrc = await readSrc('components/workflows/process-drawer.tsx');
    const recordDrawerSrc = await readSrc('components/workflows/run-record-drawer.tsx');
    /** A file's CODE, with comments removed — a floor that counts call sites must never count a
     *  sentence about them (the "the only processStateOf call site" comment is not a call site). */
    const codeOf = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    /** One top-level `function <name>(` body, up to the next column-0 declaration. */
    const bodyOf = (src: string, name: string): string => {
      const start = src.indexOf(`function ${name}(`);
      if (start < 0) return '';
      const rest = src.slice(start + 1);
      const end = rest.search(/\n(?:function |const |export |\/\*\*)/);
      return end < 0 ? rest : rest.slice(0, end);
    };

    // C1 — THE COMPOSER ONLY WITH A BINDING. Without a standing commitment there is no room to
    // speak into, so the composer must be ABSENT (the honest hide), never a hollow input.
    ok('C1 the composer mounts ONLY behind a truthy binding',
      /\{standing && <StandingComposer/.test(detailSrc), 'the gated JSX mount is missing');
    const composerBody = bodyOf(detailSrc, 'StandingComposer');
    ok('C1 …and the composer takes a REQUIRED binding (never an optional one it could paper over)',
      /function StandingComposer\(\{ standing \}: \{ standing: StandingBinding \}\)/.test(detailSrc),
      'the prop is optional or reshaped');
    ok('C1 …with NO fallback path inside it (no `standing ??`, no invented binding literal)',
      composerBody.length > 0 && !/standing\s*\?\?/.test(composerBody) &&
      !/StandingBinding\s*=\s*\{/.test(composerBody) && !/roomKey:\s*['"`]/.test(composerBody),
      composerBody ? 'a fallback binding exists in the composer' : 'StandingComposer body not found');

    // C2 — THE FACEPILE IS SERVED. Deriving people from the authored steps would fork the
    // override-patched server truth (a reassigned gate would still show the original name).
    const peopleBody = bodyOf(detailSrc, 'peopleFor');
    ok('C2 the facepile derivation exists to be gated', peopleBody.length > 0, 'peopleFor not found');
    ok('C2 …and reads SERVED fields only (never assignee_name / assignee_user_id / raw .steps)',
      peopleBody.length > 0 && !/assignee_name/.test(peopleBody) &&
      !/assignee_user_id/.test(peopleBody) && !/\.steps\b/.test(peopleBody),
      peopleBody.replace(/\s+/g, ' ').slice(0, 160));

    // C3 — ONE STATE DERIVATION. The served state is the truth; the local mapper survives only as
    // Timeline's out-of-window fallback.
    const detailCode = codeOf(detailSrc);
    const stateCalls = (detailCode.match(/processStateOf\(/g) ?? []).length;
    ok('C3 exactly ONE processStateOf call site in the detail surface', stateCalls === 1, String(stateCalls));
    ok('C3 …and it is the served-first fallback, never an unconditional re-derivation',
      /served \? served\.state : processStateOf\(/.test(detailCode), 'the call is not served-guarded');

    // C4 — THE LOG DOOR. "N steps" is a receipts link; landing it on the gates tab would answer a
    // question the user did not ask.
    ok('C4 the drawer accepts the tab it should open on', /initialTab\?: 'handoffs' \| 'log';/.test(drawerSrc),
      'initialTab prop missing');
    ok('C4 …and SEEDS its state from it (a prop the state ignores is not a door)',
      /useState<'handoffs' \| 'log'>\(initialTab \?\? 'handoffs'\)/.test(drawerSrc), 'seeding missing');
    ok('C4 the Log cell asks for the log tab', /onOpen\('log'\)/.test(detailCode), "no onOpen('log') in the detail");
    ok('C4 …and the row/gate cells still ask for the gates tab',
      /onOpen\('handoffs'\)/.test(detailCode), "no onOpen('handoffs') in the detail");
    ok('C4 …and the served tab actually reaches the drawer',
      /initialTab=\{openProcess\.tab\}/.test(detailSrc), 'the drawer mount drops the tab');

    // C5 — A NAMELESS DECIDER IS NOT YOU. "You" is claimable only where the gate is the user's own
    // approval; a handoff whose decider we cannot name is "A teammate", never the reader.
    ok('C5 the record drawer never claims "You" for a nameless decider',
      !/deciderName \?\? 'You'/.test(recordDrawerSrc), "a deciderName ?? 'You' fallback exists");
    ok('C5 …and resolves the nameless one BY KIND (approval → You, handoff → A teammate)',
      /d\.kind === 'approval' \? 'You' : 'A teammate'/.test(recordDrawerSrc), 'the kind-based fallback is missing');

    // C6 — THE BADGE POINTS AT ITS ROWS (owner walk, Aug 19: "we see 3 on the nav bar, but we
    // don't know which ones it's referring to"). The sidebar's Workflows badge and the ledger's
    // per-row pills must be the SAME fact: identical predicate triple in both routes (succeeded ·
    // reviewed_at null · 30-day window), the share served per row, and every reviewing deed
    // clearing through the ONE stamp route.
    const recentRouteSrc = await readSrc('app/api/rooms/recent/route.ts');
    const ledgerRouteSrc = await readSrc('app/api/workflows/ledger/route.ts');
    const ledgerSurfaceSrc = await readSrc('components/workflows/workflows-ledger.tsx');
    const badgeTriple = (src: string): boolean =>
      /\.eq\('status', 'succeeded'\)/.test(src) && /\.is\('reviewed_at', null\)/.test(src)
      && /30 \* 86_400_000/.test(src);
    ok('C6 the badge predicate (succeeded · unreviewed · 30d) lives in the sidebar route',
      badgeTriple(recentRouteSrc), 'rooms/recent predicate changed — re-point BOTH halves');
    ok('C6 …and the LEDGER serves the SAME triple per workflow (badge N = Σ row pills)',
      badgeTriple(ledgerRouteSrc) && /unreviewed: unreviewedByWf\.get\(/.test(ledgerRouteSrc),
      'the ledger breakdown predicate drifted from the badge');
    ok('C6 the rows wear the share (pill rendered behind unreviewed > 0)',
      /\(w\.unreviewed \?\? 0\) > 0/.test(ledgerSurfaceSrc) && /\(g\.unreviewed \?\? 0\) > 0/.test(ledgerSurfaceSrc),
      'a served count nothing renders is a mute badge');
    ok('C6 every reviewing deed clears through the ONE stamp (trail expand + deep-dive door)',
      /markReviewed\(g\.workflowId\)/.test(ledgerSurfaceSrc)
      && /\/api\/workflows\/runs\/reviewed/.test(detailSrc),
      'a reviewing door that does not stamp leaves the badge lying');

    // C7 — THE CLIENT OWNS THE CLOCK (hydration, found live Aug 19): the deep-dive header is the
    // ONE place a date renders from SSR'd props — a server-rendered locale/timezone date can never
    // match the browser's. The date must stay behind the hydrated guard.
    ok('C7 the SSR\'d header date renders only after hydration',
      /nextRunAt && hydrated &&/.test(detailSrc), 'the header date lost its hydration guard');
  } catch (e) {
    fail++;
    console.log(`\n  ✗ SUITE THREW — ${(e as Error).message}\n${(e as Error).stack}`);
  } finally {
    console.log('\nCleanup:');
    if (createdRuns.length) {
      await admin.from('commitments').delete().eq('source', 'handoff').in('source_id', createdRuns);
      await admin.from('room_turns').delete().eq('user_id', creatorId)
        .in('room_key', createdRuns.map((r) => `run:${r}`));
      await admin.from('workflow_runs').delete().in('id', createdRuns);
    }
    if (createdWorkflows.length) {
      await admin.from('item_plans').delete().eq('user_id', creatorId)
        .eq('kind', 'workflow_owner').in('entity_id', createdWorkflows);
      await admin.from('activity_events').delete().eq('entity_type', 'workflow').in('entity_id', createdWorkflows);
      await admin.from('workflows').delete().in('id', createdWorkflows);
    }

    // ZERO LEFTOVERS — asserted, on every table this suite touched and every probe it used.
    const { count: wfLeft } = await admin.from('workflows').select('id', { count: 'exact', head: true })
      .eq('user_id', creatorId).eq('description', FIXTURE_TAG);
    ok('no fixture workflows left', (wfLeft ?? 0) === 0, String(wfLeft));
    if (createdRuns.length) {
      const { count: runsLeft } = await admin.from('workflow_runs').select('id', { count: 'exact', head: true }).in('id', createdRuns);
      ok('no fixture runs left', (runsLeft ?? 0) === 0, String(runsLeft));
      const { count: commsLeft } = await admin.from('commitments').select('id', { count: 'exact', head: true })
        .eq('source', 'handoff').in('source_id', createdRuns);
      ok('no handoff commitments left', (commsLeft ?? 0) === 0, String(commsLeft));
      const { count: turnsLeft } = await admin.from('room_turns').select('id', { count: 'exact', head: true })
        .eq('user_id', creatorId).in('room_key', createdRuns.map((r) => `run:${r}`));
      ok('no run-room turns left', (turnsLeft ?? 0) === 0, String(turnsLeft));
    }
    if (createdWorkflows.length) {
      const { count: ownerLeft } = await admin.from('item_plans').select('id', { count: 'exact', head: true })
        .eq('user_id', creatorId).eq('kind', 'workflow_owner').in('entity_id', createdWorkflows);
      ok('no owner-store rows left', (ownerLeft ?? 0) === 0, String(ownerLeft));
      const { count: actsLeft } = await admin.from('activity_events').select('id', { count: 'exact', head: true })
        .eq('entity_type', 'workflow').in('entity_id', createdWorkflows);
      ok('no ownership receipts left', (actsLeft ?? 0) === 0, String(actsLeft));
    }
    const { count: bComms } = await admin.from('commitments').select('id', { count: 'exact', head: true }).eq('user_id', holderId);
    ok('probe B carries no commitments', (bComms ?? 0) === 0, String(bComms));
    const { count: bTurns } = await admin.from('room_turns').select('id', { count: 'exact', head: true }).eq('user_id', holderId);
    ok('probe B carries no room turns', (bTurns ?? 0) === 0, String(bTurns));
    const { count: cTurns } = await admin.from('room_turns').select('id', { count: 'exact', head: true }).eq('user_id', strangerId);
    ok('probe C carries no room turns', (cTurns ?? 0) === 0, String(cTurns));

    // The probes are shared infrastructure: this suite deletes probe C only when it created it.
    if (outsider.created) {
      await admin.auth.admin.deleteUser(strangerId).then(() => {}, () => {});
      const { data: gone } = await admin.auth.admin.getUserById(strangerId);
      ok('probe C (provisioned here) is gone', !gone?.user, String(gone?.user?.id));
    } else {
      note('probe C pre-existed this suite — left in place');
    }

    console.log(`\n${pass}/${pass + fail} passed`);
    process.exit(fail === 0 ? 0 : 1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
