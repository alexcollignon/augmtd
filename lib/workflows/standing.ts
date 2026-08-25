// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE STANDING BINDING (Arc 2 stage 1 — docs/one-surface-plan.md: "workflows become standing
// commitments"). A SCHEDULED workflow is a standing promise of the team — so it gets exactly ONE
// open commitment row (source='workflow', source_id=workflow.id) whose due_date always points at
// the NEXT scheduled run. The payoff is structural: every existing commitment machine applies for
// free — most importantly, a workflow that SILENTLY DIES (dispatcher stall, null next_run_at,
// provider outage) leaves its due_date in the past and surfaces as an OVERDUE DEBT on the deck.
// The pilot briefing that was dead for a month with no surface owing anyone an explanation — that
// class dies here.
//
// LAWS:
//   • ONE row per workflow, advanced in place (a standing promise is one commitment, not N).
//   • A USER'S DISMISSAL STICKS (the pinning law's analog): a dismissed standing commitment is a
//     human decision — never resurrected while the row exists; pausing/unpausing the workflow
//     doesn't override the human.
//   • THE DEBT SITS WITH THE OWNER, NOT THE CREATOR (B2 — lib/workflows/owner.ts): the row is
//     created for the ACCOUNTABILITY owner; when ownership moves, the open row moves too (the old
//     one closes with resolved_reason 'ownership moved', a fresh one opens for the new owner) and
//     this hourly convergent door makes that self-healing. A DISMISSED row never resurrects — not
//     for the old owner (it stays closed) and not for the new one (their own dismissal sticks).
//   • Paused/deleted/manual workflows close their commitment honestly (resolved_reason says why).
//   • The JUDGE holds the floor (lib/work/judge.ts): a source='workflow' commitment is judged
//     none structurally — its WORKFLOW produces it; the prepare pass must never delegate it.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { SupabaseClient } from '@supabase/supabase-js';

type WfRow = {
  id: string; user_id: string; name: string; status: string;
  trigger: { type?: string } | null; next_run_at: string | null; agent_id?: string | null;
};

export async function syncStandingCommitment(
  admin: SupabaseClient, wf: WfRow, workerName?: string | null,
  /** `owner` lets a batch caller (the hourly door) pass a pre-resolved owner — one query for the
   *  whole set instead of one per workflow. */
  opts?: { fromSuccessfulRun?: boolean; owner?: { userId: string; explicit: boolean } },
): Promise<void> {
  try {
    const standing = wf.status === 'active' && wf.trigger?.type === 'schedule';
    const owner = opts?.owner ?? await (await import('./owner')).ownerOf(admin, wf.id, wf.user_id);

    // THE OWNERSHIP MOVE (B2): with an explicit owner, an OPEN row under anyone else is a debt
    // sitting with the wrong person — close it honestly. Only OPEN rows move; a dismissed row is a
    // human decision and stays exactly where the human left it.
    if (owner.explicit) {
      const { data: strays } = await admin.from('commitments').select('id')
        .eq('source', 'workflow').eq('source_id', wf.id).eq('status', 'open')
        .neq('user_id', owner.userId).limit(10);
      for (const s of (strays ?? []) as Array<{ id: string }>) {
        await admin.from('commitments').update({
          status: 'completed', resolved_reason: 'ownership moved', resolved_at: new Date().toISOString(),
        }).eq('id', s.id);
      }
    }

    const { data: existing } = await admin.from('commitments')
      .select('id, status, due_date, description')
      .eq('user_id', owner.userId).eq('source', 'workflow').eq('source_id', wf.id)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();

    if (!standing) {
      // Not (or no longer) a standing promise — close an open row honestly; touch nothing else.
      if (existing?.status === 'open') {
        await admin.from('commitments').update({
          status: 'dismissed', resolved_reason: 'standing task paused or unscheduled', resolved_at: new Date().toISOString(),
        }).eq('id', existing.id);
      }
      return;
    }

    const dueDate = wf.next_run_at ? wf.next_run_at.slice(0, 10) : existing?.due_date ?? null;
    const description = `Standing: ${wf.name} — scheduled deliverable`;

    if (existing) {
      if (existing.status !== 'open') return; // a human dismissed it — the decision sticks
      // THE MISSED-PROMISE FLOOR (found by design review of the failing-runs class): the dispatcher
      // advances next_run_at BEFORE running, so a run that FAILS every time would keep pushing the
      // due_date into the future and the debt would never show. A PAST due_date is a missed promise
      // — only a SUCCESSFUL run may advance it; the hourly healer never papers over it.
      const today = new Date().toISOString().slice(0, 10);
      const duePast = !!existing.due_date && existing.due_date < today;
      const nextDue = duePast && !opts?.fromSuccessfulRun ? existing.due_date : dueDate;
      if (existing.due_date !== nextDue || existing.description !== description) {
        await admin.from('commitments').update({ due_date: nextDue, description }).eq('id', existing.id);
      }
      return;
    }
    await admin.from('commitments').insert({
      user_id: owner.userId, direction: 'awaiting', description,
      counterparty: workerName || 'Your team',
      due_date: dueDate, source: 'workflow', source_id: wf.id, status: 'open',
    });
  } catch { /* the binding is bookkeeping — it must never break a run or a dispatch */ }
}

