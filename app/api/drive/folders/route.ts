import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data, error } = await supabase
      .from('drive_folders')
      .select('id, name, parent_id, is_system, system_key, created_at')
      .eq('user_id', user.id)
      .order('is_system', { ascending: false })
      .order('name', { ascending: true });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data ?? []);
  } catch (error) {
    console.error('[Drive/Folders GET] Error:', error);
    return NextResponse.json({ error: 'Failed to fetch folders' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { name, parentId } = await request.json() as { name: string; parentId?: string };
    if (!name?.trim()) return NextResponse.json({ error: 'name is required' }, { status: 400 });

    // ONE NAME, ONE FOLDER. A workflow step points at a folder BY NAME (`read_kb_folder`,
    // `match_to_profiles` — the token ladder resolves spellings WITHIN one folder, never BETWEEN
    // two), so a second folder wearing the same name is an ambiguity that silently kills a task.
    const { data: clash } = await supabase
      .from('drive_folders').select('id, name').eq('user_id', user.id).ilike('name', name.trim()).limit(1);
    if ((clash ?? []).length) {
      return NextResponse.json({ error: `You already have a folder called "${name.trim()}".` }, { status: 409 });
    }

    const { data, error } = await supabase
      .from('drive_folders')
      .insert({ user_id: user.id, name: name.trim(), parent_id: parentId ?? null })
      .select('id, name, parent_id, is_system, system_key, created_at')
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  } catch (error) {
    console.error('[Drive/Folders POST] Error:', error);
    return NextResponse.json({ error: 'Failed to create folder' }, { status: 500 });
  }
}
