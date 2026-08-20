// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE HANDOFF ARC (processes arc Phase B, docs/processes-plan.md) — the collaborative half of a
// run: a step that waits on a HUMAN TEAMMATE. Everything here follows from three laws:
//
//   • THE DECK STAYS THE ONE ATTENTION SURFACE, NOW PER PERSON. A parked handoff is not a new
//     queue — it is a `commitments` row on the ASSIGNEE'S deck (direction you_owe,
//     source='handoff', source_id=runId) plus the existing `approval` component turn in that
//     commitment's room. The card, the deck row, the resume door: all machinery that exists.
//   • THE GATE BELONGS TO THE ASSIGNEE. `canResumeRun` is THE ONE authorization read — the owner
//     may always resume; the caller may resume iff the run's CURRENT step is a handoff assigned
//     to them. It defers to `parkedGateOf` so a blocked-verify tail (the guardrail hold) can
//     never be granted to an assignee: a guardrail hold is always the owner's.
//   • THE PARKED RUN STATUS IS THE SOURCE OF TRUTH. The ask, the email, the narrations, the
//     nudge records are all BEST-EFFORT surfaces around it — a failed email never breaks a park,
//     a failed narration never breaks a decision.
//
// Visibility (owner-decided): the assignee sees THEIR step + minimal context — the ask and a
// short preview — never the workflow. Notification = coworker email, best-effort.
//
// B2 — REASSIGN (THE PEOPLE SLICE): a parked handoff's gate can move to another workspace member.
// The store is PER RUN (`item_plans` kind='handoff_override' entity_id=`<runId>:<stepId>`, keyed
// under the CREATOR's user_id) and outranks the step's static assignee everywhere the gate is
// read — THE WORKFLOW STEP NEVER MUTATES: a per-run decision is not an authoring change. The
// reassign route is the ONE writer of that store; every reader here goes through `overrideFor`.
// B2 also splits OWNER from CREATOR (lib/workflows/owner.ts): the accountability owner holds owner
// rights on runs and hears the narrations, while the creator — the execution identity — keeps them.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';
import type { HandoffStep, WorkflowStep } from './types';
import { parkedGateOf, type RunLike } from './process-state';

/** The minimum a handoff needs to know about its workflow (the run loop and the routes all
 *  hold richer rows — this keeps the module callable from any of them). */
export interface HandoffWorkflow {
  id: string;
  user_id: string;
  name: string;
  agent_id?: string | null;
}

const MAX_DESCRIPTION = 200;
const MAX_PREVIEW = 400;

/** First name of a user, for the human voice in commitments and narrations. */
async function firstNameOf(admin: SupabaseClient, userId: string, fallback: string): Promise<string> {
  try {
    const { data } = await admin.from('profiles').select('full_name').eq('id', userId).maybeSingle();
    const full = String((data as { full_name?: string } | null)?.full_name ?? '').trim();
    return full.split(/\s+/)[0] || fallback;
  } catch { return fallback; }
}

