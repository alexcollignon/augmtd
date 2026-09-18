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
// Deletion is NOT a PATCH action — it lives at the DELETE door below (the retired `forget` action was
// a partial delete reachable from nowhere; the door supersedes it).
// Every action logs to activity_events (undoable trail) + learning_signals (curation trains the brain),
// and busts the Home brief cache (entity status feeds deck weights — the established invariant).
// ════════════════════════════════════════════════════════════════════════════════════════════════

const ACTIONS = ['track', 'untrack', 'done', 'archive', 'mute', 'reopen', 'rename', 'intent', 'merge', 'category'] as const;
type Action = (typeof ACTIONS)[number];

// ════════════════════════════════════════════════════════════════════════════════════════════════
// DELETE /api/entities/[id] — THE DELETE DOOR (owner walk, Sep 15: "maybe include a delete which
// would delete context and chats about the project across DB for that user?").
//
// This door REPLACED a PATCH action (`forget`, retired Sep 17) that removed the row and its links
// but was reachable from nowhere and left the project's whole MIND behind: the room's conversation,
// its composed brief, its cached judgments, its read marker, its title — all keyed to an id that no
// longer existed, none of it ever read again, none of it ever collected. This door deletes the
// project's context, not just its name, and it is the ONLY way a project dies.
//
// THE INVENTORY IS DELIBERATELY CONSERVATIVE — ONE USER, ONE PROJECT, AND NEVER THE WORK ITSELF:
//   · work_entities      — the project row (this user's only).
//   · entity_links       — its memberships. The items become LOOSE; nothing about them is deleted.
//   · room_turns         — the room's conversation (room_key IS the entity id, by the one convention
//                          in lib/room/turns.ts), live AND archived sessions alike.
//   · item_plans         — every row this project KEYS (entity_id = <this id>): the composed brief,
//                          the room title/scope, its read marker, its cached judgments. The column
//                          is the key, so only rows that name THIS entity can match — a row keyed
//                          to an inbox item or to 'home' is structurally unreachable from here.
//   · entity_reflections — the merge/separate verdicts this project is half of (the same
//                          `pair_key LIKE %id%` handle the absorb path uses).
//   · knowledge_files    — UNFILED, never deleted: entity_id → null. A document survives its
//                          project. (A FILED FILE IS A VISIBLE FILE — unfiling only unfiles.)
//
// What is NOT touched, by law: inbox_items · emails · meeting_transcripts · commitments ·
// calendar_events · knowledge_files rows themselves. The user deleted a project, not their mail.
//
// Irreversible, and the dialog at the one client door says so. Logged to activity_events as the
// record of the deed (the trail is not an undo).
// ════════════════════════════════════════════════════════════════════════════════════════════════
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { id } = await params;

    // A stranger's project is indistinguishable from one that never existed.
    const { data: ent } = await supabase.from('work_entities')
      .select('id, name').eq('id', id).eq('user_id', user.id).maybeSingle();
    if (!ent) return NextResponse.json({ error: 'not found' }, { status: 404 });

    // THE DELETE DOOR IS A RESOLUTION DOOR (the workflow precedent): what lives ON the project is
    // settled before the project itself dies. Its conversation, its asks and its cards are that
    // life here — they go with it rather than standing as gate rows pointing at nothing. Each limb
    // is independently best-effort: a missing table or a transient failure must never leave a
    // half-deleted project standing.
    const drop = async (fn: () => PromiseLike<unknown>) => { try { await fn(); } catch { /* non-fatal */ } };

    await drop(() => supabase.from('room_turns').delete().eq('user_id', user.id).eq('room_key', id));
    await drop(() => supabase.from('item_plans').delete().eq('user_id', user.id).eq('entity_id', id));
    await drop(() => supabase.from('entity_reflections').delete().eq('user_id', user.id).like('pair_key', `%${id}%`));
    // UNFILE, NEVER DELETE — the file outlives the project it was filed under.
    await drop(() => supabase.from('knowledge_files').update({ entity_id: null }).eq('user_id', user.id).eq('entity_id', id));
    // The links go last before the row: an item that loses its project becomes loose, never gone.
    await drop(() => supabase.from('entity_links').delete().eq('user_id', user.id).eq('entity_id', id));

    const { error: delErr } = await supabase.from('work_entities').delete().eq('id', id).eq('user_id', user.id);
    if (delErr) return NextResponse.json({ error: 'failed' }, { status: 500 });

    await logActivity(supabase, user.id, {
      type: 'entity_deleted',
      title: `Deleted project: ${ent.name}`,
      entityType: 'work_entity', entityId: id,
      metadata: { name: ent.name, irreversible: true },
    }).catch(() => {});
    import('@/lib/home/bust-brief').then(({ softBustBrief }) => softBustBrief(supabase, user.id)).catch(() => {});

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[entities/delete] error:', e);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}

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
    if (action === 'rename') {
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
      if (action === 'track') {
        // R4 — tracking IS founding the visible project: narrate the entity's existing links as
        // the member proposal into its room (zero AI — recognition already stored them).
        const { narrateFounding } = await import('@/lib/entities/founding');
        await narrateFounding(supabase, user.id, id, ent.name as string, 'tracking');
      }
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
