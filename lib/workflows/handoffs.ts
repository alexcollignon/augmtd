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
// short preview — never the workflow. Notification = coworker email, best-effort. REASSIGN is
// deferred to B2 (a per-run assignee override needs its own store).
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
 *  A workflow without a standing binding (manual, never scheduled) simply has no room to narrate
 *  in; the run status still carries the truth. */
async function narrateInOwnerStandingRoom(
  admin: SupabaseClient, wf: HandoffWorkflow, text: string, dedupeKey: string,
): Promise<void> {
  try {
    const { data: c } = await admin.from('commitments').select('id')
      .eq('user_id', wf.user_id).eq('source', 'workflow').eq('source_id', wf.id)
      .eq('status', 'open').limit(1).maybeSingle();
    if (!c) return;
    const { writeRoomTurn, roomKeyForItem } = await import('@/lib/room/turns');
    const roomKey = await roomKeyForItem(admin, wf.user_id, 'commitment', String(c.id));
    await writeRoomTurn(admin, wf.user_id, roomKey, { role: 'system', text, dedupeKey });
  } catch { /* narration is a surface — the run status is the truth */ }
}

/** Best-effort coworker email to a teammate. The workflow's presenting coworker writes it, from
 *  the OWNER's account (the sending identity + cap belong to the person whose work this is). */