/** A waited duration in the words a colleague would use. */
function humanizeWait(ms: number): string {
  const mins = Math.max(0, Math.round(ms / 60000));
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'}`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'}`;
}

/** The OWNER's standing room — the same one narrateApprovalAsk/narrateStandingRun speak into.
 *  B2: "owner" means the ACCOUNTABILITY owner (openStandingCommitment resolves it), so an
 *  ownership change re-points every one of these narrations at once. A workflow without a standing
 *  binding (manual, never scheduled) simply has no room to narrate in; the run status still
 *  carries the truth. */
async function narrateInOwnerStandingRoom(
  admin: SupabaseClient, wf: HandoffWorkflow, text: string, dedupeKey: string,
): Promise<void> {
  try {
    const { openStandingCommitment } = await import('./owner');
    const c = await openStandingCommitment(admin, wf);
    if (!c) return;
    const { writeRoomTurn, roomKeyForItem } = await import('@/lib/room/turns');
    const roomKey = await roomKeyForItem(admin, c.userId, 'commitment', String(c.id));
    await writeRoomTurn(admin, c.userId, roomKey, { role: 'system', text, dedupeKey });
  } catch { /* narration is a surface — the run status is the truth */ }
}

// ── THE PER-RUN ASSIGNEE OVERRIDE (B2) ────────────────────────────────────────────────────────

const OVERRIDE_KIND = 'handoff_override';

export interface HandoffOverride {
  assigneeUserId: string;
  assigneeName?: string;
  /** Reassign generation — 1 for the first move. Makes each ask's dedupe key distinct even when a
   *  step is handed back to someone who already held it. */
  rev: number;
  by?: string;
  at?: string;
}

export const overrideKey = (runId: string, stepId: string): string => `${runId}:${stepId}`;

/** THE ONE OVERRIDE READ. Keyed under the workflow CREATOR (the execution identity owns the run's
 *  bookkeeping rows). Absent → null, and the step's static assignee stands. Never throws. */
export async function overrideFor(
  admin: SupabaseClient, creatorUserId: string, runId: string, stepId: string,
): Promise<HandoffOverride | null> {
  try {
    const { data } = await admin.from('item_plans').select('tasks')
      .eq('user_id', creatorUserId).eq('kind', OVERRIDE_KIND).eq('entity_id', overrideKey(runId, stepId))
      .maybeSingle();
    const t = (data?.tasks ?? null) as Partial<HandoffOverride> | null;
    if (!t?.assigneeUserId) return null;
    return {
      assigneeUserId: t.assigneeUserId, assigneeName: t.assigneeName,
      rev: Number(t.rev ?? 1) || 1, by: t.by, at: t.at,
    };
  } catch { return null; }
}

/** The current handoff step of a parked run (the boundary it stopped at), or null. */
function currentHandoffStep(
  steps: WorkflowStep[] | null | undefined, stepOutputs: unknown[] | null | undefined,
): HandoffStep | null {
  const s = (steps ?? [])[(stepOutputs ?? []).length];
  return s && s.type === 'handoff' ? s : null;
}

/** Best-effort coworker email to a teammate. The workflow's presenting coworker writes it, from
 *  the OWNER's account (the sending identity + cap belong to the person whose work this is).
 *  A workflow with NO presenter falls back to the OWNER'S PERSONAL ASSISTANT (owner call,
 *  Aug 20: a generic team@ sender is a stranger; "Clara · Alexandre's assistant" is the voice
 *  this email already speaks in) — only then to the generic team identity. */
async function emailAssignee(
  admin: SupabaseClient, wf: HandoffWorkflow, assigneeUserId: string,
  mail: { subject: string; body: string },
): Promise<void> {
  try {
    const { data: u } = await admin.auth.admin.getUserById(assigneeUserId);
    const to = (u?.user?.email as string | undefined) ?? null;
    if (!to) return;
    let senderId = wf.agent_id ?? undefined;
    if (!senderId) {
      const { data: pa } = await admin.from('custom_agents').select('id')
        .eq('user_id', wf.user_id).eq('is_worker', true).eq('is_active', true)
        .eq('worker_role', 'personal_assistant').limit(1).maybeSingle();
      senderId = (pa as { id?: string } | null)?.id ?? undefined;
    }
    const { sendCoworkerEmail } = await import('@/lib/tools/coworker-email');
    await sendCoworkerEmail(admin, wf.user_id, senderId, {
      to: [to], subject: mail.subject, body: mail.body,
    });
  } catch { /* a notification that fails never breaks the park */ }
}

// ── THE PARK ──────────────────────────────────────────────────────────────────────────────────

/** A run reached a handoff step: give the ASSIGNEE the ask (their deck + their room), tell them
 *  by email, and tell the OWNER who the wait is on. Every limb is independently best-effort. */
export async function parkHandoff(
  admin: SupabaseClient,
  wf: HandoffWorkflow,
  step: HandoffStep,
  ctx: { runId: string; subject?: string; preview: string },
): Promise<void> {
  try {
    await askAssignee(admin, wf, step, {
      userId: step.assignee_user_id, name: step.assignee_name ?? null,
    }, { runId: ctx.runId, subject: ctx.subject, preview: ctx.preview });

    // The OWNER's side of the story: this isn't stalled, it's with someone.
    await narrateInOwnerStandingRoom(
      admin, wf,
      `"${wf.name}" is waiting on ${step.assignee_name ?? 'a teammate'} — ${step.ask ?? 'their review'}.`,
      `handoff-wait:${ctx.runId}:${step.id}`,
    );
  } catch { /* the parked run status is the source of truth */ }
}

/** LIMBS 1–3 OF THE PARK, for ANY assignee: the deck ask, the room card, the email with the door.
 *  Shared by parkHandoff and reassignHandoff so a reassigned person gets exactly the same ask the
 *  original one got — one implementation of "you now hold this gate". Best-effort throughout. */
async function askAssignee(
  admin: SupabaseClient,
  wf: HandoffWorkflow,
  step: HandoffStep,
  assignee: { userId: string; name?: string | null },
  ctx: { runId: string; subject?: string; preview: string; rev?: number },
): Promise<void> {
  try {
    const ask = (step.ask ?? '').trim() || 'Review and approve';
    const subject = (ctx.subject ?? wf.name).trim();
    const description = `${ask} — ${subject}`.slice(0, MAX_DESCRIPTION);
    const dueDate = step.sla_hours
      ? new Date(Date.now() + Math.ceil(step.sla_hours / 24) * 86400_000).toISOString().slice(0, 10)
      : null;
    const ownerFirst = await firstNameOf(admin, wf.user_id, 'a teammate');

    // (1) THE ASSIGNEE'S ASK — their own deck row. This is the whole attention story for them.
    const { data: commitment } = await admin.from('commitments').insert({
      user_id: assignee.userId,
      direction: 'you_owe',
      description,
      counterparty: ownerFirst,
      due_date: dueDate,
      source: 'handoff',
      source_id: ctx.runId,
      status: 'open',
    }).select('id').maybeSingle();

    // (2) THE ROOM CARD — the SAME `approval` component the owner's parks use, so Approve/Reject
    //     render and post to the ONE resume door. `handoff: true` lets the card speak minimally
    //     (the ask + the preview; never the workflow's insides).
    if (commitment?.id) {
      try {
        const { writeRoomTurn, roomKeyForItem } = await import('@/lib/room/turns');
        const roomKey = await roomKeyForItem(admin, assignee.userId, 'commitment', String(commitment.id));
        await writeRoomTurn(admin, assignee.userId, roomKey, {
          role: 'system',
          text: `${ownerFirst} needs you on this before it moves — ${ask}.`,
          component: {
            key: 'approval', refId: ctx.runId,
            state: {
              runId: ctx.runId, workflowId: wf.id, name: wf.name,
              instruction: step.ask ?? '', preview: ctx.preview.slice(0, MAX_PREVIEW),
              handoff: true,
            },
          },
          // A reassign's ask carries its generation so a step handed BACK to someone who already
          // held it lands as a new turn instead of overwriting the old one in place.
          dedupeKey: `handoff:${ctx.runId}:${step.id}${ctx.rev ? `:r${ctx.rev}` : ''}`,
        });
      } catch { /* the commitment already carries the ask */ }
    }

    // (3) The nudge that reaches them where they are — WITH THE DOOR (owner ask, Aug 18: an
    // email about a waiting decision carries the link to the exact room where deciding happens).
    const askUrl = commitment?.id
      ? `${(process.env.AUGMTD_WEBHOOK_BASE_URL || 'https://app.augmtd.ai').replace(/\/$/, '')}/item/${commitment.id}?kind=commitment`
      : null;
    await emailAssignee(admin, wf, assignee.userId, {
      subject: `${wf.name} — waiting on you`,
      body: `Hi,\n\n${ownerFirst} has something waiting on you: ${ask}.\n\n` +
        (askUrl
          ? `Review and approve it here: ${askUrl}\n\n(It's also on your AUGMTD deck.)`
          : `It's on your AUGMTD deck — approve it there and the rest runs itself.`),
    });
  } catch { /* the parked run status is the source of truth */ }
}

