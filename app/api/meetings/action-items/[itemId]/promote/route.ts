import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { sanitizeError } from '@/lib/utils/api-error';

export async function PATCH(
  _req: NextRequest,
  { params }: { params: Promise<{ itemId: string }> }
) {
  const { itemId } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Verify ownership and that it's a meeting item
  const { data: item } = await supabase
    .from('inbox_items')
    .select('id, source')
    .eq('id', itemId)
    .eq('user_id', user.id)
    .eq('source', 'meeting')
    .single();

  if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { error } = await supabase
    .from('inbox_items')
    .update({ source: 'meeting_action' })
    .eq('id', itemId)
    .eq('user_id', user.id);

  if (error) return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });

  return NextResponse.json({ success: true });
}
