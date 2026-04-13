import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// GET /api/work/threads — list user's work threads, or lookup by ?processId=X&stepIndex=Y
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const processId = searchParams.get('processId');
    const stepIndex = searchParams.get('stepIndex');

    // Lookup mode: return single thread for a specific process step
    if (processId && stepIndex !== null) {
      const { data: thread, error } = await supabase
        .from('work_threads')
        .select('id, title, plan, artifact, artifacts, status, is_generating, created_at, updated_at, process_id, process_step_index')
        .eq('user_id', user.id)
        .eq('process_id', processId)
        .eq('process_step_index', parseInt(stepIndex, 10))
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return NextResponse.json({ thread: thread ?? null });
    }

    const { data: threads, error } = await supabase
      .from('work_threads')
      .select('id, title, plan, status, created_at, updated_at, process_id, process_step_index, processes(title)')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .order('updated_at', { ascending: false })
      .limit(50);

    if (error) throw error;

    // Flatten processes(title) join into process_title
    const flattened = (threads || []).map((t: any) => ({
      ...t,
      process_title: t.processes?.title ?? null,
      processes: undefined,
    }));

    return NextResponse.json({ threads: flattened });
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
    const { title, processId, processStepIndex, agentId } = body;

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
        ...(processId ? { process_id: processId, process_step_index: processStepIndex ?? null } : {}),
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
