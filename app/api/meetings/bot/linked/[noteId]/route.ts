import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * GET /api/meetings/bot/linked/[noteId]
 *
 * Finds the bot transcript for a given text note id. Handles two architectures:
 *
 * Legacy (2-row): Hetzner INSERT'd a new bot row with calendar_event_id = noteId.
 * New (1-row): Hetzner PATCH'd the text note itself, converting it to source='bot'.
 *
 * Returns { id, botState, processed } when found, or { notFound: true }.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ noteId: string }> },
) {
  const { noteId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Check legacy pattern first: separate bot row linking back via calendar_event_id
  const { data: linked } = await supabase
    .from('meeting_transcripts')
    .select('id, bot_state, processed')
    .eq('calendar_event_id', noteId)
    .eq('user_id', user.id)
    .eq('source', 'bot')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (linked) {
    return NextResponse.json({ id: linked.id, botState: linked.bot_state, processed: linked.processed });
  }

  // New pattern: the note itself was converted to source='bot' by Hetzner PATCH
  const { data: self } = await supabase
    .from('meeting_transcripts')
    .select('id, bot_state, processed')
    .eq('id', noteId)
    .eq('user_id', user.id)
    .eq('source', 'bot')
    .maybeSingle();

  if (self) {
    return NextResponse.json({ id: self.id, botState: self.bot_state, processed: self.processed });
  }

  return NextResponse.json({ notFound: true });
}
