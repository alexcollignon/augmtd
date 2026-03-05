import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerSupabase } from '@/lib/supabase/server';

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Ownership check
  const { data: source } = await supabase
    .from('knowledge_sources')
    .select('id')
    .eq('id', id)
    .eq('user_id', user.id)
    .single();

  if (!source) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { error } = await supabase
    .from('knowledge_sources')
    .delete()
    .eq('id', id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