// ── THE GATE ──────────────────────────────────────────────────────────────────────────────────

export interface ResumeAuthorization {
  ok: boolean;
  role: 'owner' | 'assignee' | null;
  run?: RunLike & { user_id: string };
  workflow?: { id: string; user_id: string; name: string; agent_id?: string | null; steps?: WorkflowStep[] | null };
  /** The handoff step whose gate the caller holds (assignee) or that the run is parked at. */
  step?: HandoffStep;
  /** B2: WHO actually holds the parked handoff gate right now — the per-run override if one
   *  exists, else the step's static assignee. Present only when the run is parked at a handoff. */
  assignee?: { userId: string; name?: string | null };
  /** The active per-run override, if any (its `rev` numbers the next reassign). */
  override?: HandoffOverride | null;
}

/** THE ONE AUTHORIZATION READ for resuming a run. Owner rights: the CREATOR (execution identity —
 *  it keeps control of its own runs) OR the ACCOUNTABILITY OWNER (B2). Assignee: only when the run
 *  is actually parked AND the CURRENT gate is a handoff held by them — via `parkedGateOf` WITH the
 *  per-run override, so a reassigned person is authorized and the person they replaced is not, and
 *  so a blocked-verify tail (guardrail hold) is never granted to anyone but the owner. Everyone
 *  else: refused, with no information leaked. */
