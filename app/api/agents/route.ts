import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { generateStartersForAgent } from '@/lib/agents/generate-starters';
import { getActiveWorkspaceId } from '@/lib/workspace/active-workspace';

// GET /api/agents — list user's custom agents
export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const activeWorkspaceId = await getActiveWorkspaceId();

    let query = supabase
      .from('custom_agents')
      .select('id, name, description, instructions, memory_text, color, icon, is_active, created_at, updated_at, conversation_starters, web_enabled')
      .eq('user_id', user.id)
      .eq('is_active', true);
    if (activeWorkspaceId) query = query.or(`workspace_id.eq.${activeWorkspaceId},workspace_id.is.null`);

    const { data: agents, error } = await query.order('created_at', { ascending: true });

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
    const { name, description, instructions, color = 'indigo', icon = 'cpu-chip', conversation_starters, web_enabled = false } = body as {
      name: string;
      description?: string;
      instructions?: string;
      color?: string;
      icon?: string;
      conversation_starters?: string[] | null;
      web_enabled?: boolean;
    };

    if (!name?.trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 });

    const activeWorkspaceId = await getActiveWorkspaceId();

    // Resolve starters: use provided ones, or auto-generate
    const startersToSave = await resolveStarters(conversation_starters, { name, description, instructions, userId: user.id, supabase });

    const { data: agent, error } = await supabase
      .from('custom_agents')
      .insert({
        user_id: user.id,
        name: name.trim().slice(0, 100),
        description: description?.trim().slice(0, 300) ?? null,
        instructions: instructions?.trim() ?? null,
        color,
        icon,
        conversation_starters: startersToSave,
        web_enabled: Boolean(web_enabled),
        ...(activeWorkspaceId ? { workspace_id: activeWorkspaceId } : {}),
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

// ── Shared helper ─────────────────────────────────────────────────────────────

async function resolveStarters(
  provided: string[] | null | undefined,
  ctx: { name: string; description?: string; instructions?: string; userId: string; supabase: unknown }
): Promise<string[] | null> {
  const cleaned = (provided ?? []).filter(s => s.trim());
  if (cleaned.length > 0) return cleaned.slice(0, 4);
  // Auto-generate when none provided
  return generateStartersForAgent({ ...ctx, supabase: ctx.supabase });
}
