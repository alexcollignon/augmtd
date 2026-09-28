import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

type Params = { params: Promise<{ id: string }> };

// POST /api/skills/[id]/assign — toggle one skill↔worker assignment.
// Body: { agent_id: string, assigned: boolean }
// Used by the Skills library cards to assign/unassign a worker in place — and (W21 SKILLS IN CHAT) by the
// chat menu's "Always use for <actor>" / "Remove from <actor>": THE ONLY door that changes an assignment
// (a per-message pick never does). `agent_id: 'chief'` resolves the chief-of-staff SEAT
// (lib/workers/cos-seat.ts) — the chief is a custom_agents row, so its skills are ordinary agent_skills rows.
export async function POST(request: NextRequest, { params }: Params) {
  const { id: skillId } = await params;
  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    let agentId = String(body.agent_id ?? '');
    const assigned = Boolean(body.assigned);
    if (!agentId) return NextResponse.json({ error: 'agent_id required' }, { status: 400 });
    if (agentId === 'chief') {
      const { resolveCosSeat } = await import('@/lib/workers/cos-seat');
      const seat = await resolveCosSeat(supabase, user.id);
      if (!seat) return NextResponse.json({ error: 'Worker not found' }, { status: 404 });
      agentId = seat.agentId;
    }

    // Verify both the skill and the worker belong to this user.
    const [{ data: skill }, { data: agent }] = await Promise.all([
      supabase.from('skills').select('id').eq('id', skillId).eq('user_id', user.id).single(),
      supabase.from('custom_agents').select('id').eq('id', agentId).eq('user_id', user.id).single(),
    ]);
    if (!skill) return NextResponse.json({ error: 'Skill not found' }, { status: 404 });
    if (!agent) return NextResponse.json({ error: 'Worker not found' }, { status: 404 });

    if (assigned) {
      const { error } = await supabase
        .from('agent_skills')
        .upsert({ agent_id: agentId, skill_id: skillId }, { onConflict: 'agent_id,skill_id' });
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from('agent_skills')
        .delete()
        .eq('agent_id', agentId)
        .eq('skill_id', skillId);
      if (error) throw error;
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[Skills/assign] POST error:', err);
    return NextResponse.json({ error: 'Failed to update assignment' }, { status: 500 });
  }
}