/** ARC 2 stage 3 — THE RUN LANDS IN THE ROOM. The standing commitment IS the object and its room
 *  is the home (the deck's "Standing:" row already opens it): a successful run narrates there as
 *  the coworker's authored turn with the deliverable link; a FAILED run narrates honestly AND
 *  stamps the due_date to today — the promise came due and was not kept, so the debt shows. */
export async function narrateStandingRun(
  admin: SupabaseClient, wf: WfRow,
  run: { ok: boolean; runId: string; threadId: string | null; workerName: string; error?: string | null },
): Promise<void> {
  try {
    // THE OWNER'S ROOM (B2): the standing row lives with the accountability owner, not the creator.
    const { openStandingCommitment } = await import('./owner');
    const c = await openStandingCommitment(admin, wf);
    if (!c) return; // no standing row (manual task / dismissed) — nothing owes narration
    const { writeRoomTurn, roomKeyForItem } = await import('@/lib/room/turns');
    const roomKey = await roomKeyForItem(admin, c.userId, 'commitment', String(c.id));
    const first = run.workerName.split(' ')[0];
    const threadHref = run.threadId ? `/home?chat=worker:${run.threadId}:${wf.agent_id ?? ''}` : null;
    if (run.ok) {
      // ONE-NARRATOR LAW: third-person orchestration narration — the CoS voice, author absent.
      await writeRoomTurn(admin, c.userId, roomKey, {
        role: 'system',
        text: `${first} produced "${wf.name}" — this run is ready to review.`,
        refs: threadHref ? [{ label: 'Open the deliverable', href: threadHref }] : undefined,
        dedupeKey: `run:${run.runId}`,
      });
    } else {
      await admin.from('commitments').update({ due_date: new Date().toISOString().slice(0, 10) }).eq('id', c.id);
      await writeRoomTurn(admin, c.userId, roomKey, {
        role: 'system',
        text: `The "${wf.name}" run FAILED${run.error ? ` — ${String(run.error).slice(0, 140)}` : ''}. It stays owed until a run lands; it will retry on the next schedule.`,
        refs: threadHref ? [{ label: 'See what happened', href: threadHref }] : undefined,
        dedupeKey: `run-fail:${run.runId}`,
      });
    }
  } catch { /* narration is bookkeeping — never breaks a run */ }
}

