import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

type Params = { params: Promise<{ id: string }> };

// GET /api/agents/[id]/skills — list skills assigned to this worker.
export async function GET(_req: NextRequest, { params }: Params) {
  const { id: agentId } = await params;
  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: agent } = await supabase
      .from('custom_agents')
      .select('id')
      .eq('id', agentId)
      .eq('user_id', user.id)
      .single();
    if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });

    const { data: links, error } = await supabase
      .from('agent_skills')
      .select('skill_id, skills(id, name, when_to_use, source)')
      .eq('agent_id', agentId);
    if (error) throw error;

    const skills = (links ?? [])
      .map((l: { skills: unknown }) => (Array.isArray(l.skills) ? l.skills[0] : l.skills))
      .filter(Boolean);
    return NextResponse.json({ skills });
  } catch (err) {
    console.error('[Agents/skills] GET error:', err);
    return NextResponse.json({ error: 'Failed to load assigned skills' }, { status: 500 });
  }
}

// PUT /api/agents/[id]/skills — replace this worker's skill assignments.
// Body: { skill_ids: string[] }
export async function PUT(request: NextRequest, { params }: Params) {
  const { id: agentId } = await params;
  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: agent } = await supabase
      .from('custom_agents')
      .select('id')
      .eq('id', agentId)
      .eq('user_id', user.id)
      .single();
    if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });

    const body = await request.json();
    const rawIds: unknown[] = Array.isArray(body.skill_ids) ? body.skill_ids : [];
    const skillIds: string[] = [...new Set(rawIds.map(s => String(s)))];

    // Only assign skills the user actually owns (RLS would block others, but
    // filter explicitly so a bad ID doesn't silently break the whole write).
    let ownedIds: string[] = [];
    if (skillIds.length > 0) {
      const { data: owned } = await supabase
        .from('skills')
        .select('id')
        .eq('user_id', user.id)
        .in('id', skillIds);
      ownedIds = (owned ?? []).map((s: { id: string }) => s.id);
    }

    // Replace: clear existing assignments, then insert the new set.
    await supabase.from('agent_skills').delete().eq('agent_id', agentId);
    if (ownedIds.length > 0) {
      const { error: insErr } = await supabase
        .from('agent_skills')
        .insert(ownedIds.map(skill_id => ({ agent_id: agentId, skill_id })));
      if (insErr) throw insErr;
    }

    return NextResponse.json({ ok: true, skill_ids: ownedIds });
  } catch (err) {
    console.error('[Agents/skills] PUT error:', err);
    return NextResponse.json({ error: 'Failed to update assigned skills' }, { status: 500 });
  }
}
