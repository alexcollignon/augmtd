import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { resolveFileForStep } from '@/lib/home/resolve-file-step';
import type { ItemPlanKind, ItemPlanTask } from '@/lib/home/item-plan';

export const maxDuration = 30;

// ════════════════════════════════════════════════════════════════════════════════════════════════
// POST /api/items/resolve-file — task-workflows S4 "file self-heal". Given a file-needing step, try to
// FIND the document before asking the user to upload it. NO side effects — a pure read (pool + KB
// search) that returns a status the panel branches on:
//   • have_it    → a file is already in the item's pool; use it silently.
//   • found_one  → one confident KB match; the UI confirms ("Found 'X' — use it?").
//   • found_many → several / weak matches; the UI shows a pick-list.
//   • none       → nothing found; fall back to the S3 "Upload →" ask.
//
// Body: { kind, entityId, taskId }. The step is resolved from the stored plan (its text/detail drive
// the derived document description). Non-fatal: any failure returns `none` (the S3 upload path).
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

    // Resolve the step from the stored plan (source of truth for its text/detail).
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

    const result = await resolveFileForStep(supabase, user.id, {
      kind, entityId,
      task: { text: step.text, detail: step.detail },
      cached: step.resolvedFile ?? null,   // the persisted snapshot — re-used when the cache key matches (no AI call)
    });

    // ── Persist the resolution snapshot on the step (item_plans.tasks) so a reload / re-render doesn't
    // re-run the reasoned pick. We cache found_one/found_many/none (keyed by step text + pool sig);
    // `have_it` is NOT cached (the pool-first short-circuit re-derives it for free). Only write when the
    // snapshot changed (a fresh, uncached result) to avoid a needless jsonb rewrite on every cache hit.
    if (result.status !== 'have_it' && result.cacheKey && !result.cached) {
      const snapshot = {
        key: result.cacheKey,
        status: result.status,
        candidates: result.candidates,
        ...(result.description ? { description: result.description } : {}),
      };
      const nextTasks = tasks.map((t) => (t.id === taskId ? { ...t, resolvedFile: snapshot } : t));
      const { error: persistErr } = await supabase
        .from('item_plans')
        .update({ tasks: nextTasks, updated_at: new Date().toISOString() })
        .eq('user_id', user.id).eq('kind', kind).eq('entity_id', entityId);
      if (persistErr) console.error('[items/resolve-file] snapshot persist failed (non-fatal):', persistErr.message);
    }

    return NextResponse.json({
      status: result.status,
      description: result.description ?? null,
      candidates: result.candidates,
      // For have_it, surface the pool file so the UI can show "Produced: {filename}" without a re-read.
      deliverable: result.deliverable
        ? { id: result.deliverable.id, type: result.deliverable.type, title: result.deliverable.title, gist: result.deliverable.gist }
        : null,
    });
  } catch (error) {
    console.error('[items/resolve-file] error:', error);
    // Non-fatal — a resolver failure just means the step falls back to the S3 upload ask.
    return NextResponse.json({ status: 'none', candidates: [], description: null, deliverable: null });
  }
}