// ── THE UNBOUND APPROVAL ASK (Aug 25 — found live: a pilot had six runs waiting at his approval
// and his Home never said so) ─────────────────────────────────────────────────────────────────────
//
// THE DECK IS THE ATTENTION SURFACE (experience spec). A parked run's ask reached it only through
// the standing commitment's room — which ONLY A SCHEDULED workflow has. Event-fired, material and
// manual runs parked INVISIBLY: reachable from the workflows page and the drawer, absent from the
// Home. This limb closes that, and ONLY that: it fires from the `!c` branch of the two narrations
// above, so a scheduled park keeps its standing-room narration byte-for-byte and no run ever wears
// two attention rows.
//
// THE SHAPE IS THE HANDOFF LIMB'S (lib/workflows/handoffs.ts `askAssignee`), deliberately: a
// `commitments` row (direction you_owe, source='handoff', source_id=<runId>, due TODAY) plus the
// same `approval` component turn in that commitment's room. Same source word = every existing
// reader is already correct, with zero new surface: the judge's HANDOFF FLOOR (deciding IS the
// work — no drafter, no delegation), the deck row, the commitment deep-dive's decision card (which
// serves the gated work through `handoffContextFor` and posts Approve/Hold to the ONE resume door),
// and the clearing read below.
//
// Every limb is best-effort: a failed ask never costs the park (the parked run status is the
// truth). Test mode never reaches here — both parks return before their narration when isTest.
const DECISION_SOURCE = 'handoff';

const sameWords = (a: string, b: string) =>
  a.trim().toLowerCase().replace(/\s+/g, ' ') === b.trim().toLowerCase().replace(/\s+/g, ' ');

/** THE RUN'S SUBJECT, through THE EXISTING DERIVATION (process-state's subject ladder — the event's
 *  own title for an event run, the deliverable title for a manual one, the case, then the workflow
 *  name). Never re-derived here: two readings of "what is this run about" is the drift class. */
async function runSubject(admin: SupabaseClient, wf: WfRow, runId: string): Promise<string> {
  try {
    const { data: r } = await admin.from('workflow_runs')
      .select('id, workflow_id, status, triggered_by, error, started_at, completed_at, created_at')
      .eq('id', runId).maybeSingle();
    if (!r) return '';
    const { deriveProcessRows } = await import('./process-state');
    // step_outputs is deliberately not selected: only the SUBJECT is read here, and a park's
    // snapshot can be large.
    const rows = await deriveProcessRows(
      admin, wf.user_id,
      [{ ...(r as Record<string, unknown>), step_outputs: null }] as never,
      new Map([[wf.id, { name: wf.name }]]),
    );
    return String(rows[0]?.subject ?? '').trim();
  } catch { return ''; }
}

/** Raise (or re-use) the owner's deck ask for a run parked on a human decision.
 *  EXACTLY-ONCE PER RUN: an open ask for this run is never doubled — a re-park after a retry finds
 *  the standing row and only re-speaks its card (which the dedupe key folds in place). */
