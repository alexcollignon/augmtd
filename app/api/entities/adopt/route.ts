import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// THE FOUNDING ADOPTION (creation-time recognition — the "first sync", confirmed in the room).
// POST { targetId, sourceId } — a THIN wrapper over lib/entities/adopt.ts `adoptEntity` (converse
// arc): the proposal's BUTTON and a PROSE answer in the room conversation run through the SAME
// mechanic — absorb, label-era member linking, the proposal turn sheds the taken option, narration.
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { targetId, sourceId } = (await request.json()) as { targetId?: string; sourceId?: string };
    if (!targetId || !sourceId || targetId === sourceId) {
      return NextResponse.json({ error: 'targetId and sourceId required' }, { status: 400 });
    }
    const { adoptEntity } = await import('@/lib/entities/adopt');
    const r = await adoptEntity(supabase, user.id, targetId, sourceId);
    if (!r.ok) return NextResponse.json({ error: 'merge failed' }, { status: 500 });
    after(async () => {
      try { const { refreshEntityState } = await import('@/lib/entities/state'); await refreshEntityState(supabase, user.id, targetId, { force: true }); } catch { /* non-fatal */ }
      try { const { softBustBrief } = await import('@/lib/home/bust-brief'); await softBustBrief(supabase, user.id); } catch { /* non-fatal */ }
    });
    return NextResponse.json({ ok: true, keptName: r.targetName, total: r.total ?? 0 });
  } catch (e) {
    console.error('[entities/adopt]', e);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
