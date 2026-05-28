import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: item } = await supabase
      .from('inbox_items')
      .select('id, is_flagged')
      .eq('id', id)
      .eq('user_id', user.id)
      .single();

    if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const newValue = !item.is_flagged;
    await supabase
      .from('inbox_items')
      .update({ is_flagged: newValue })
      .eq('id', id)
      .eq('user_id', user.id);

    return NextResponse.json({ ok: true, is_flagged: newValue });
  } catch (err) {
    console.error('[flag] error:', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
