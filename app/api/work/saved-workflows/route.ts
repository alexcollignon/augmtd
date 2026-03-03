import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// GET /api/work/saved-workflows — list user's saved workflows
export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data, error } = await supabase
      .from('saved_workflows')
      .select('id, name, prompt, deliverable_types, usage_count, last_used_at, created_from_thread_id, created_at')
      .eq('user_id', user.id)
      .order('last_used_at', { ascending: false, nullsFirst: false })
      .limit(20);

    if (error) {
      console.error('[SavedWorkflows] GET error:', error);
      return NextResponse.json({ error: 'Failed to load workflows' }, { status: 500 });
    }

    return NextResponse.json({ savedWorkflows: data || [] });
  } catch (error) {
    console.error('[SavedWorkflows] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST /api/work/saved-workflows — create a saved workflow
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { name, prompt, deliverable_types, created_from_thread_id } = body;

    if (!name?.trim() || !prompt?.trim()) {
      return NextResponse.json({ error: 'name and prompt are required' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('saved_workflows')
      .insert({
        user_id: user.id,
        name: name.trim(),
        prompt: prompt.trim(),
        deliverable_types: deliverable_types ?? [],
        created_from_thread_id: created_from_thread_id ?? null,
      })
      .select('id, name, prompt, deliverable_types, usage_count, last_used_at, created_from_thread_id, created_at')
      .single();

    if (error) {
      console.error('[SavedWorkflows] POST error:', error);
      return NextResponse.json({ error: 'Failed to save workflow' }, { status: 500 });
    }

    return NextResponse.json({ savedWorkflow: data });
  } catch (error) {
    console.error('[SavedWorkflows] POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
