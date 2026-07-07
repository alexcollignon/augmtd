import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { buildItemContext } from '@/lib/home/item-context';
import { buildDelegationPrompt, runDelegation, type DelegateWorker } from '@/lib/home/delegate';
import { logActivity } from '@/lib/activity/log';
import type { ItemPlanKind, ItemPlanTask, HandedTo } from '@/lib/home/item-plan';

export const maxDuration = 120;

// ════════════════════════════════════════════════════════════════════════════════════════════════
// POST /api/items/delegate — stage 3b "Hand to a coworker": delegate a Home item (whole plan) OR a
// single identified step to a NAMED coworker, who executes it via the EXISTING worker-run engine and
// reports back.
//
// Body: { kind, entityId, agentId, taskId? }
//   • no taskId → delegate the whole live (non-dismissed, not-done, not-already-handed) remaining plan.
//   • taskId    → delegate that one step's intent.
//
// ⚠️ SAFETY: delegation is EXPLICIT (only ever called from a user picking a coworker + confirming).
// The delegated prompt is framed to PREPARE the work + report back — NOT to auto-send/post/commit an
// irreversible action from the Home (see DELEGATION_SAFETY_NOTE in lib/home/delegate.ts). The coworker
// still holds send tools; this is a prompt-level guardrail keeping the user in the loop.
//
// On success: stamp the step (or, for a whole-item hand-off, the plan's live steps) with
// `handedTo:{agentId,agentName,threadId,output,at}` + `done:true`, log an activity event, and return
// { ok, output, agentName, threadId, reportText }. Non-fatal on the bookkeeping (persist/log) writes.
// ════════════════════════════════════════════════════════════════════════════════════════════════

const VALID_KINDS: ItemPlanKind[] = ['email', 'meeting', 'commitment', 'awareness', 'followup'];

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = (await request.json()) as { kind: ItemPlanKind; entityId: string; agentId: string; taskId?: string };
    const { kind, entityId, agentId, taskId } = body;
    if (!entityId || !VALID_KINDS.includes(kind)) {
      return NextResponse.json({ error: 'kind and entityId are required' }, { status: 400 });
    }
    if (!agentId) return NextResponse.json({ error: 'agentId is required' }, { status: 400 });

    // ── Validate the coworker belongs to this user (and is a real worker). ──
    const { data: workerRow } = await supabase
      .from('custom_agents')
      .select('id, name, worker_role, is_worker')
      .eq('id', agentId)
      .eq('user_id', user.id)
      .eq('is_worker', true)
      .maybeSingle();
    if (!workerRow) return NextResponse.json({ error: 'Coworker not found' }, { status: 404 });
    const worker = workerRow as DelegateWorker;

    // ── Build the item's grounding context. ──
    const itemCtx = await buildItemContext(supabase, user.id, kind, entityId);
    const itemContext = itemCtx?.text || '';

    // ── Load the current plan (for a per-step intent OR the remaining-plan job). ──
    const { data: planRow } = await supabase
      .from('item_plans')
      .select('tasks')
      .eq('user_id', user.id).eq('kind', kind).eq('entity_id', entityId)
      .maybeSingle();
    const currentTasks: ItemPlanTask[] = (planRow && Array.isArray(planRow.tasks)) ? (planRow.tasks as ItemPlanTask[]) : [];

    let step: ItemPlanTask | undefined;
    if (taskId) {
      step = currentTasks.find((t) => t.id === taskId);
      if (!step) return NextResponse.json({ error: 'Step not found' }, { status: 404 });
    }

    // A short label for the thread title + report-back task name.
    const itemLabel = (step?.text || itemCtx?.text?.split('\n')[0] || `${kind} item`).replace(/^Subject:\s*/i, '').slice(0, 100);

    const prompt = buildDelegationPrompt({
      kind,
      itemContext,
      step: step ? { text: step.text, detail: step.detail } : null,
      remainingSteps: taskId ? undefined : currentTasks,
    });

    // The user's first name (for the report-back voice).
    const { data: profile } = await supabase.from('profiles').select('full_name').eq('id', user.id).maybeSingle();
    const firstName = ((profile?.full_name as string | null) || '').trim().split(/\s+/)[0] || null;

    // ── Run the delegation. The worker-run engine + the thread writes want a SERVICE-ROLE client (the
    // AgentOS bridge / native step run as system, and the coworker's thread/messages are written on the
    // user's behalf). Fall back to the cookie client if the service key is absent (writes still RLS-ok
    // for the user's own rows). ──
    const svcUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const runClient = (svcUrl && svcKey) ? createAdminClient(svcUrl, svcKey) : supabase;

    let result;
    try {
      result = await runDelegation({
        supabase: runClient,
        userId: user.id,
        worker,
        prompt,
        itemLabel,
        firstName,
      });
    } catch (e) {
      console.error('[items/delegate] run failed:', e);
      return NextResponse.json({ ok: false, error: `${worker.name} couldn't complete this. Please try again.` }, { status: 502 });
    }

    // ── Persist the handed-off marker on the plan (best-effort). A whole-item hand-off marks every live
    // (non-dismissed, not-done, not-already-handed) step; a per-step hand-off marks just that step. Each
    // marked step gets `done:true` + the `handedTo` attribution (with the coworker's output). ──
    const handedTo: HandedTo = {
      agentId: worker.id,
      agentName: worker.name,
      workerRole: worker.worker_role,
      threadId: result.threadId,
      output: result.output.slice(0, 4000),
      at: new Date().toISOString(),
    };
    if (currentTasks.length) {
      try {
        const nextTasks = currentTasks.map((t) => {
          const shouldMark = taskId
            ? t.id === taskId
            : (!t.dismissed && !t.done && !t.handedTo);
          return shouldMark ? { ...t, done: true, handedTo } : t;
        });
        await supabase
          .from('item_plans')
          .update({ tasks: nextTasks, updated_at: new Date().toISOString() })
          .eq('user_id', user.id).eq('kind', kind).eq('entity_id', entityId);
      } catch (e) {
        console.error('[items/delegate] persist handedTo failed (non-fatal):', e);
      }
    }

    // ── Activity log (non-fatal). Not undoable — it's a real (prepared) piece of work by a coworker. ──
    await logActivity(supabase, user.id, {
      type: 'delegated_to_coworker',
      title: taskId
        ? `Handed a step to ${worker.name}: ${itemLabel}`
        : `Handed to ${worker.name}: ${itemLabel}`,
      entityType: kind,
      entityId,
      metadata: { agentId: worker.id, agentName: worker.name, taskId: taskId ?? null, threadId: result.threadId },
    });

    return NextResponse.json({
      ok: true,
      output: result.output,
      agentName: result.agentName,
      threadId: result.threadId,
      reportText: result.reportText,
      handedTo,
    });
  } catch (error) {
    console.error('[items/delegate] error:', error);
    return NextResponse.json({ error: 'Could not delegate this.' }, { status: 500 });
  }
}