async function raiseRunDecisionAsk(
  admin: SupabaseClient, wf: WfRow,
  ask: {
    runId: string; instruction: string; preview: string; text: string; dedupeKey: string; held?: boolean;
    /** THE INPUT STATION: the ask is for MATERIAL, not a yes/no — the row's description leads with
     *  the station's own words and NO `approval` component is written (see narrateInputAsk). */
    supply?: string;
  },
): Promise<void> {
  try {
    // THE ACCOUNTABILITY LAYER, REUSED (lib/workflows/owner.ts): the ask belongs to whoever owns
    // the workflow — the explicit owner row if there is one, else the creator.
    const { ownerOf } = await import('./owner');
    const owner = await ownerOf(admin, wf.id, wf.user_id);

    const { data: existing } = await admin.from('commitments').select('id, description')
      .eq('source', DECISION_SOURCE).eq('source_id', ask.runId).eq('status', 'open')
      .order('created_at', { ascending: false }).limit(1).maybeSingle();

    let commitmentId = existing?.id ? String(existing.id) : null;
    // THE ASK ON THE DECK NAMES WHAT THE RUN IS ACTUALLY WAITING FOR (Aug 25, the multi-station
    // wave). Re-use is keyed on the RUN, but a run with several stations parks several times — and
    // an open row still wearing station 1's words while the run waits at station 2 is a lie the
    // person would answer with the wrong material. If a re-used row's description no longer leads
    // with this station's ask, it is rewritten to it. (Approval asks are unaffected: their text is
    // the same sentence every time, so this never fires for them.)
    if (commitmentId && ask.supply) {
      const now = String(existing?.description ?? '');
      if (!now.startsWith(ask.supply.slice(0, 60))) {
        const subject = await runSubject(admin, wf, ask.runId);
        const title = subject && !sameWords(subject, wf.name) ? `${subject} — ${wf.name}` : wf.name;
        await admin.from('commitments')
          .update({ description: `${ask.supply} — ${title}`.slice(0, 200) })
          .eq('id', commitmentId);
      }
    }
    if (!commitmentId) {
      const subject = await runSubject(admin, wf, ask.runId);
      const title = subject && !sameWords(subject, wf.name) ? `${subject} — ${wf.name}` : wf.name;
      const { data: created } = await admin.from('commitments').insert({
        user_id: owner.userId,
        direction: 'you_owe',
        // The supply ask wears `<ask> — <subject>` — the SAME shape askAssignee writes, which is
        // what `askFromDescription` (handoff-context, run-record) parses back into the ask.
        description: (ask.supply ? `${ask.supply} — ${title}` : `Approve before it delivers: ${title}`).slice(0, 200),
        counterparty: 'Your team',
        // Due TODAY — the same stamp the standing park uses: a decision owed now.
        due_date: new Date().toISOString().slice(0, 10),
        source: DECISION_SOURCE,
        source_id: ask.runId,
        status: 'open',
      }).select('id').maybeSingle();
      commitmentId = created?.id ? String(created.id) : null;
    }
    if (!commitmentId) return;

    const { writeRoomTurn, roomKeyForItem } = await import('@/lib/room/turns');
    const roomKey = await roomKeyForItem(admin, owner.userId, 'commitment', commitmentId);
    await writeRoomTurn(admin, owner.userId, roomKey, {
      role: 'system',
      text: ask.text,
      // NO LYING DOOR: the `approval` component renders Approve / Hold back. A station waiting for
      // MATERIAL cannot be answered with a yes/no (the resume door refuses a bare approve there),
      // so the supply ask writes the narration alone — the deep-dive's input card, served on the
      // commitment payload, is the door that can actually be answered.
      ...(ask.supply ? {} : {
        component: {
          key: 'approval' as const, refId: ask.runId,
          state: {
            runId: ask.runId, workflowId: wf.id, name: wf.name,
            instruction: ask.instruction, preview: ask.preview,
            ...(ask.held ? { held: true } : {}),
          },
        },
      }),
      dedupeKey: ask.dedupeKey,
    });
  } catch { /* the parked run status is the source of truth; the ask is a surface */ }
}

/** THE INPUT STATION'S ASK (relay canvas, THE WAVE): a run parked at an `input` step needs
 *  something only the owner has. It raises the SAME deck ask the unbound approval raises — one
 *  `commitments` row on the owner's deck, cleared through the ONE resume door.
 *
 *  THE ASYMMETRY, STATED: unlike the approval ask, this one fires for EVERY park, bound or not —
 *  a scheduled workflow included. The bound approval can live in the standing commitment's room
 *  because that room can render the `approval` component and the whole decision is a yes/no. There
 *  is no standing-room equivalent for SUPPLYING CONTENT: the paste box and the pin-a-document door
 *  live on the input ask's own deep-dive, so a scheduled run with no ask row would be a park no
 *  surface could answer. The standing row keeps its own meaning (the next scheduled deliverable);
 *  this row is about THIS parked run, and it closes when the run moves on. */
export async function narrateInputAsk(
  admin: SupabaseClient, wf: WfRow,
  ask: { runId: string; ask: string; preview: string; stepId?: string },
): Promise<void> {
  await raiseRunDecisionAsk(admin, wf, {
    runId: ask.runId, instruction: ask.ask, preview: ask.preview, supply: ask.ask.slice(0, 120),
    text: `"${wf.name}" ran as far as it can and needs something from you: ${ask.ask}`,
    // KEYED PER RUN **AND** PER STATION (Aug 25): a workflow that declares several inputs parks
    // several times in ONE run, and each park is a different question. A run-only key would fold
    // station 2's ask into station 1's line and the person would never see what is actually owed.
    // Exactly-once still holds where it means something — per station, not per run.
    dedupeKey: `input:${ask.runId}:${ask.stepId ?? 'station'}`,
  });
}

