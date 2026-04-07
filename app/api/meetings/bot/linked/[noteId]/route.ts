import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * GET /api/meetings/bot/linked/[noteId]
 *
 * Finds the bot transcript row whose calendar_event_id matches the given text note id.
 * Used by InlineNoteView to detect when Hetzner has created the bot transcript after
 * the user clicked "Send assistant" from an ad-hoc note session.
 *
 * Returns { id, botState } when found, or { notFound: true }.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ noteId: string }> },
) {
  const { noteId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data } = await supabase
    .from('meeting_transcripts')
    .select('id, bot_state, processed')
    .eq('calendar_event_id', noteId)
    .eq('user_id', user.id)
    .eq('source', 'bot')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return NextResponse.json({ notFound: true });

  return NextResponse.json({ id: data.id, botState: data.bot_state, processed: data.processed });
}
