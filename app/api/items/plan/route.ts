import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { generateItemPlan, classifyStep, detectAttachmentRequest, type ItemPlanKind, type ItemPlanTask } from '@/lib/home/item-plan';
import { PLAN_VERSION } from '@/lib/home/capability-map';
import { buildItemContext } from '@/lib/home/item-context';

export const maxDuration = 30;

// ════════════════════════════════════════════════════════════════════════════════════════════════
// ITEM PLAN endpoints — the "What this takes" graded task breakdown for a Home deep-dive (stage 2).
//
// POST /api/items/plan  { kind, entityId }  → get-or-generate: return the stored plan if we have one
//   AND it was generated under the current PLAN_VERSION; else (missing OR stale version) build the
//   item's context, call generateItemPlan, persist with the current version, and return { tasks }.
//   → AUTO-INVALIDATION: bumping PLAN_VERSION (capability-map.ts) makes every plan regenerate on next
//   open — no manual row delete / cache-bust.
// PATCH /api/items/plan
//   • { kind, entityId, taskId, done? , dismissed? }  → mutate one task: toggle a [You] task's `done`,
//     OR set `dismissed` on ANY task (every step is removable). (System `done` is stage 3.)
//   • { kind, entityId, action:'add', text }           → CLASSIFY the text (classifyStep) → append the
//     graded step to the stored tasks → return { tasks, task } (the new step).
//   • { kind, entityId, action:'edit', taskId, text }  → CLASSIFY the new text → RE-INTERPRET that task
//     (text/actor/capability/detail) in place → return { tasks, task }.
//
// Non-fatal: the deep-dive still works with just the stage-1 action bar if this fails.
// ════════════════════════════════════════════════════════════════════════════════════════════════

type Kind = ItemPlanKind;
const VALID_KINDS: Kind[] = ['email', 'meeting', 'commitment', 'awareness', 'followup'];

// Build the grounding context prose the planner reasons over. Thin wrapper over the SHARED
// `buildItemContext` (`lib/home/item-context.ts`) — the same builder `/api/items/prepare` uses — so
// the plan and a prepared action ground on identical item facts.
async function buildContext(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  kind: Kind,
  entityId: string,
): Promise<string | null> {
  const ctx = await buildItemContext(supabase, userId, kind, entityId);
  return ctx ? ctx.text : null;
}