/** THE ONE RESUME DOOR CLEARS IT (ONE DEED ONE DOOR). Called from
 *  /api/workflows/runs/[id]/resume for the gates that are the OWNER'S (approval · guardrail hold);
 *  a handoff gate settles through `settleHandoffDecision`, which owns the same closing law for the
 *  assignee's ask. Approve and reject BOTH clear — a decided run owes nothing. Best-effort. */
export async function settleApprovalAsk(
  admin: SupabaseClient,
  /** `supplied` = the ask was an INPUT STATION's and the person sent what it needed — the same
   *  closing law, said in the deed's own words (they answered, they did not approve). */
  args: { runId: string; approved: boolean; supplied?: boolean },
): Promise<void> {
  try {
    const { data: c } = await admin.from('commitments').select('id, user_id')
      .eq('source', DECISION_SOURCE).eq('source_id', args.runId).eq('status', 'open')
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (!c?.id) return;
    await admin.from('commitments').update({
      status: args.approved ? 'completed' : 'dismissed',
      resolved_reason: args.supplied && args.approved ? 'input supplied' : args.approved ? 'approved' : 'held back',
      resolved_at: new Date().toISOString(),
    }).eq('id', c.id);
    try {
      const { writeRoomTurn, roomKeyForItem } = await import('@/lib/room/turns');
      const roomKey = await roomKeyForItem(admin, String(c.user_id), 'commitment', String(c.id));
      await writeRoomTurn(admin, String(c.user_id), roomKey, {
        role: 'system',
        text: args.approved
          ? (args.supplied ? 'You sent it — the run picked up from there.' : 'You approved — the run continued.')
          : 'You held this back — nothing was delivered.',
        dedupeKey: `approval-decided:${args.runId}`,
      });
    } catch { /* the closed commitment is the truth */ }
  } catch { /* the run row already carries the decision */ }
}

/** THE ORPHAN SWEEP (the dispatcher's tail): an ask never outlives its work. A run DELETED
 *  out-of-band (a workflow removed, a run purged) would otherwise leave a permanent undecidable
 *  row on someone's deck — the deck's own version of the missed-promise class. Runs that merely
 *  moved on are left alone: the resume door closes those, and a still-parked run keeps its ask. */
export async function sweepOrphanedRunAsks(admin: SupabaseClient): Promise<number> {
  let closed = 0;
  try {
    const { data: asks } = await admin.from('commitments').select('id, source_id')
      .eq('source', DECISION_SOURCE).eq('status', 'open').limit(200);
    const rows = ((asks ?? []) as Array<{ id: string; source_id: string | null }>)
      .filter((a) => !!a.source_id);
    if (!rows.length) return 0;
    const { data: runs } = await admin.from('workflow_runs').select('id')
      .in('id', [...new Set(rows.map((a) => String(a.source_id)))]);
    const alive = new Set(((runs ?? []) as Array<{ id: string }>).map((r) => String(r.id)));
    for (const a of rows) {
      if (alive.has(String(a.source_id))) continue;
      await admin.from('commitments').update({
        status: 'dismissed', resolved_reason: 'the run no longer exists',
        resolved_at: new Date().toISOString(),
      }).eq('id', a.id);
      closed++;
    }
  } catch { /* never break the dispatcher */ }
  return closed;
}

/** THE APPROVAL ASK (production arc step 2): a run PARKED at an approval step surfaces its ask
 *  in the standing commitment's room — an `approval` component turn (Approve resumes · Reject
 *  ends, both through /api/workflows/runs/[id]/resume) — and stamps the commitment due TODAY so
 *  the deck shows the debt. A workflow without a binding (manual, never scheduled) still parks
 *  honestly; its run status is the source of truth (the ledger lists it). */
