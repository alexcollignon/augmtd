import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { generateStartersForAgent } from '@/lib/agents/generate-starters';

// GET /api/agents — list user's custom agents
export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // RLS returns own active agents + shared company agents
    const { data: rows, error } = await supabase
      .from('custom_agents')
      .select('id, user_id, name, description, instructions, memory_text, color, icon, is_active, created_at, updated_at, conversation_starters, web_enabled, shared_with_company')
      .eq('is_active', true)
      .order('created_at', { ascending: true });

    if (error) throw error;
    const agentRows = rows ?? [];

    // Resolve owner names for shared agents owned by others
    const foreignUserIds = [...new Set(agentRows.filter(a => a.user_id !== user.id).map(a => a.user_id))];
    const ownerNames: Record<string, string> = {};
    if (foreignUserIds.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, full_name, email')
        .in('user_id', foreignUserIds);
      (profiles ?? []).forEach((p: { user_id: string; full_name: string | null; email: string | null }) => {
        ownerNames[p.user_id] = p.full_name ?? p.email?.split('@')[0] ?? 'Teammate';
      });
    }

    const agents = agentRows.map(a => ({
      ...a,
      is_owned_by_me: a.user_id === user.id,
      owner_name: a.user_id !== user.id ? (ownerNames[a.user_id] ?? 'Teammate') : null,
    }));

    return NextResponse.json({ agents });
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

    // Resolve starters: use provided ones, or auto-generate
    const startersToSave = await resolveStarters(conversation_starters, { name, description, instructions, userId: user.id, supabase });

    const { data: membership } = await supabase
      .from('company_members')
      .select('company_id')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .single();

    const { data: agent, error } = await supabase
      .from('custom_agents')
      .insert({
        user_id: user.id,
        company_id: membership?.company_id ?? null,
        name: name.trim().slice(0, 100),
        description: description?.trim().slice(0, 300) ?? null,
        instructions: instructions?.trim() ?? null,
        color,
        icon,
        conversation_starters: startersToSave,
        web_enabled: Boolean(web_enabled),
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
