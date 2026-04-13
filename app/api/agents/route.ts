import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// GET /api/agents — list user's custom agents
export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: agents, error } = await supabase
      .from('custom_agents')
      .select('id, name, description, instructions, memory_text, color, icon, is_active, created_at, updated_at')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .order('created_at', { ascending: true });

    if (error) throw error;
    return NextResponse.json({ agents: agents ?? [] });
  } catch (err) {
    console.error('[Agents] GET error:', err);
    return NextResponse.json({ error: 'Failed to load agents' }, { status: 500 });
  }
}

// POST /api/agents — create a new agent
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const { name, description, instructions, color = 'indigo', icon = 'cpu-chip' } = body as {
      name: string;
      description?: string;
      instructions?: string;
      color?: string;
      icon?: string;
    };

    if (!name?.trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 });

    const { data: agent, error } = await supabase
      .from('custom_agents')
      .insert({
        user_id: user.id,
        name: name.trim().slice(0, 100),
        description: description?.trim().slice(0, 300) ?? null,
        instructions: instructions?.trim() ?? null,
        color,
        icon,
      })
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ agent });
  } catch (err) {
    console.error('[Agents] POST error:', err);
    return NextResponse.json({ error: 'Failed to create agent' }, { status: 500 });
  }
}
