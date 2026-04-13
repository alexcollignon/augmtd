import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

type Params = { params: Promise<{ id: string; sourceId: string }> };

// DELETE /api/agents/[id]/knowledge/[sourceId]
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id: agentId, sourceId } = await params;
  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Verify agent ownership via RLS join
    const { error } = await supabase
      .from('agent_knowledge_sources')
      .delete()
      .eq('id', sourceId)
      .eq('agent_id', agentId);

    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[Agents/knowledge/sourceId] DELETE error:', err);
    return NextResponse.json({ error: 'Failed to remove knowledge source' }, { status: 500 });
  }
}
