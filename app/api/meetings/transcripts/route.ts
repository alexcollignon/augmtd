import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// GET /api/meetings/transcripts
// Paginated list of meeting transcripts for the current user
export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: transcripts, error } = await supabase
      .from('meeting_transcripts')
      .select('id, title, start_time, end_time, duration_minutes, work_items_generated, processed, source, summary, calendar_event_id, bot_state, updated_at')
      .eq('user_id', user.id)
      .order('start_time', { ascending: false })
      .limit(50);

    if (error) throw error;

    return NextResponse.json({ transcripts: transcripts ?? [] });
  } catch (error) {
    console.error('[Meetings/Transcripts] Error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