export async function narrateApprovalAsk(
  admin: SupabaseClient, wf: WfRow,
  ask: { runId: string; instruction: string; preview: string },
): Promise<void> {
  try {
    // THE OWNER'S ROOM (B2): the ask parks on whoever is accountable, not whoever created it.
    const { openStandingCommitment } = await import('./owner');
    const c = await openStandingCommitment(admin, wf);
    // THE GUARD (stated once, held in both parks): the unbound ask fires ONLY here — where a
    // standing commitment does not exist. A SCHEDULED workflow keeps this narration and never
    // raises the second row, so no run can ever wear two attention rows.
    if (!c) {
      await raiseRunDecisionAsk(admin, wf, {
        runId: ask.runId, instruction: ask.instruction, preview: ask.preview,
        text: `"${wf.name}" is ready and WAITING ON YOUR APPROVAL before it delivers${ask.instruction ? ` — ${ask.instruction}` : ''}.`,
        dedupeKey: `approval:${ask.runId}`,
      });
      return;
    }
    await admin.from('commitments').update({ due_date: new Date().toISOString().slice(0, 10) }).eq('id', c.id);
    const { writeRoomTurn, roomKeyForItem } = await import('@/lib/room/turns');
    const roomKey = await roomKeyForItem(admin, c.userId, 'commitment', String(c.id));
    await writeRoomTurn(admin, c.userId, roomKey, {
      role: 'system',
      text: `"${wf.name}" is ready and WAITING ON YOUR APPROVAL before it delivers${ask.instruction ? ` — ${ask.instruction}` : ''}.`,
      component: { key: 'approval', refId: ask.runId, state: { runId: ask.runId, workflowId: wf.id, name: wf.name, instruction: ask.instruction, preview: ask.preview } },
      dedupeKey: `approval:${ask.runId}`,
    });
  } catch { /* the parked run status is the source of truth */ }
}

/** THE GUARDRAIL HOLD (guardrails arc, docs/guardrails-plan.md): the delivery check blocked on one
 *  of the USER'S OWN rules and the producing step could not satisfy it on its one retry — so the
 *  decision goes to the human. Deliberately the SAME `approval` component as narrateApprovalAsk:
 *  the room card and /api/workflows/runs/[id]/resume are the one door for "this run is waiting on
 *  you", whatever stopped it. */
export async function narrateGuardrailHold(
  admin: SupabaseClient, wf: WfRow,
  ask: { runId: string; ruleLine: string; preview: string },
): Promise<void> {
  try {
    // THE OWNER'S ROOM (B2): the ask parks on whoever is accountable, not whoever created it.
    const { openStandingCommitment } = await import('./owner');
    const c = await openStandingCommitment(admin, wf);
    // Same guard as narrateApprovalAsk: no binding → the unbound ask carries it to the deck.
    if (!c) {
      await raiseRunDecisionAsk(admin, wf, {
        runId: ask.runId, instruction: ask.ruleLine, preview: ask.preview, held: true,
        text: `"${wf.name}" is HELD by your delivery check — ${ask.ruleLine}. Review it before it goes anywhere.`,
        dedupeKey: `guardrail-hold:${ask.runId}`,
      });
      return;
    }
    await admin.from('commitments').update({ due_date: new Date().toISOString().slice(0, 10) }).eq('id', c.id);
    const { writeRoomTurn, roomKeyForItem } = await import('@/lib/room/turns');
    const roomKey = await roomKeyForItem(admin, c.userId, 'commitment', String(c.id));
    await writeRoomTurn(admin, c.userId, roomKey, {
      role: 'system',
      text: `"${wf.name}" is HELD by your delivery check — ${ask.ruleLine}. Review it before it goes anywhere.`,
      component: {
        key: 'approval', refId: ask.runId,
        state: { runId: ask.runId, workflowId: wf.id, name: wf.name, instruction: ask.ruleLine, preview: ask.preview, held: true },
      },
      dedupeKey: `guardrail-hold:${ask.runId}`,
    });
  } catch { /* the parked run status is the source of truth */ }
}

/** ARC 2 stage 4 — ROOM FEEDBACK MUTATES THE METHOD. Feedback spoken in the standing commitment's
 *  room appends to the workflow's worker_instructions — the exact channel the final AI step
 *  injects — so next Monday's run inherits it. Durable, dated, capped. */
