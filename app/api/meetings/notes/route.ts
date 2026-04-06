import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { randomUUID } from 'crypto';

/**
 * POST /api/meetings/notes
 * Create a text-only meeting note (no audio recording).
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const title = (body.title ?? 'Untitled note').trim();
  const noteBody = (body.body ?? '').trim();
  const calendarEventId = body.calendarEventId ?? null;
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from('meeting_transcripts')
    .insert({
      user_id: user.id,
      meeting_id: randomUUID(),
      calendar_event_id: calendarEventId,
      attendee_bot_id: null,
      bot_state: null,
      source: 'text',
      recording_storage_path: null,
      title,
      start_time: now,
      end_time: now,
      duration_minutes: 0,
      transcript: noteBody,
      transcript_segments: [],
      attendees: [],
      processed: false,
    })
    .select('id')
    .single();

  if (error) {
    console.error('[Notes] Failed to create text note:', error);
    return NextResponse.json({ error: 'Failed to create note' }, { status: 500 });
  }

  return NextResponse.json({ id: data.id });
}
