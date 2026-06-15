import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// GET /api/work/threads — list user's work threads
// Optional ?agent_id=<uuid> filters to threads for a specific worker/agent
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const agentId = request.nextUrl.searchParams.get('agent_id');

    let query = supabase
      .from('work_threads')
      .select('id, title, plan, status, created_at, updated_at, agent_id')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .or('is_temporary.eq.false,is_temporary.is.null')
      .is('workflow_id', null)
      .order('updated_at', { ascending: false })
      .limit(50);

    if (agentId) {
      query = query.eq('agent_id', agentId);
    }

    const { data: threads, error } = await query;
    if (error) throw error;

    // When not filtering by a specific agent, exclude threads that belong to workers —
    // those live in the Workers section and shouldn't bleed into Chat history.
    if (!agentId) {
      const { data: workerRows } = await supabase
        .from('custom_agents')
        .select('id')
        .eq('user_id', user.id)
        .not('worker_role', 'is', null);

      if (workerRows && workerRows.length > 0) {
        const workerIds = new Set(workerRows.map((w: { id: string }) => w.id));
        const filtered = (threads ?? []).filter(t => !t.agent_id || !workerIds.has(t.agent_id));
        return NextResponse.json({ threads: filtered });
      }
    }

    return NextResponse.json({ threads: threads ?? [] });
  } catch (error) {
    console.error('[WorkThreads] GET error:', error);
    return NextResponse.json({ error: 'Failed to load threads' }, { status: 500 });
  }
}

// POST /api/work/threads — create a new work thread
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { title, agentId, isTemporary } = body;

    if (!title || typeof title !== 'string') {
      return NextResponse.json({ error: 'Title is required' }, { status: 400 });
    }

    const { data: thread, error } = await supabase
      .from('work_threads')
      .insert({
        user_id: user.id,
        title: title.trim().substring(0, 200),
        plan: null,
        status: 'active',
        is_temporary: isTemporary === true,
        ...(agentId ? { agent_id: agentId } : {}),
      })
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ thread });
  } catch (error) {
    console.error('[WorkThreads] POST error:', error);
    return NextResponse.json({ error: 'Failed to create thread' }, { status: 500 });
  }
}
