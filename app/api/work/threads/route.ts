import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// GET /api/work/threads — list user's work threads
export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: threads, error } = await supabase
      .from('work_threads')
      .select('id, title, plan, status, created_at, updated_at')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .order('updated_at', { ascending: false })
      .limit(50);

    if (error) throw error;
    return NextResponse.json({ threads: threads || [] });
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
    const { title } = body;

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