async function emailAssignee(
  admin: SupabaseClient, wf: HandoffWorkflow, assigneeUserId: string,
  mail: { subject: string; body: string },
): Promise<void> {
  try {
    const { data: u } = await admin.auth.admin.getUserById(assigneeUserId);
    const to = (u?.user?.email as string | undefined) ?? null;
    if (!to) return;
    const { sendCoworkerEmail } = await import('@/lib/tools/coworker-email');
    await sendCoworkerEmail(admin, wf.user_id, wf.agent_id ?? undefined, {
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
    const ask = (step.ask ?? '').trim() || 'Review and approve';
    const subject = (ctx.subject ?? wf.name).trim();
    const description = `${ask} — ${subject}`.slice(0, MAX_DESCRIPTION);
    const dueDate = step.sla_hours
      ? new Date(Date.now() + Math.ceil(step.sla_hours / 24) * 86400_000).toISOString().slice(0, 10)
      : null;
    const ownerFirst = await firstNameOf(admin, wf.user_id, 'a teammate');

    // (1) THE ASSIGNEE'S ASK — their own deck row. This is the whole attention story for them.
    const { data: commitment } = await admin.from('commitments').insert({
      user_id: step.assignee_user_id,
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
        const roomKey = await roomKeyForItem(admin, step.assignee_user_id, 'commitment', String(commitment.id));
        await writeRoomTurn(admin, step.assignee_user_id, roomKey, {
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
          dedupeKey: `handoff:${ctx.runId}:${step.id}`,
        });
      } catch { /* the commitment already carries the ask */ }
    }

    // (3) The nudge that reaches them where they are — WITH THE DOOR (owner ask, Aug 18: an
    // email about a waiting decision carries the link to the exact room where deciding happens).
    const askUrl = commitment?.id
      ? `${(process.env.AUGMTD_WEBHOOK_BASE_URL || 'https://app.augmtd.ai').replace(/\/$/, '')}/item/${commitment.id}?kind=commitment`
      : null;
    await emailAssignee(admin, wf, step.assignee_user_id, {
      subject: `${wf.name} — waiting on you`,
      body: `Hi,\n\n${ownerFirst} has something waiting on you: ${ask}.\n\n` +
        (askUrl
          ? `Review and approve it here: ${askUrl}\n\n(It's also on your AUGMTD deck.)`
          : `It's on your AUGMTD deck — approve it there and the rest runs itself.`),
    });

    // (4) The OWNER's side of the story: this isn't stalled, it's with someone.
    await narrateInOwnerStandingRoom(
      admin, wf,
      `"${wf.name}" is waiting on ${step.assignee_name ?? 'a teammate'} — ${step.ask ?? 'their review'}.`,
      `handoff-wait:${ctx.runId}:${step.id}`,
    );
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
}

/** THE ONE AUTHORIZATION READ for resuming a run. Owner: always. Assignee: only when the run is
 *  actually parked AND the CURRENT step is a handoff assigned to them — via `parkedGateOf`, so a
 *  blocked-verify tail (guardrail hold) is never granted to anyone but the owner. Everyone else:
 *  refused, with no information leaked. */
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

  if (workflow!.user_id === callerId) {
    const gate = runRow.status === 'awaiting_approval'
      ? parkedGateOf(runRow, workflow!.steps)
      : null;
    const current = (workflow!.steps ?? [])[(runRow.step_outputs ?? []).length];
    return {
      ok: true, role: 'owner', run: runRow, workflow,
      ...(gate?.kind === 'handoff' && current?.type === 'handoff' ? { step: current } : {}),
    };
  }

  if (runRow.status !== 'awaiting_approval') return { ok: false, role: null };
  const gate = parkedGateOf(runRow, workflow!.steps);
  if (gate.kind !== 'handoff' || gate.assigneeUserId !== callerId) return { ok: false, role: null };
  const current = (workflow!.steps ?? [])[(runRow.step_outputs ?? []).length];
  return {
    ok: true, role: 'assignee', run: runRow, workflow,
    ...(current?.type === 'handoff' ? { step: current } : {}),
  };
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
): Promise<{ ok: boolean; capped?: true }> {
  const claimed = await claimNudge(admin, wf.user_id, runId);
  if (!claimed) return { ok: false, capped: true };
  const ask = (step.ask ?? '').trim() || 'Review and approve';
  const ownerFirst = await firstNameOf(admin, wf.user_id, 'a teammate');
  // The chase carries the same door as the original ask (the assignee's commitment room).
  const { data: c } = await admin.from('commitments').select('id')
    .eq('user_id', step.assignee_user_id).eq('source', 'handoff').eq('source_id', runId)
    .eq('status', 'open').limit(1).maybeSingle();
  const askUrl = c?.id
    ? `${(process.env.AUGMTD_WEBHOOK_BASE_URL || 'https://app.augmtd.ai').replace(/\/$/, '')}/item/${c.id}?kind=commitment`
    : null;
  await emailAssignee(admin, wf, step.assignee_user_id, {
    subject: `Still waiting on you — ${wf.name}`,
    body: `Hi,\n\nA quick nudge: ${ownerFirst} is still waiting on you for ${ask}.\n\n` +
      (askUrl ? `It's one click away: ${askUrl}` : `It's on your AUGMTD deck whenever you're ready.`),
  });
  await narrateInOwnerStandingRoom(
    admin, wf,
    `I nudged ${step.assignee_name ?? 'your teammate'} about "${wf.name}" — still waiting on ${step.ask ?? 'their review'}.`,
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
    }, auth.step, runId);
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
        const gate = parkedGateOf({ step_outputs: (r.step_outputs ?? []) as RunLike['step_outputs'] }, wf.steps);
        if (gate.kind !== 'handoff') continue;
        const step = (wf.steps ?? [])[((r.step_outputs ?? []) as unknown[]).length];
        if (!step || step.type !== 'handoff' || !step.sla_hours) continue;

        // PARKED-AT is the assignee's commitment (the run row has no park timestamp). No
        // commitment → nothing to measure honestly, so nothing is chased.
        const { data: c } = await admin.from('commitments').select('created_at')
          .eq('source', 'handoff').eq('source_id', r.id).eq('status', 'open')
          .order('created_at', { ascending: false }).limit(1).maybeSingle();
        if (!c?.created_at) continue;
        const parkedMs = Date.now() - new Date(String(c.created_at)).getTime();
        if (!Number.isFinite(parkedMs) || parkedMs < step.sla_hours * 3600_000) continue;

        await fireNudge(admin, {
          id: wf.id, user_id: wf.user_id, name: wf.name, agent_id: wf.agent_id ?? null,
        }, step, String(r.id));
      } catch { /* one stuck run never stops the sweep */ }
    }
  } catch { /* never break the dispatcher */ }
}