// task-workflows S3 — flag a freshly-graded [You] step that is a "provide a document" ask as an
// ATTACHMENT REQUEST (awaiting_input + a request prompt), so the panel renders an "Upload →" affordance
// instead of a plain checkbox. Instance-honest + light: only fires when the step's own text names a
// document to hand over (never a system step, never already-fulfilled). Idempotent — a step that already
// carries a fulfilled request or a non-`awaiting_input` status is left untouched.
function withAttachmentRequest(task: ItemPlanTask): ItemPlanTask {
  if (task.request?.fulfilledRef || task.done || task.dismissed) return task;
  const prompt = detectAttachmentRequest(task);
  if (!prompt) return task;
  return { ...task, status: 'awaiting_input', request: { prompt } };
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { kind, entityId } = (await request.json()) as { kind: Kind; entityId: string };
    if (!entityId || !VALID_KINDS.includes(kind)) {
      return NextResponse.json({ error: 'kind and entityId are required' }, { status: 400 });
    }

    // Get-or-generate: an existing plan wins (persists the [You] checklist + edits) — BUT only if it
    // was generated under the CURRENT PLAN_VERSION. A stale-version row (map/classifier changed since)
    // is treated as absent → regenerated + re-stamped below. `version` may be absent if the migration
    // hasn't been applied yet; `?? 0` then reads as stale-safe against a non-zero PLAN_VERSION but
    // matches when PLAN_VERSION is 0 (no forced churn pre-migration).
    const { data: existing } = await supabase
      .from('item_plans')
      .select('tasks, version')
      .eq('user_id', user.id).eq('kind', kind).eq('entity_id', entityId)
      .maybeSingle();
    const existingVersion = existing ? ((existing as { version?: number }).version ?? 0) : null;
    const isStale = existing != null && existingVersion !== PLAN_VERSION;
    if (existing && Array.isArray(existing.tasks) && existing.tasks.length && !isStale) {
      return NextResponse.json({ tasks: existing.tasks as ItemPlanTask[] });
    }

    const context = (await buildContext(supabase, user.id, kind, entityId)) || '';
    const plan = await generateItemPlan(supabase, user.id, { kind, entityId, context });
    // task-workflows S3: mark any "provide a document" [You] step as an attachment request up front.
    plan.tasks = plan.tasks.map(withAttachmentRequest);

    // Persist (best-effort — a failed insert still returns the freshly generated plan). Supabase
    // returns an { error } object rather than throwing, so check it explicitly — a silently-failed
    // upsert is exactly what made the plan "regenerate every visit" before the migration existed.
    // Skip persisting the honest single-[You] fallback: it's not worth caching, and re-opening later
    // (once generation succeeds) should get a real plan rather than a stuck "Handle this".
    const isFallback = plan.tasks.length === 1 && plan.tasks[0].actor === 'you' && plan.tasks[0].text === 'Handle this';
    if (!isFallback) {
      try {
        const { error: upsertErr } = await supabase
          .from('item_plans')
          .upsert(
            { user_id: user.id, kind, entity_id: entityId, tasks: plan.tasks, version: PLAN_VERSION, updated_at: new Date().toISOString() },
            { onConflict: 'user_id,kind,entity_id' },
          );
        if (upsertErr) console.error('[items/plan] persist failed:', upsertErr.message);
      } catch (e) {
        console.error('[items/plan] persist threw:', e);
      }
    }

    return NextResponse.json({ tasks: plan.tasks });
  } catch (error) {
    console.error('[items/plan] POST error:', error);
    return NextResponse.json({ error: 'Could not build the plan.' }, { status: 500 });
  }
}