export async function canResumeRun(
  admin: SupabaseClient, runId: string, callerId: string,
): Promise<ResumeAuthorization> {
  const { data: run } = await admin.from('workflow_runs')
    .select('id, workflow_id, user_id, status, triggered_by, step_outputs, error, started_at, completed_at, created_at')
    .eq('id', runId).maybeSingle();
  if (!run) return { ok: false, role: null };

  const { data: wf } = await admin.from('workflows')
    .select('id, user_id, name, agent_id, steps').eq('id', run.workflow_id).maybeSingle();
  if (!wf) return { ok: false, role: null };

  const workflow = wf as ResumeAuthorization['workflow'];
  const runRow = run as unknown as RunLike & { user_id: string };
  const current = currentHandoffStep(workflow!.steps, runRow.step_outputs);
  const override = current
    ? await overrideFor(admin, workflow!.user_id, runId, current.id)
    : null;
  const gate = runRow.status === 'awaiting_approval'
    ? parkedGateOf(runRow, workflow!.steps, override)
    : null;
  const held = gate?.kind === 'handoff' && current
    ? { step: current, assignee: { userId: gate.assigneeUserId!, name: gate.assigneeName ?? null }, override }
    : {};

  // THE CREATOR KEEPS OWNER RIGHTS; the accountability owner GAINS them (only read when needed).
  let isOwner = workflow!.user_id === callerId;
  if (!isOwner) {
    const { ownerOf } = await import('./owner');
    isOwner = (await ownerOf(admin, workflow!.id, workflow!.user_id)).userId === callerId;
  }
  if (isOwner) return { ok: true, role: 'owner', run: runRow, workflow, ...held };

  if (runRow.status !== 'awaiting_approval' || !gate) return { ok: false, role: null };
  if (gate.kind !== 'handoff' || gate.assigneeUserId !== callerId) return { ok: false, role: null };
  return { ok: true, role: 'assignee', run: runRow, workflow, ...held };
}

// ── THE DECISION ──────────────────────────────────────────────────────────────────────────────

/** A handoff was decided (approve or reject, through the ONE resume door): close the assignee's
 *  commitment wherever it lives, log the WAITED TIME (created_at → now — the number that makes a
 *  slow gate visible), and narrate both sides. Best-effort throughout: the run row already
 *  carries the decision. */
