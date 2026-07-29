import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { prepareAction } from '@/lib/home/prepare-action';
import type { ItemPlanKind, ItemPlanTask } from '@/lib/home/item-plan';

export const maxDuration = 30;

// ════════════════════════════════════════════════════════════════════════════════════════════════
// POST /api/items/prepare — stage 3a "prepare" half of prepare → approve → commit.
//
// Body: { kind, entityId, taskId } (+ optional { capability } if the client already has it).
// Loads the plan's stored task, routes it (by capability + the CAPABILITY_MAP) to a prepared-action
// TYPE, and returns a PREPARED, editable action:
//   • { type:'calendar_invite', title, startISO, endISO, attendees, description, timezone } — grounded
//     from the item (attendees from the sender/thread, time resolved against the item's date), the user
//     reviews/edits it in the InvitePreviewCard, then approves → /api/items/execute.
//   • { type:'email', composeKind } — a POINTER: the UI opens the existing ComposePanel (unchanged).
//
// STRICT: prepare NEVER sends / has NO side effects. It only produces the action to be approved.
// Non-fatal: any failure → 200 with { type:'email', … } (fall back to the compose surface) or a 4xx.
// ════════════════════════════════════════════════════════════════════════════════════════════════

const VALID_KINDS: ItemPlanKind[] = ['email', 'meeting', 'commitment', 'awareness', 'followup'];

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = (await request.json()) as { kind: ItemPlanKind; entityId: string; taskId?: string; capability?: string; actionType?: 'forward' | 'calendar_invite' };
    const { kind, entityId, taskId, actionType } = body;
    if (!entityId || !VALID_KINDS.includes(kind)) {
      return NextResponse.json({ error: 'kind and entityId are required' }, { status: 400 });
    }

    // Resolve the step being prepared from the stored plan (source of truth for its text/capability).
    let task: Pick<ItemPlanTask, 'capability' | 'text' | 'detail'> | null = null;
    if (taskId) {
      const { data: row } = await supabase
        .from('item_plans')
        .select('tasks')
        .eq('user_id', user.id).eq('kind', kind).eq('entity_id', entityId)
        .maybeSingle();
      if (row && Array.isArray(row.tasks)) {
        const found = (row.tasks as ItemPlanTask[]).find((t) => t.id === taskId);
        if (found) task = { capability: found.capability, text: found.text, detail: found.detail };
      }
    }
    // ITEM-LEVEL action (no plan step) — the consistent action palette's "Forward" opens a prepared
    // forward for the whole item, not a specific plan step. `actionType:'forward'` synthesizes a
    // forward-shaped task so `routeStepToActionType` routes it to a prepared forward (grounded in the
    // item's real email), instead of falling through to the email composer.
    if (!task && actionType === 'forward') {
      task = { capability: 'send', text: 'Forward this email', detail: undefined };
    }
    // VERDICT-LEVEL invite (W1) — the judged `schedule` verdict mounts the invite card with no plan
    // step; the hint synthesizes an invite-shaped task so the router lands on `calendar_invite`
    // (mirrors the forward hint; the prepared artifact the ambient pass stored then serves first).
    if (!task && actionType === 'calendar_invite') {
      task = { capability: 'send', text: 'Send a calendar invite for this meeting', detail: undefined };
    }
    // If the client already sent a capability but the task row wasn't found (edge case), still route.
    if (!task) {
      const cap = (['draft', 'analyze', 'fetch', 'send'].includes(body.capability || '') ? body.capability : null) as ItemPlanTask['capability'];
      task = { capability: cap, text: '', detail: undefined };
    }

    const action = await prepareAction(supabase, user.id, { kind, entityId, task });
    if (!action) {
      // Context couldn't be built — fall back to the compose surface (kind-appropriate) so the UI
      // always has a prepared path, never a dead end.
      const composeKind = kind === 'meeting' ? 'meeting' : kind === 'commitment' ? 'commitment' : kind === 'awareness' ? 'awareness' : 'email';
      return NextResponse.json({ type: 'email', composeKind });
    }
    return NextResponse.json(action);
  } catch (error) {
    console.error('[items/prepare] error:', error);
    return NextResponse.json({ error: 'Could not prepare the action.' }, { status: 500 });
  }
}
