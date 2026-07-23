import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { logActivity } from '@/lib/activity/log';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// ONE BRAIN — entity LIFECYCLE (the human's verbs over the memory). No acceptance-flows on the way IN;
// full authority on the way OUT:
//   track / untrack — pin/formalize (a flag, never a create-flow)
//   done            — concluded; leaves the portfolio, STAYS in memory (recognition can reopen it)
//   archive         — parked, reversible
//   mute            — stop showing (revives only on genuinely new activity — recognition still links)
//   reopen          — back to active
//   rename          — new display name; the old one becomes an alias (the memory learns your words)
//   forget          — delete the ENTITY + its links; underlying items are NEVER touched (the invariant)
// Every action logs to activity_events (undoable trail) + learning_signals (curation trains the brain),
// and busts the Home brief cache (entity status feeds deck weights — the established invariant).
// ════════════════════════════════════════════════════════════════════════════════════════════════

const ACTIONS = ['track', 'untrack', 'done', 'archive', 'mute', 'reopen', 'rename', 'forget', 'intent', 'merge', 'category'] as const;
type Action = (typeof ACTIONS)[number];

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { id } = await params;
    const body = (await request.json()) as { action?: Action; name?: string; goals?: string[]; rules?: string[]; targetId?: string; category?: string };
    const action = body.action;
    if (!action || !ACTIONS.includes(action)) return NextResponse.json({ error: 'invalid action' }, { status: 400 });

    const { data: ent } = await supabase.from('work_entities')
      .select('id, name, aliases, status, tracked').eq('id', id).eq('user_id', user.id).maybeSingle();
    if (!ent) return NextResponse.json({ error: 'not found' }, { status: 404 });

    if (action === 'intent') {
      // Goals/rules — the intent a tracked body of work carries (coworkers + meeting chat read these).
      const clean = (a: unknown) => (Array.isArray(a) ? (a as string[]).map((x) => String(x).trim().slice(0, 200)).filter(Boolean).slice(0, 12) : undefined);
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      const g = clean(body.goals); const r = clean(body.rules);
      if (g !== undefined) patch.goals = g;
      if (r !== undefined) patch.rules = r;
      const { error: ierr } = await supabase.from('work_entities').update(patch).eq('id', id).eq('user_id', user.id);
      if (ierr) return NextResponse.json({ error: 'apply migration 20260722_work_entities_goals.sql' }, { status: 400 });
      return NextResponse.json({ ok: true });
    }
    if (action === 'category') {
      // The HUMAN's category (R1) — one of the 4 defaults, LOCKED over the grounded classifier
      // (state.categoryLocked; the synthesis already preserves category, the backfill respects the lock).
      const cat = String(body.category ?? '');
      if (!['client', 'internal', 'personal', 'admin'].includes(cat)) return NextResponse.json({ error: 'invalid category' }, { status: 400 });
      const { data: cur } = await supabase.from('work_entities').select('state').eq('id', id).eq('user_id', user.id).maybeSingle();
      const st = ((cur?.state ?? {}) as Record<string, unknown>);
      await supabase.from('work_entities').update({ state: { ...st, category: cat, categoryLocked: true }, updated_at: new Date().toISOString() }).eq('id', id).eq('user_id', user.id);
      import('@/lib/home/bust-brief').then(({ softBustBrief }) => softBustBrief(supabase, user.id)).catch(() => {});
      return NextResponse.json({ ok: true });
    }
    if (action === 'merge') {
      // MERGE (S5, click path) — THIS entity folds INTO the target: the ONE absorb mechanics shared
      // with reflection + the chat capability. Keeper re-judged immediately.
      const targetId = String(body.targetId ?? '').trim();
      if (!targetId || targetId === id) return NextResponse.json({ error: 'targetId required' }, { status: 400 });
      const { data: target } = await supabase.from('work_entities').select('id, name').eq('id', targetId).eq('user_id', user.id).maybeSingle();
      if (!target) return NextResponse.json({ error: 'target not found' }, { status: 404 });
      const { absorbEntity } = await import('@/lib/entities/reflect');
      const r = await absorbEntity(supabase, user.id, targetId, id);
      if (!r.ok) return NextResponse.json({ error: 'merge failed' }, { status: 500 });
      const { after } = await import('next/server');
      after(async () => {
        try { const { refreshEntityState } = await import('@/lib/entities/state'); await refreshEntityState(supabase, user.id, targetId, { force: true }); } catch { /* non-fatal */ }
      });
      await logActivity(supabase, user.id, {
        type: 'membership_move', title: `Merged ${ent.name} into ${r.primaryName ?? String(target.name)}`,
        entityType: 'work_entity', entityId: targetId, metadata: { merged: id },
      }).catch(() => {});
      import('@/lib/home/bust-brief').then(({ softBustBrief }) => softBustBrief(supabase, user.id)).catch(() => {});
      return NextResponse.json({ ok: true, keptId: targetId, keptName: r.primaryName ?? target.name });
    }
    if (action === 'forget') {
      await supabase.from('entity_links').delete().eq('user_id', user.id).eq('entity_id', id);
      await supabase.from('work_entities').delete().eq('id', id).eq('user_id', user.id);
    } else if (action === 'rename') {
      const name = String(body.name ?? '').trim().slice(0, 80);
      if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 });
      const aliases = [...new Set([...(Array.isArray(ent.aliases) ? (ent.aliases as string[]) : []), ent.name as string])].slice(0, 12);
      await supabase.from('work_entities').update({ name, aliases, updated_at: new Date().toISOString() }).eq('id', id).eq('user_id', user.id);
    } else {
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (action === 'track') patch.tracked = true;
      if (action === 'untrack') patch.tracked = false;
      if (action === 'done') patch.status = 'done';
      if (action === 'archive') patch.status = 'archived';
      if (action === 'mute') patch.status = 'muted';
      if (action === 'reopen') patch.status = 'active';
      await supabase.from('work_entities').update(patch).eq('id', id).eq('user_id', user.id);
    }

    // Curation feeds the brain + the audit trail; entity status feeds deck weights → bust the brief cache.
    await logActivity(supabase, user.id, {
      type: `entity_${action}`,
      title: `${action === 'rename' ? 'Renamed' : action[0].toUpperCase() + action.slice(1)}: ${ent.name}`,
      entityType: 'work_entity', entityId: id, metadata: { action },
    }).catch(() => {});
    supabase.from('learning_signals').insert({
      user_id: user.id, inbox_item_id: null, signal_type: 'action_taken',
      signal_data: { action: `entity_${action}`, entity_name: ent.name },
    }).then(() => {}, () => {});
    import('@/lib/home/bust-brief').then(({ softBustBrief }) => softBustBrief(supabase, user.id)).catch(() => {}); // sig-only bust (renames/lifecycle don't change counts)

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[entities/lifecycle] error:', e);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
