import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { extractMeetingInsights, textToSegments } from '@/lib/integrations/meeting-bot/bot-manager';

/**
 * POST /api/meetings/notes/[id]/process
 * Run AI insight extraction on a text-only note.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Load the text note
  const { data: transcript, error: fetchError } = await supabase
    .from('meeting_transcripts')
    .select('id, title, transcript, source, processed')
    .eq('id', id)
    .eq('user_id', user.id)
    .single();

  if (fetchError || !transcript) {
    return NextResponse.json({ error: 'Note not found' }, { status: 404 });
  }

  if (!transcript.transcript?.trim()) {
    return NextResponse.json({ error: 'Note is empty — write some text before processing' }, { status: 400 });
  }

  // Mark as in-progress before running AI so navigating away + back shows "Processing..."
  await supabase
    .from('meeting_transcripts')
    .update({ processed: false, bot_state: 'processing' })
    .eq('id', id);

  // Convert text to pseudo-segments
  const segments = textToSegments(transcript.transcript);

  // Run AI extraction
  const insights = await extractMeetingInsights(
    user.id,
    transcript.title,
    segments,
    supabase,
    undefined, // no live notes for text notes — the text IS the notes
  );

  const GENERIC_TITLES = new Set([
    '', 'untitled note', 'untitled meeting', 'ad-hoc meeting', 'meeting', 'new note',
  ]);

  // Update transcript with results
  const update: Record<string, any> = {
    processed: true,
    transcript_segments: segments,
    work_items_generated: 0, // text notes don't auto-create inbox items
    summary: insights.document || null,
    decisions: insights.decisions,
    key_moments: insights.keyMoments,
    risks: insights.risks ?? [],
    suggested_next_step: insights.suggested_next_step ?? null,
    notes_structured: {
      document: insights.document || '',
      live_notes: '',
    },
  };

  if (insights.generatedTitle && GENERIC_TITLES.has(transcript.title?.trim().toLowerCase() ?? '')) {
    update.title = insights.generatedTitle;
  }

  await supabase
    .from('meeting_transcripts')
    .update(update)
    .eq('id', id);

  return NextResponse.json({ success: true });
}
