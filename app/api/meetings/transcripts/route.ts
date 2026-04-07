import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdmin } from '@supabase/supabase-js';

// GET /api/meetings/transcripts
// Paginated list of meeting transcripts for the current user
export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Auto-fail rows stuck in processing for > 2 hours — Hetzner job likely crashed
    const adminClient = createAdmin(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    await adminClient
      .from('meeting_transcripts')
      .update({ bot_state: 'failed', processed: true })
      .eq('user_id', user.id)
      .eq('processed', false)
      .eq('bot_state', 'processing')
      .lt('updated_at', new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString());

    const { data: transcripts, error } = await supabase
      .from('meeting_transcripts')
      .select('id, title, start_time, end_time, duration_minutes, work_items_generated, processed, source, summary, calendar_event_id, bot_state, updated_at, folder_id, recording_storage_path, notes_structured, attendees')
      .eq('user_id', user.id)
      .order('start_time', { ascending: false })
      .limit(50);

    if (error) throw error;

    // Compute has_document server-side and strip the full notes_structured blob to keep payload small
    const mapped = (transcripts ?? []).map((t) => ({
      ...t,
      has_document: !!(t.notes_structured as any)?.document,
      notes_structured: undefined,
    }));

    return NextResponse.json({ transcripts: mapped });
  } catch (error) {
    console.error('[Meetings/Transcripts] Error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
