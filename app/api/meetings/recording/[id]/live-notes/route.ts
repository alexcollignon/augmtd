import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * PATCH /api/meetings/recording/[id]/live-notes
 * Saves live notes directly into transcript.notes_structured.live_notes.
 * Used for bot meetings (both scheduled and ad-hoc) so the user's notes
 * reach generate-insights when the meeting ends.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: transcriptId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { liveNotes } = await req.json();

  const { data: transcript } = await supabase
    .from('meeting_transcripts')
    .select('id, notes_structured')
    .eq('id', transcriptId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!transcript) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const existing = (transcript.notes_structured as Record<string, any>) ?? {};
  const { error } = await supabase
    .from('meeting_transcripts')
    .update({ notes_structured: { ...existing, live_notes: liveNotes ?? '' } })
    .eq('id', transcriptId)
    .eq('user_id', user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
