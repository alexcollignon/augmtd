import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { runItemStep } from '@/lib/home/run-step';
import { assembleSystemStep } from '@/lib/home/assemble-step-workflow';
import { logActivity } from '@/lib/activity/log';
import type { ItemPlanKind, ItemPlanTask } from '@/lib/home/item-plan';

export const maxDuration = 60;

// ════════════════════════════════════════════════════════════════════════════════════════════════
// POST /api/items/run — stage 3c "Hand to AUGMTD": run ONE reversible, atomic [System] step directly.
//
// Body: { kind, entityId, taskId }
//   The step is resolved from the stored plan (source of truth for its capability/text). AUGMTD runs it
//   via `runItemStep` (analyze / grounded fetch over the item context — NO external side effects), and
//   on success stamps the step `status:'done', done:true, result:<output>` on the plan so the stepper
//   shows a "Done ✓" with the returned result inline.
//
// ⚠️ REVERSIBLE ONLY: this never sends/posts/commits. An irreversible send (calendar invite) goes
// through prepare → /api/items/execute with an explicit approval click, never here. `runItemStep`
// refuses a non-runnable capability honestly.
//
// Non-fatal: on failure returns { ok:false, error } and leaves the step untouched (stays ready to
// retry or hand off). Non-fatal on the bookkeeping (persist/log) writes.
// ════════════════════════════════════════════════════════════════════════════════════════════════

const VALID_KINDS: ItemPlanKind[] = ['email', 'meeting', 'commitment', 'awareness', 'followup'];

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = (await request.json()) as { kind: ItemPlanKind; entityId: string; taskId: string };
    const { kind, entityId, taskId } = body;
    if (!entityId || !VALID_KINDS.includes(kind)) {
      return NextResponse.json({ error: 'kind and entityId are required' }, { status: 400 });
    }
    if (!taskId) return NextResponse.json({ error: 'taskId is required' }, { status: 400 });

    // Resolve the step from the stored plan.
    const { data: row } = await supabase
      .from('item_plans')
      .select('tasks')
      .eq('user_id', user.id).eq('kind', kind).eq('entity_id', entityId)
      .maybeSingle();
    if (!row || !Array.isArray(row.tasks)) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }
    const tasks = row.tasks as ItemPlanTask[];
    const step = tasks.find((t) => t.id === taskId);
    if (!step) return NextResponse.json({ error: 'Step not found' }, { status: 404 });

    // ── RUN — task-workflows S1: assemble this system step into an ENGINE workflow and run it (a REAL
    // tool-backed fetch + synthesis that reads the per-item deliverable pool and writes a deliverable),
    // instead of the old single-LLM `runItemStep`. The assembler guards the capability itself (reversible
    // only — a send returns ok:false so it routes to the approval path). Non-fatal: if the assembler
    // couldn't run for an infra reason, fall back to the old item-only behaviour.
    let output: string | undefined;
    let deliverable: { id: string; type: string; title?: string | null; gist?: string | null } | undefined;
    let toolUsed: string | undefined;

    const assembled = await assembleSystemStep(supabase, user.id, {
      kind, entityId,
      task: { id: step.id, text: step.text, detail: step.detail, capability: step.capability, actor: step.actor },
    });

    if (assembled.ok) {
      output = assembled.outputText;
      toolUsed = assembled.toolUsed;
      if (assembled.deliverable) {
        deliverable = {
          id: assembled.deliverable.id,
          type: assembled.deliverable.type,
          title: assembled.deliverable.title,
          gist: assembled.deliverable.gist,
        };
      }
    } else {
      // Assembler declined (a send / not-runnable capability) → surface its honest error. Only fall
      // back to `runItemStep` for a genuine infra failure on a runnable capability, so we never silently
      // downgrade a real tool run to the tool-less path when the assembler's refusal is intentional.
      const fallback = await runItemStep(supabase, user.id, {
        kind, entityId,
        task: { text: step.text, detail: step.detail, capability: step.capability, actor: step.actor },
      });
      if (fallback.ok) {
        output = fallback.output;
      } else {
        return NextResponse.json({ ok: false, error: assembled.error || fallback.error || 'Could not run this step.' }, { status: 502 });
      }
    }

    // ── Persist the step's resolution (best-effort). done:true + status:'done' + result + the pool
    // deliverable summary (rendered as "Produced: {title}" on the step).
    try {
      const nextTasks = tasks.map((t) =>
        t.id === taskId
          ? {
              ...t,
              done: true,
              status: 'done' as const,
              result: output,
              ...(deliverable
                ? { deliverable: { id: deliverable.id, type: deliverable.type as 'text' | 'document' | 'file' | 'sent_record' | 'draft', title: deliverable.title ?? undefined, gist: deliverable.gist ?? undefined } }
                : {}),
            }
          : t,
      );
      await supabase
        .from('item_plans')
        .update({ tasks: nextTasks, updated_at: new Date().toISOString() })
        .eq('user_id', user.id).eq('kind', kind).eq('entity_id', entityId);
    } catch (e) {
      console.error('[items/run] persist failed (non-fatal):', e);
    }

    // ── Activity log (non-fatal). Reversible → not a send; a light "AUGMTD handled a step" record.
    await logActivity(supabase, user.id, {
      type: 'system_ran_step',
      title: `AUGMTD handled: ${step.text.slice(0, 100)}`,
      entityType: kind,
      entityId,
      metadata: { taskId, ...(toolUsed ? { tool: toolUsed } : {}), ...(deliverable ? { deliverableId: deliverable.id } : {}) },
    });

    return NextResponse.json({ ok: true, output, deliverable, toolUsed });
  } catch (error) {
    console.error('[items/run] error:', error);
    return NextResponse.json({ error: 'Could not run this step.' }, { status: 500 });
  }
}