export async function settleHandoffDecision(
  admin: SupabaseClient,
  args: { runId: string; workflow: HandoffWorkflow; callerId: string; approved: boolean },
): Promise<void> {
  const { runId, workflow: wf, callerId, approved } = args;
  try {
    const { data: c } = await admin.from('commitments')
      .select('id, user_id, created_at')
      .eq('source', 'handoff').eq('source_id', runId).eq('status', 'open')
      .order('created_at', { ascending: false }).limit(1).maybeSingle();

    const decider = await firstNameOf(admin, callerId, 'A teammate');
    const nowIso = new Date().toISOString();
    let waited: string | null = null;

    if (c?.id) {
      const created = c.created_at ? new Date(String(c.created_at)).getTime() : NaN;
      if (Number.isFinite(created)) waited = humanizeWait(Date.now() - created);
      await admin.from('commitments').update({
        status: approved ? 'completed' : 'dismissed',
        resolved_reason: approved ? 'handoff approved' : 'handoff held back',
        resolved_at: nowIso,
      }).eq('id', c.id);

      // The assignee's room closes its own loop — their card said "waiting on you"; this says why
      // it no longer is.
      try {
        const { writeRoomTurn, roomKeyForItem } = await import('@/lib/room/turns');
        const roomKey = await roomKeyForItem(admin, String(c.user_id), 'commitment', String(c.id));
        await writeRoomTurn(admin, String(c.user_id), roomKey, {
          role: 'system',
          text: approved
            ? 'You approved — the run continued.'
            : 'You held this back — nothing was delivered.',
          dedupeKey: `handoff-closed:${runId}`,
        });
      } catch { /* the closed commitment is the truth */ }
    }

    await narrateInOwnerStandingRoom(
      admin, wf,
      `${decider} ${approved ? 'approved' : 'held back'} "${wf.name}"${waited ? ` after ${waited}` : ''}.`,
      `handoff-decided:${runId}`,
    );

    // THE RUN-ROOM RIDER (B2): every process gets a spoken decision trail — even a manual workflow
    // with no standing binding, whose narration used to reach the activity ledger only.
    // ONE RUN ROOM (mockup wave): keyed to the CREATOR, like the comments route — ownership is
    // transferable, execution identity is not; keying on the owner split the trail across two
    // users' rooms after a transfer.
    try {
      const { narrateInRunRoom } = await import('./owner');
      await narrateInRunRoom(
        admin, wf.user_id, runId,
        `${decider} ${approved ? 'approved' : 'held back'} "${wf.name}"${waited ? ` after ${waited}` : ''}.`,
        `handoff-decided:${runId}`,
      );
    } catch { /* the run row already carries the decision */ }

    try {
      const { logActivity } = await import('@/lib/activity/log');
      await logActivity(admin, wf.user_id, {
        type: approved ? 'marked_done' : 'dismissed',
        title: `${decider} ${approved ? 'approved' : 'held back'} "${wf.name}"${waited ? ` after ${waited}` : ''}`,
        entityType: 'workflow_run',
        entityId: runId,
        metadata: { runId, workflowId: wf.id, approved, waited },
      });
    } catch { /* the ledger is a receipt, never a gate */ }
  } catch { /* the run row already carries the decision */ }
}

// ── THE CHASE ─────────────────────────────────────────────────────────────────────────────────

const NUDGE_KIND = 'handoff_nudge';

/** ≤1 nudge per run per day. The fire record is the CLAIM (insert-first — two concurrent chases
 *  can't both win on the unique (user_id, kind, entity_id)); a losing insert falls back to a read
 *  so a table without the constraint still caps. */
async function claimNudge(admin: SupabaseClient, ownerId: string, runId: string): Promise<boolean> {
  const day = new Date().toISOString().slice(0, 10);
  const entityId = `${runId}:${day}`;
  const { error } = await admin.from('item_plans').insert({
    user_id: ownerId, kind: NUDGE_KIND, entity_id: entityId, tasks: [{ runId, at: new Date().toISOString() }],
  });
  if (!error) return true;
  const { data: existing } = await admin.from('item_plans').select('id')
    .eq('user_id', ownerId).eq('kind', NUDGE_KIND).eq('entity_id', entityId).limit(1).maybeSingle();
  return !existing; // no row and the insert still failed → the record layer is down; don't chase
}

