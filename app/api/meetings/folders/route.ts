import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data, error } = await supabase
      .from('meeting_folders')
      .select('id, name, created_at')
      .eq('user_id', user.id)
      .order('name', { ascending: true });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data ?? []);
  } catch (err) {
    console.error('[meetings/folders GET]', err);
    return NextResponse.json({ error: 'Failed to fetch folders' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { name } = await request.json() as { name: string };
    if (!name?.trim()) return NextResponse.json({ error: 'name is required' }, { status: 400 });

    const { data, error } = await supabase
      .from('meeting_folders')
      .insert({ user_id: user.id, name: name.trim() })
      .select('id, name, created_at')
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  } catch (err) {
    console.error('[meetings/folders POST]', err);
    return NextResponse.json({ error: 'Failed to create folder' }, { status: 500 });
  }
}
