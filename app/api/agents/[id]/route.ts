import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

type Params = { params: Promise<{ id: string }> };

// GET /api/agents/[id]
export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: agent, error } = await supabase
      .from('custom_agents')
      .select(`
        id, name, description, instructions, memory_text, color, icon, is_active, created_at, updated_at,
        agent_knowledge_sources (id, name, knowledge_file_id, created_at)
      `)
      .eq('id', id)
      .eq('user_id', user.id)
      .single();

    if (error || !agent) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ agent });
  } catch (err) {
    console.error('[Agents/id] GET error:', err);
    return NextResponse.json({ error: 'Failed to load agent' }, { status: 500 });
  }
}

// PATCH /api/agents/[id]
export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const allowed = ['name', 'description', 'instructions', 'color', 'icon', 'memory_text'] as const;
    const updates: Record<string, unknown> = {};
    for (const key of allowed) {
      if (key in body) updates[key] = body[key];
    }

    if ('name' in updates && !String(updates.name).trim()) {
      return NextResponse.json({ error: 'Name cannot be empty' }, { status: 400 });
    }

    const { data: agent, error } = await supabase
      .from('custom_agents')
      .update(updates)
      .eq('id', id)
      .eq('user_id', user.id)
      .select()
      .single();

    if (error || !agent) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ agent });
  } catch (err) {
    console.error('[Agents/id] PATCH error:', err);
    return NextResponse.json({ error: 'Failed to update agent' }, { status: 500 });
  }
}

// DELETE /api/agents/[id]
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Soft delete — set is_active = false so threads remain intact
    const { error } = await supabase
      .from('custom_agents')
      .update({ is_active: false })
      .eq('id', id)
      .eq('user_id', user.id);

    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[Agents/id] DELETE error:', err);
    return NextResponse.json({ error: 'Failed to delete agent' }, { status: 500 });
  }
}
