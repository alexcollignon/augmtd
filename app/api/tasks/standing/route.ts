// ════════════════════════════════════════════════════════════════════════════════════════════════
// POST /api/tasks/standing — THE SPEC CARD's commit door (Arc 2 stage 2).
//
// The card's Confirm fires here — the ONLY place a standing task is born from a spec. Reads the
// durable `standing_spec` turn (user-scoped, pending-guarded — a replay/second click is a no-op),
// creates the workflow through the one task-creation door, binds its standing commitment, and
// flips the card in place (dedupe update — the story keeps its position; the card becomes the
// record of what was confirmed).
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import type { StandingSpec } from '@/lib/work/standing-spec';

export const maxDuration = 120; // generate-config is an AI pass

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const body = await request.json().catch(() => ({}));
    const roomKey = String(body.roomKey ?? '').trim();
    const dedupeKey = String(body.dedupeKey ?? '').trim();
    if (!roomKey || !dedupeKey.startsWith('standing-spec:')) {
      return NextResponse.json({ error: 'roomKey and dedupeKey required' }, { status: 400 });
    }

    const admin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const { data: turn } = await admin.from('room_turns')
      .select('id, component').eq('user_id', user.id).eq('room_key', roomKey).eq('dedupe_key', dedupeKey).maybeSingle();
    const comp = (turn?.component ?? null) as { key?: string; state?: StandingSpec & { status?: string } } | null;
    if (!turn || comp?.key !== 'standing_spec' || !comp.state) {
      return NextResponse.json({ error: 'No such proposal' }, { status: 404 });
    }
    if (comp.state.status === 'confirmed') {
      // Exactly-once at this door: a double click / replay returns the prior result, creates nothing.
      const st = comp.state as StandingSpec & { workflowId?: string };
      return NextResponse.json({ ok: true, workflowId: st.workflowId ?? null, already: true });
    }

    const { confirmStandingSpec } = await import('@/lib/work/standing-spec');
    const res = await confirmStandingSpec(admin, supabase, user.id, comp.state);
    if ('error' in res) return NextResponse.json({ error: res.error }, { status: 502 });

    // Flip the card in place — the dedupe update keeps its position; the text becomes the record.
    const { writeRoomTurn } = await import('@/lib/room/turns');
    const firstRunDay = res.firstRun ? res.firstRun.slice(0, 10) : null;
    await writeRoomTurn(admin, user.id, roomKey, {
      role: 'system',
      text: `Standing task confirmed: "${res.name}" — ${comp.state.cadenceLabel}, ${comp.state.ownerName.split(' ')[0]} owns it.${firstRunDay ? ` First run ${firstRunDay}.` : ''}`,
      dedupeKey,
      component: { key: 'standing_spec', state: { ...comp.state, status: 'confirmed', workflowId: res.workflowId, firstRun: res.firstRun } },
    });
    return NextResponse.json({ ok: true, workflowId: res.workflowId, name: res.name, firstRun: res.firstRun });
  } catch (e) {
    console.error('[tasks/standing]', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