export const steerStandingTaskDefinition = {
  name: 'steer_standing_task',
  description:
    'The user gives FEEDBACK on a standing/recurring task in its room ("less macro, more tenders", "always name the source", ' +
    '"make it shorter") — apply it to the task\'s method so every future run inherits it. Only for standing tasks.',
  input_schema: {
    type: 'object' as const,
    properties: { instruction: { type: 'string', description: "The user's feedback, in their words" } },
    required: ['instruction'],
  },
};

export async function executeSteerStandingTask(
  admin: SupabaseClient, userId: string, args: { commitmentId: string; instruction: string },
): Promise<{ ok: true; taskName: string } | { ok: false; error: string }> {
  try {
    const instruction = args.instruction?.trim();
    if (!instruction) return { ok: false, error: 'no feedback given' };
    const { data: c } = await admin.from('commitments').select('id, source, source_id')
      .eq('id', args.commitmentId).eq('user_id', userId).maybeSingle();
    if (!c || c.source !== 'workflow' || !c.source_id) return { ok: false, error: 'this is not a standing task' };
    const { data: wf } = await admin.from('workflows').select('id, name, worker_instructions')
      .eq('id', c.source_id).eq('user_id', userId).maybeSingle();
    if (!wf) return { ok: false, error: 'the standing task no longer exists' };
    const day = new Date().toISOString().slice(0, 10);
    const appended = `${String(wf.worker_instructions ?? '').trim()}\n\nSTANDING FEEDBACK (${day}): ${instruction.slice(0, 400)}`.trim();
    // Cap: keep the NEWEST feedback (tail) — the oldest lines age out first.
    const capped = appended.length > 4000 ? appended.slice(appended.length - 4000) : appended;
    await admin.from('workflows').update({ worker_instructions: capped }).eq('id', wf.id);
    return { ok: true, taskName: String(wf.name) };
  } catch { return { ok: false, error: 'the feedback could not be saved' }; }
}

/** The convergent door (called from the hourly dispatch cron): sync EVERY workflow's standing
 *  commitment — idempotent and self-healing, so a binding missed at any other door lands within
 *  the hour, and a workflow deleted out-of-band closes its debt. */
export async function syncAllStandingCommitments(admin: SupabaseClient): Promise<void> {
  try {
    const { data: wfs } = await admin.from('workflows')
      .select('id, user_id, name, status, trigger, next_run_at, agent_id').limit(500);
    if (!wfs?.length) return;
    const agentIds = [...new Set(wfs.map((w) => w.agent_id).filter(Boolean))] as string[];
    const names = new Map<string, string>();
    if (agentIds.length) {
      const { data: ags } = await admin.from('custom_agents').select('id, name').in('id', agentIds);
      for (const a of ags ?? []) names.set(String(a.id), String(a.name));
    }
    // One owner read for the whole set (B2) — the debt belongs to the accountability owner.
    const { ownersFor } = await import('./owner');
    const owners = await ownersFor(admin, (wfs as WfRow[]).map((w) => ({ id: w.id, user_id: w.user_id })));
    for (const wf of wfs as WfRow[]) {
      await syncStandingCommitment(admin, wf, wf.agent_id ? names.get(wf.agent_id) ?? null : null, {
        owner: owners.get(wf.id),
      });
    }
    // Workflows DELETED out-of-band: close orphaned standing rows whose workflow no longer exists.
    const alive = new Set(wfs.map((w) => String(w.id)));
    const { data: openStanding } = await admin.from('commitments')
      .select('id, source_id').eq('source', 'workflow').eq('status', 'open').limit(500);
    for (const c of (openStanding ?? []) as Array<{ id: string; source_id: string | null }>) {
      if (c.source_id && !alive.has(c.source_id)) {
        await admin.from('commitments').update({
          status: 'dismissed', resolved_reason: 'standing task removed', resolved_at: new Date().toISOString(),
        }).eq('id', c.id);
      }
    }
  } catch { /* never break the dispatcher */ }
}
