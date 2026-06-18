import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// GET /api/skills — list the user's skill library, each annotated with which
// workers it's assigned to (for "used by Sofia, Luca" on the card).
export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: skills, error } = await supabase
      .from('skills')
      .select('id, name, when_to_use, content, source, icon, color, created_at, updated_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });
    if (error) throw error;

    // Resolve worker assignments in one pass (owner-scoped via RLS).
    const ids = (skills ?? []).map(s => s.id);
    const usageBySkill: Record<string, Array<{ id: string; name: string; worker_role: string | null }>> = {};
    if (ids.length > 0) {
      const { data: links } = await supabase
        .from('agent_skills')
        .select('skill_id, custom_agents(id, name, worker_role)')
        .in('skill_id', ids);
      for (const link of (links ?? []) as Array<{ skill_id: string; custom_agents: { id: string; name: string; worker_role: string | null } | { id: string; name: string; worker_role: string | null }[] | null }>) {
        const agent = Array.isArray(link.custom_agents) ? link.custom_agents[0] : link.custom_agents;
        if (!agent) continue;
        (usageBySkill[link.skill_id] ??= []).push(agent);
      }
    }

    const withUsage = (skills ?? []).map(s => ({ ...s, workers: usageBySkill[s.id] ?? [] }));
    return NextResponse.json({ skills: withUsage });
  } catch (err) {
    console.error('[Skills] GET error:', err);
    return NextResponse.json({ error: 'Failed to load skills' }, { status: 500 });
  }
}

// POST /api/skills — create a skill.
// Body: { name, when_to_use?, content, source?, icon?, color? }
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const name = String(body.name ?? '').trim();
    const content = String(body.content ?? '').trim();
    if (!name || !content) {
      return NextResponse.json({ error: 'name and content are required' }, { status: 400 });
    }

    const { data: skill, error } = await supabase
      .from('skills')
      .insert({
        user_id: user.id,
        name,
        when_to_use: body.when_to_use ? String(body.when_to_use).trim() : null,
        content,
        source: ['manual', 'extracted', 'imported', 'chat'].includes(body.source) ? body.source : 'manual',
        icon: body.icon ?? null,
        color: body.color ?? null,
      })
      .select('id, name, when_to_use, content, source, icon, color, created_at, updated_at')
      .single();
    if (error) throw error;

    return NextResponse.json({ skill: { ...skill, workers: [] } });
  } catch (err) {
    console.error('[Skills] POST error:', err);
    return NextResponse.json({ error: 'Failed to create skill' }, { status: 500 });
  }
}
