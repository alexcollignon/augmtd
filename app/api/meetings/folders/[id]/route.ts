import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { name } = await request.json() as { name: string };
    if (!name?.trim()) return NextResponse.json({ error: 'name is required' }, { status: 400 });

    const { data, error } = await supabase
      .from('meeting_folders')
      .update({ name: name.trim() })
      .eq('id', id)
      .eq('user_id', user.id)
      .select('id, name, created_at')
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  } catch (err) {
    console.error('[meetings/folders PATCH]', err);
    return NextResponse.json({ error: 'Failed to rename folder' }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Recordings with this folder_id get folder_id = NULL via ON DELETE SET NULL
    const { error } = await supabase
      .from('meeting_folders')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[meetings/folders DELETE]', err);
    return NextResponse.json({ error: 'Failed to delete folder' }, { status: 500 });
  }
}
