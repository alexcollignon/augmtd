import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    // category: string | null — null clears the assignment
    const { category } = body as { category: string | null };

    const { data: item } = await supabase
      .from('inbox_items')
      .select('id')
      .eq('id', id)
      .eq('user_id', user.id)
      .single();

    if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    await supabase
      .from('inbox_items')
      .update({ custom_category: category ?? null })
      .eq('id', id)
      .eq('user_id', user.id);

    return NextResponse.json({ ok: true, custom_category: category ?? null });
  } catch (err) {
    console.error('[categorize] error:', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
