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
  opts?: { fromSuccessfulRun?: boolean },
): Promise<void> {
  try {
    const standing = wf.status === 'active' && wf.trigger?.type === 'schedule';
    const { data: existing } = await admin.from('commitments')
      .select('id, status, due_date, description')
      .eq('user_id', wf.user_id).eq('source', 'workflow').eq('source_id', wf.id)
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
      user_id: wf.user_id, direction: 'awaiting', description,
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
    const { data: c } = await admin.from('commitments').select('id, status')
      .eq('user_id', wf.user_id).eq('source', 'workflow').eq('source_id', wf.id)
      .eq('status', 'open').limit(1).maybeSingle();
    if (!c) return; // no standing row (manual task / dismissed) — nothing owes narration
    const { writeRoomTurn, roomKeyForItem } = await import('@/lib/room/turns');
    const roomKey = await roomKeyForItem(admin, wf.user_id, 'commitment', String(c.id));
    const first = run.workerName.split(' ')[0];
    const threadHref = run.threadId ? `/home?chat=worker:${run.threadId}:${wf.agent_id ?? ''}` : null;
    if (run.ok) {
      // ONE-NARRATOR LAW: third-person orchestration narration — the CoS voice, author absent.
      await writeRoomTurn(admin, wf.user_id, roomKey, {
        role: 'system',
        text: `${first} produced "${wf.name}" — this run is ready to review.`,
        refs: threadHref ? [{ label: 'Open the deliverable', href: threadHref }] : undefined,
        dedupeKey: `run:${run.runId}`,
      });
    } else {
      await admin.from('commitments').update({ due_date: new Date().toISOString().slice(0, 10) }).eq('id', c.id);
      await writeRoomTurn(admin, wf.user_id, roomKey, {
        role: 'system',
        text: `The "${wf.name}" run FAILED${run.error ? ` — ${String(run.error).slice(0, 140)}` : ''}. It stays owed until a run lands; it will retry on the next schedule.`,
        refs: threadHref ? [{ label: 'See what happened', href: threadHref }] : undefined,
        dedupeKey: `run-fail:${run.runId}`,
      });
    }
  } catch { /* narration is bookkeeping — never breaks a run */ }
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
    const { data: c } = await admin.from('commitments').select('id, status')
      .eq('user_id', wf.user_id).eq('source', 'workflow').eq('source_id', wf.id)
      .eq('status', 'open').limit(1).maybeSingle();
    if (!c) return;
    await admin.from('commitments').update({ due_date: new Date().toISOString().slice(0, 10) }).eq('id', c.id);
    const { writeRoomTurn, roomKeyForItem } = await import('@/lib/room/turns');
    const roomKey = await roomKeyForItem(admin, wf.user_id, 'commitment', String(c.id));
    await writeRoomTurn(admin, wf.user_id, roomKey, {
      role: 'system',
      text: `"${wf.name}" is ready and WAITING ON YOUR APPROVAL before it delivers${ask.instruction ? ` — ${ask.instruction}` : ''}.`,
      component: { key: 'approval', refId: ask.runId, state: { runId: ask.runId, workflowId: wf.id, name: wf.name, instruction: ask.instruction, preview: ask.preview } },
      dedupeKey: `approval:${ask.runId}`,
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
    for (const wf of wfs as WfRow[]) {
      await syncStandingCommitment(admin, wf, wf.agent_id ? names.get(wf.agent_id) ?? null : null);
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
