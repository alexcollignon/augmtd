import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// GET /api/meetings/[id]/linked-work
// Finds related processes, work threads, drive files, and prior meetings
// using tokenized title matching. [id] = calendar_event.id
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Fetch the calendar event title
    const { data: event } = await supabase
      .from('calendar_events')
      .select('title')
      .eq('id', id)
      .eq('user_id', user.id)
      .single();

    if (!event) return NextResponse.json({ processes: [], threads: [], files: [], priorMeetings: [] });

    // Tokenize title: words > 3 chars, take first 4
    const tokens = event.title
      .split(/\s+/)
      .map((w: string) => w.replace(/[^a-zA-Z0-9]/g, ''))
      .filter((w: string) => w.length > 3)
      .slice(0, 4);

    if (!tokens.length) {
      return NextResponse.json({ processes: [], threads: [], files: [], priorMeetings: [] });
    }

    const matchScore = (title: string) => {
      const titleLower = title.toLowerCase();
      const matched = tokens.filter((t: string) => titleLower.includes(t.toLowerCase())).length;
      return Math.round((matched / tokens.length) * 100);
    };

    const ilikeFilter = tokens.map((t: string) => `title.ilike.%${t}%`).join(',');

    // Parallel queries
    const [threadsRes, filesRes, priorRes] = await Promise.all([
      supabase
        .from('work_threads')
        .select('id, title')
        .eq('user_id', user.id)
        .or(ilikeFilter)
        .order('created_at', { ascending: false })
        .limit(3),
      supabase
        .from('knowledge_files')
        .select('id, filename, provider_file_id')
        .or(tokens.map((t: string) => `filename.ilike.%${t}%`).join(','))
        .limit(3),
      supabase
        .from('meeting_transcripts')
        .select('id, title, start_time, calendar_event_id')
        .eq('user_id', user.id)
        .neq('calendar_event_id', id)
        .or(ilikeFilter)
        .order('start_time', { ascending: false })
        .limit(3),
    ]);

    const threads = (threadsRes.data ?? []).map((t) => ({
      id: t.id, title: t.title, score: matchScore(t.title),
    }));
    const files = (filesRes.data ?? []).map((f) => ({
      id: f.id, filename: f.filename, score: matchScore(f.filename),
    }));
    const priorMeetings = (priorRes.data ?? []).map((m) => ({
      id: m.id, title: m.title, start_time: m.start_time,
      calendarEventId: m.calendar_event_id, score: matchScore(m.title),
    }));

    return NextResponse.json({ threads, files, priorMeetings });
  } catch (error) {
    console.error('[Meetings/LinkedWork] Error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
