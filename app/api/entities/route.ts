import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { logActivity } from '@/lib/activity/log';

// ONE BRAIN — create a body of work by hand (the meetings sidebar's "new project", the portfolio's future
// "add"). A user DECLARING work = FOUNDING a tracked entity; recognition + the magnet-free membership flows
// attach items to it via links from then on.
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const body = (await request.json()) as { name?: string; description?: string };
    const name = String(body.name ?? '').trim().slice(0, 80);
    if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 });
    const { data: existing } = await supabase.from('work_entities').select('id')
      .eq('user_id', user.id).eq('kind', 'initiative').ilike('name', name).maybeSingle();
    if (existing) {
      await supabase.from('work_entities').update({ tracked: true, status: 'active', updated_at: new Date().toISOString() }).eq('id', existing.id);
      return NextResponse.json({ id: existing.id, existed: true });
    }
    const { data: created, error: ierr } = await supabase.from('work_entities').insert({
      user_id: user.id, kind: 'initiative', name, summary: body.description?.slice(0, 300) ?? null,
      aliases: [name], tracked: true, status: 'active',
    }).select('id').single();
    if (ierr || !created) return NextResponse.json({ error: 'failed' }, { status: 500 });
    await logActivity(supabase, user.id, { type: 'entity_track', title: `Tracked: ${name}`, entityType: 'work_entity', entityId: created.id as string, metadata: {} }).catch(() => {});
    return NextResponse.json({ id: created.id });
  } catch (e) {
    console.error('[entities/create] error:', e);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
