import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * PATCH /api/meetings/notes/[id]
 * Update title and/or body of a text-only note.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const update: Record<string, any> = {};
  if (body.title !== undefined) update.title = body.title;
  if (body.body !== undefined) update.transcript = body.body;

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  }

  const { error } = await supabase
    .from('meeting_transcripts')
    .update(update)
    .eq('id', id)
    .eq('user_id', user.id)
    .eq('source', 'text');

  if (error) {
    console.error('[Notes] Failed to update text note:', error);
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