/** Send the chase: the coworker emails the assignee again and the owner's room says it happened.
 *  Shared by the on-demand Nudge button and the SLA sweep — one behaviour, one cap. */
async function fireNudge(
  admin: SupabaseClient, wf: HandoffWorkflow, step: HandoffStep, runId: string,
  /** WHO holds the gate right now — the per-run override outranks the step (B2). */
  assignee: { userId: string; name?: string | null },
): Promise<{ ok: boolean; capped?: true }> {
  const claimed = await claimNudge(admin, wf.user_id, runId);
  if (!claimed) return { ok: false, capped: true };
  const ask = (step.ask ?? '').trim() || 'Review and approve';
  const ownerFirst = await firstNameOf(admin, wf.user_id, 'a teammate');
  // The chase carries the same door as the original ask (the assignee's commitment room).
  const { data: c } = await admin.from('commitments').select('id')
    .eq('user_id', assignee.userId).eq('source', 'handoff').eq('source_id', runId)
    .eq('status', 'open').limit(1).maybeSingle();
  const askUrl = c?.id
    ? `${(process.env.AUGMTD_WEBHOOK_BASE_URL || 'https://app.augmtd.ai').replace(/\/$/, '')}/item/${c.id}?kind=commitment`
    : null;
  await emailAssignee(admin, wf, assignee.userId, {
    subject: `Still waiting on you — ${wf.name}`,
    body: `Hi,\n\nA quick nudge: ${ownerFirst} is still waiting on you for ${ask}.\n\n` +
      (askUrl ? `It's one click away: ${askUrl}` : `It's on your AUGMTD deck whenever you're ready.`),
  });
  await narrateInOwnerStandingRoom(
    admin, wf,
    `I nudged ${assignee.name ?? step.assignee_name ?? 'your teammate'} about "${wf.name}" — still waiting on ${step.ask ?? 'their review'}.`,
    `handoff-nudge:${runId}:${new Date().toISOString().slice(0, 10)}`,
  );
  return { ok: true };
}

/** The drawer's NUDGE (owner-only, on demand). Same cap, same behaviour as the SLA chase. */
export async function nudgeHandoff(
  admin: SupabaseClient, runId: string, opts: { byUserId: string },
): Promise<{ ok: boolean; capped?: true }> {
  try {
    const auth = await canResumeRun(admin, runId, opts.byUserId);
    if (!auth.ok || auth.role !== 'owner' || !auth.workflow) return { ok: false };
    if (auth.run?.status !== 'awaiting_approval' || !auth.step) return { ok: false };
    return await fireNudge(admin, {
      id: auth.workflow.id, user_id: auth.workflow.user_id,
      name: auth.workflow.name, agent_id: auth.workflow.agent_id ?? null,
    }, auth.step, runId, auth.assignee ?? { userId: auth.step.assignee_user_id, name: auth.step.assignee_name ?? null });
  } catch { return { ok: false }; }
}

/** THE SLA CHASE (the missed-promise floor, generalized to people): a handoff parked longer than
 *  its `sla_hours` gets chased — once a day, by the coworker, with the owner's room told. Wired
 *  into the dispatch cron's after() tails. Never throws. */
