import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

type Params = { params: Promise<{ id: string }> };

// POST /api/agents/[id]/knowledge
// Body: { knowledge_file_id, name }
// Attaches an already-indexed knowledge_files row to this agent.
export async function POST(request: NextRequest, { params }: Params) {
  const { id: agentId } = await params;
  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Verify agent belongs to this user
    const { data: agent } = await supabase
      .from('custom_agents')
      .select('id')
      .eq('id', agentId)
      .eq('user_id', user.id)
      .single();
    if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });

    const body = await request.json();
    const { knowledge_file_id, name } = body as { knowledge_file_id: string; name: string };
    if (!knowledge_file_id || !name) {
      return NextResponse.json({ error: 'knowledge_file_id and name are required' }, { status: 400 });
    }

    // Verify the file belongs to this user
    const { data: kbFile } = await supabase
      .from('knowledge_files')
      .select('id')
      .eq('id', knowledge_file_id)
      .eq('user_id', user.id)
      .single();
    if (!kbFile) return NextResponse.json({ error: 'File not found' }, { status: 404 });

    const { data: source, error } = await supabase
      .from('agent_knowledge_sources')
      .insert({ agent_id: agentId, knowledge_file_id, name })
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ source });
  } catch (err) {
    console.error('[Agents/knowledge] POST error:', err);
    return NextResponse.json({ error: 'Failed to attach knowledge source' }, { status: 500 });
  }
}
