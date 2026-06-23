import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

type Params = { params: Promise<{ id: string }> };

// PATCH /api/skills/[id] — edit a skill. Body: any of { name, when_to_use, content, icon, color }
export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) return NextResponse.json({ error: 'name cannot be empty' }, { status: 400 });
      update.name = name;
    }
    if (body.content !== undefined) {
      const content = String(body.content).trim();
      if (!content) return NextResponse.json({ error: 'content cannot be empty' }, { status: 400 });
      update.content = content;
    }
    if (body.when_to_use !== undefined) update.when_to_use = body.when_to_use ? String(body.when_to_use).trim() : null;
    if (body.kind !== undefined) update.kind = ['voice', 'domain', 'audience', 'method'].includes(body.kind) ? body.kind : null;
    if (body.icon !== undefined) update.icon = body.icon ?? null;
    if (body.color !== undefined) update.color = body.color ?? null;

    const { data: skill, error } = await supabase
      .from('skills')
      .update(update)
      .eq('id', id)
      .eq('user_id', user.id)
      .select('id, name, when_to_use, content, source, kind, icon, color, created_at, updated_at')
      .single();
    if (error) throw error;
    if (!skill) return NextResponse.json({ error: 'Skill not found' }, { status: 404 });

    return NextResponse.json({ skill });
  } catch (err) {
    console.error('[Skills] PATCH error:', err);
    return NextResponse.json({ error: 'Failed to update skill' }, { status: 500 });
  }
}

// DELETE /api/skills/[id] — remove a skill (cascades to agent_skills assignments).
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { error } = await supabase
      .from('skills')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id);
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[Skills] DELETE error:', err);
    return NextResponse.json({ error: 'Failed to delete skill' }, { status: 500 });
  }
}