// Give a freshly added/edited step a stable, collision-free id within the plan.
function nextTaskId(tasks: ItemPlanTask[]): string {
  let max = 0;
  for (const t of tasks) {
    const m = /^t(\d+)$/.exec(t.id);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `t${max + 1}`;
}

export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = (await request.json()) as {
      kind: Kind; entityId: string; taskId?: string; done?: boolean; dismissed?: boolean;
      action?: 'add' | 'edit' | 'reassign'; text?: string; owner?: 'system' | 'you' | 'coworker';
      // reassign owner:'coworker' — the PROPOSED coworker (assignment only; the server records it, it
      // does NOT run/delegate the step — Run dispatches it later via /api/items/delegate).
      agentId?: string; agentName?: string; workerRole?: string | null;
    };
    const { kind, entityId, taskId, done, dismissed, action, text, owner, agentId, agentName, workerRole } = body;
    if (!entityId || !VALID_KINDS.includes(kind)) {
      return NextResponse.json({ error: 'kind and entityId are required' }, { status: 400 });
    }
    // Toggle actions (done/dismissed) require a taskId; add/edit have their own validation below.
    if (!action && !taskId) {
      return NextResponse.json({ error: 'taskId is required' }, { status: 400 });
    }

    const { data: row } = await supabase
      .from('item_plans')
      .select('tasks')
      .eq('user_id', user.id).eq('kind', kind).eq('entity_id', entityId)
      .maybeSingle();
    if (!row || !Array.isArray(row.tasks)) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }
    const current = row.tasks as ItemPlanTask[];

    let tasks: ItemPlanTask[];
    let newTask: ItemPlanTask | null = null;

    if (action === 'add' || action === 'edit') {
      // Re-interpret the user's wording through the ONE classification engine (WHAT/WHO/HOW) — respects
      // the user's meaning, unmappable → [You]. Grounded on the same item context the generator uses.
      const trimmed = (text || '').trim();
      if (!trimmed) return NextResponse.json({ error: 'text is required' }, { status: 400 });
      if (action === 'edit' && !taskId) return NextResponse.json({ error: 'taskId is required for edit' }, { status: 400 });

      const itemContext = (await buildContext(supabase, user.id, kind, entityId)) || '';
      const graded = await classifyStep(supabase, user.id, { text: trimmed, itemContext, kind });

      if (action === 'add') {
        // task-workflows S3: an added "provide a document" [You] step becomes an attachment request.
        newTask = withAttachmentRequest({ ...graded, id: nextTaskId(current), done: false });
        tasks = [...current, newTask];
      } else {
        // edit — RE-INTERPRET the named task in place, keeping its id + any done/dismissed state.
        const existing = current.find((t) => t.id === taskId);
        if (!existing) return NextResponse.json({ error: 'task not found' }, { status: 404 });
        const reinterpreted: ItemPlanTask = {
          ...existing,
          text: graded.text,
          actor: graded.actor,
          capability: graded.capability,
          // Replace detail wholesale (re-interpreted) — drop it if the new classification has none.
          detail: graded.detail,
          // A step re-graded to [system] can't stay checked-done (done is a [You]-only checkbox).
          done: graded.actor === 'you' ? existing.done : false,
          // Re-interpretation drops a stale (unfulfilled) attachment-request state; re-derive below.
          ...(existing.request?.fulfilledRef ? {} : { status: undefined, request: undefined }),
        };
        // Re-derive the attachment-request state from the new wording (unless already fulfilled).
        newTask = withAttachmentRequest(reinterpreted);
        tasks = current.map((t) => (t.id === taskId ? newTask! : t));
      }
    } else if (action === 'reassign') {
      // Re-assign a step's OWNER — WITHOUT re-classifying its text (the user is only changing WHO does it).
      //   • owner 'you'      → drops the capability + any coworker proposal/attribution.
      //   • owner 'system'   → AUGMTD; defaults to the always-runnable 'analyze'; clears any coworker.
      //   • owner 'coworker' → records the PROPOSED coworker (proposedAgent) on the step. ASSIGNMENT ONLY —
      //     the server does NOT run/delegate here; Run dispatches it later (/api/items/delegate). Keeps the
      //     step a system judgment step (capability 'draft' if it had none) so it reads as a coworker owner.
      // Mirrors the client's optimistic reassign / proposeCoworker.
      if (!taskId) return NextResponse.json({ error: 'taskId is required' }, { status: 400 });
      const existing = current.find((t) => t.id === taskId);
      if (!existing) return NextResponse.json({ error: 'task not found' }, { status: 404 });
      let reassigned: ItemPlanTask;
      if (owner === 'coworker') {
        if (!agentId || !agentName) return NextResponse.json({ error: 'agentId and agentName are required for a coworker reassign' }, { status: 400 });
        reassigned = {
          ...existing,
          actor: 'system',
          capability: existing.capability && existing.capability !== 'analyze' && existing.capability !== 'fetch' && existing.capability !== 'send'
            ? existing.capability
            : 'draft',
          proposedAgent: { id: agentId, name: agentName, workerRole: workerRole ?? null },
          handedTo: undefined,
          status: undefined,
          done: false,
        };
      } else if (owner === 'system') {
        reassigned = { ...existing, actor: 'system', capability: existing.capability ?? 'analyze', proposedAgent: undefined, handedTo: undefined, status: undefined, done: false };
      } else {
        reassigned = { ...existing, actor: 'you', capability: null, proposedAgent: undefined, handedTo: undefined, status: undefined, done: false };
      }
      tasks = current.map((t) => (t.id === taskId ? reassigned : t));
    } else {
      // Toggle: `dismissed` applies to ANY step; `done` only to a [You] task's checkbox.
      tasks = current.map((t) => {
        if (t.id !== taskId) return t;
        const next = { ...t };
        if (typeof dismissed === 'boolean') next.dismissed = dismissed;
        if (typeof done === 'boolean' && t.actor === 'you') next.done = done;
        return next;
      });
    }

    const { error } = await supabase
      .from('item_plans')
      .update({ tasks, updated_at: new Date().toISOString() })
      .eq('user_id', user.id).eq('kind', kind).eq('entity_id', entityId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json(newTask ? { tasks, task: newTask } : { tasks });
  } catch (error) {
    console.error('[items/plan] PATCH error:', error);
    return NextResponse.json({ error: 'Could not update the task.' }, { status: 500 });
  }
}