export async function sweepHandoffSLAs(admin: SupabaseClient): Promise<void> {
  try {
    const { data: runs } = await admin.from('workflow_runs')
      .select('id, workflow_id, status, step_outputs')
      .eq('status', 'awaiting_approval').limit(100);
    if (!runs?.length) return;

    const wfIds = [...new Set(runs.map(r => String(r.workflow_id)))];
    const { data: wfs } = await admin.from('workflows')
      .select('id, user_id, name, agent_id, steps').in('id', wfIds);
    const wfById = new Map<string, HandoffWorkflow & { steps?: WorkflowStep[] | null }>();
    for (const w of (wfs ?? []) as Array<HandoffWorkflow & { steps?: WorkflowStep[] | null }>) {
      wfById.set(String(w.id), w);
    }

    for (const r of runs as Array<{ id: string; workflow_id: string; step_outputs: unknown }>) {
      try {
        const wf = wfById.get(String(r.workflow_id));
        if (!wf) continue;
        const step = currentHandoffStep(wf.steps, (r.step_outputs ?? []) as unknown[]);
        if (!step || !step.sla_hours) continue;
        // The per-run override outranks the step: a reassigned gate chases the CURRENT holder.
        const override = await overrideFor(admin, wf.user_id, String(r.id), step.id);
        const gate = parkedGateOf(
          { step_outputs: (r.step_outputs ?? []) as RunLike['step_outputs'] }, wf.steps, override,
        );
        if (gate.kind !== 'handoff' || !gate.assigneeUserId) continue;

        // PARKED-AT is the assignee's commitment (the run row has no park timestamp). No
        // commitment → nothing to measure honestly, so nothing is chased. After a reassign the
        // newest open row is the NEW holder's, so the SLA clock restarts with them — a person is
        // never chased for time they were not yet asked for.
        const { data: c } = await admin.from('commitments').select('created_at')
          .eq('source', 'handoff').eq('source_id', r.id).eq('status', 'open')
          .order('created_at', { ascending: false }).limit(1).maybeSingle();
        if (!c?.created_at) continue;
        const parkedMs = Date.now() - new Date(String(c.created_at)).getTime();
        if (!Number.isFinite(parkedMs) || parkedMs < step.sla_hours * 3600_000) continue;

        await fireNudge(admin, {
          id: wf.id, user_id: wf.user_id, name: wf.name, agent_id: wf.agent_id ?? null,
        }, step, String(r.id), { userId: gate.assigneeUserId, name: gate.assigneeName ?? null });
      } catch { /* one stuck run never stops the sweep */ }
    }
  } catch { /* never break the dispatcher */ }
}

// ── THE REASSIGN (B2) ─────────────────────────────────────────────────────────────────────────

/** MOVE A PARKED HANDOFF TO SOMEONE ELSE. Owner-only (creator or accountability owner). The
 *  authored workflow is NEVER touched — the move is a per-run override row; every gate reader
 *  consults it (canResumeRun, the SLA chase, the served ledger), so authorization, the chase and
 *  the strip all speak the CURRENT assignee from the same truth.
 *
 *  The sequence: authorize → override → close the old ask honestly → ask the new person exactly as
 *  a park would → narrate the owner's room and the run room → log. Only the override write is
 *  fatal; everything after it is best-effort (the override IS who holds the gate). */
