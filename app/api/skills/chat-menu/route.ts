import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { readSkillLibrary, readAssignedSkillIds } from '@/lib/skills/for-turn';
import { buildChatMenu } from '@/lib/skills/menu';
import type { ChatMenuResponse } from '@/lib/skills/chat-contract';

// GET /api/skills/chat-menu?actor=<chief|agentId> — W21 SKILLS IN CHAT (contract: lib/skills/chat-contract.ts).
// The composer's skills menu for the addressed actor: its assigned skills first, then the rest of the
// library by recency. Reads only. `actor=chief` resolves the chief-of-staff SEAT (lib/workers/cos-seat.ts)
// — the chief is a custom_agents row, so its assignments are ordinary agent_skills rows.
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const actorParam = (request.nextUrl.searchParams.get('actor') ?? 'chief').trim();
    let actor: { id: string; name: string };
    if (actorParam === 'chief') {
      const { resolveCosSeat } = await import('@/lib/workers/cos-seat');
      const seat = await resolveCosSeat(supabase, user.id);
      actor = seat ? { id: seat.agentId, name: seat.name } : { id: 'chief', name: 'Your assistant' };
    } else {
      if (!/^[0-9a-f-]{36}$/i.test(actorParam)) return NextResponse.json({ error: 'Unknown actor' }, { status: 400 });
      const { data: agent, error } = await supabase.from('custom_agents').select('id, name')
        .eq('id', actorParam).eq('user_id', user.id).maybeSingle();
      if (error) throw error;
      if (!agent) return NextResponse.json({ error: 'Actor not found' }, { status: 404 });
      actor = { id: agent.id as string, name: String(agent.name ?? '') };
    }

    const [library, assigned] = await Promise.all([
      readSkillLibrary(supabase, user.id),
      readAssignedSkillIds(supabase, actor.id === 'chief' ? null : actor.id),
    ]);
    const body: ChatMenuResponse = buildChatMenu(actor, library, assigned);
    return NextResponse.json(body);
  } catch (err) {
    console.error('[Skills/chat-menu] GET error:', err);
    return NextResponse.json({ error: 'Failed to load skills menu' }, { status: 500 });
  }
}
