import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// GET /api/drive/folders — list user folders
export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data, error } = await supabase
      .from('drive_folders')
      .select('id, name, parent_id, is_system, system_key, created_at')
      .eq('user_id', user.id)
      .order('is_system', { ascending: false })
      .order('name', { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data ?? []);
  } catch (error) {
    console.error('[Drive/Folders GET] Error:', error);
    return NextResponse.json({ error: 'Failed to fetch folders' }, { status: 500 });
  }
}

// POST /api/drive/folders — create folder
// Body: { name, parentId? }
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { name, parentId } = body as { name: string; parentId?: string };

    if (!name?.trim()) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('drive_folders')
      .insert({
        user_id: user.id,
        name: name.trim(),
        parent_id: parentId ?? null,
      })
      .select('id, name, parent_id, is_system, system_key, created_at')
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('[Drive/Folders POST] Error:', error);
    return NextResponse.json({ error: 'Failed to create folder' }, { status: 500 });
  }
}