export async function reassignHandoff(
  admin: SupabaseClient,
  args: { runId: string; byUserId: string; newAssigneeUserId: string; newAssigneeName?: string | null },
): Promise<{ ok: true; assignee: { userId: string; name: string | null }; rev: number }
  | { ok: false; error: string; status?: number }> {
  const { runId, byUserId, newAssigneeUserId } = args;
  try {
    const auth = await canResumeRun(admin, runId, byUserId);
    // A refusal leaks nothing: a stranger and a missing run look the same.
    if (!auth.ok || !auth.workflow || !auth.run) return { ok: false, error: 'run not found', status: 404 };
    if (auth.role !== 'owner') return { ok: false, error: 'run not found', status: 404 };
    if (auth.run.status !== 'awaiting_approval') {
      return { ok: false, error: `run is ${String(auth.run.status)} — there is no gate to move`, status: 409 };
    }
    const step = auth.step;
    // A guardrail hold is ALWAYS the owner's (parkedGateOf's law order) — nothing to hand over.
    if (!step || !auth.assignee) {
      return { ok: false, error: 'this run is not waiting on a person', status: 409 };
    }
    const from = auth.assignee;
    if (from.userId === newAssigneeUserId) {
      return { ok: false, error: 'they already hold this', status: 409 };
    }

    const wf: HandoffWorkflow = {
      id: auth.workflow.id, user_id: auth.workflow.user_id,
      name: auth.workflow.name, agent_id: auth.workflow.agent_id ?? null,
    };
    const rev = (auth.override?.rev ?? 0) + 1;
    const newName = (args.newAssigneeName ?? '').trim()
      || await firstNameOf(admin, newAssigneeUserId, 'a teammate');
    const fromName = (from.name ?? '').trim() || await firstNameOf(admin, from.userId, 'your teammate');
    const nowIso = new Date().toISOString();

    // (1) THE OVERRIDE — the only fatal limb: it IS the gate from here on.
    const { error: upErr } = await admin.from('item_plans').upsert({
      user_id: wf.user_id, kind: OVERRIDE_KIND, entity_id: overrideKey(runId, step.id),
      tasks: { assigneeUserId: newAssigneeUserId, assigneeName: newName, rev, by: byUserId, at: nowIso },
      updated_at: nowIso,
    }, { onConflict: 'user_id,kind,entity_id' });
    if (upErr) return { ok: false, error: 'the reassign could not be saved', status: 500 };

    // (2) THE OLD ASK DIES WITH ITS WORK — the person it left owes nothing now, and their room
    //     says so (a deck row that silently vanishes is the class this closes).
    try {
      const { data: old } = await admin.from('commitments').select('id')
        .eq('user_id', from.userId).eq('source', 'handoff').eq('source_id', runId).eq('status', 'open')
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (old?.id) {
        await admin.from('commitments').update({
          status: 'completed', resolved_reason: 'reassigned', resolved_at: nowIso,
        }).eq('id', old.id);
        const { writeRoomTurn, roomKeyForItem } = await import('@/lib/room/turns');
        const roomKey = await roomKeyForItem(admin, from.userId, 'commitment', String(old.id));
        await writeRoomTurn(admin, from.userId, roomKey, {
          role: 'system',
          text: `This moved to ${newName} — nothing more needed from you.`,
          dedupeKey: `handoff-reassigned-away:${runId}:r${rev}`,
        });
      }
    } catch { /* the override already moved the gate */ }

    // (3) THE NEW PERSON GETS THE SAME ASK A PARK WOULD HAVE GIVEN THEM (limbs 1–3, one impl).
    // Same preview shape the park itself builds (the last step's output, stringified, clipped).
    const prev = ((auth.run.step_outputs ?? [])[(auth.run.step_outputs ?? []).length - 1] as { output?: unknown })?.output;
    const preview = (typeof prev === 'string' ? prev : JSON.stringify(prev ?? '')).slice(0, MAX_PREVIEW);
    await askAssignee(admin, wf, step, { userId: newAssigneeUserId, name: newName },
      { runId, subject: wf.name, preview, rev });

    // (4) + (5) The owner hears it, the run room records it, the ledger keeps the receipt.
    const line = `Moved "${wf.name}" from ${fromName} to ${newName}.`;
    await narrateInOwnerStandingRoom(admin, wf, line, `handoff-reassigned:${runId}:r${rev}`);
    try {
      // Creator-keyed like every run-room write (ONE RUN ROOM — see the decision rider above).
      const { narrateInRunRoom } = await import('./owner');
      await narrateInRunRoom(admin, wf.user_id, runId, line, `handoff-reassigned:${runId}:r${rev}`);
    } catch { /* the override is the truth */ }
    try {
      const { logActivity } = await import('@/lib/activity/log');
      await logActivity(admin, wf.user_id, {
        type: 'handoff_reassigned',
        title: line,
        entityType: 'workflow_run', entityId: runId,
        metadata: { runId, workflowId: wf.id, stepId: step.id, from: from.userId, to: newAssigneeUserId, by: byUserId, rev },
      });
    } catch { /* the ledger is a receipt, never a gate */ }

    return { ok: true, assignee: { userId: newAssigneeUserId, name: newName }, rev };
  } catch {
    return { ok: false, error: 'the reassign failed', status: 500 };
  }
}
