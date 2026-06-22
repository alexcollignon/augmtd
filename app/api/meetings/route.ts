import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * GET /api/meetings
 * Fetches calendar events with meeting_status for sidebar display
 * Query params:
 *   ?folderId=<uuid>       — filter by folder
 *   ?folderId=unorganised  — filter to events with no folder
 */
export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();

    // Get authenticated user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const folderId = req.nextUrl.searchParams.get('folderId');

    // Fetch calendar events for the next 7 days and past 24 hours
    const now = new Date();
    const past24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const next14Days = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

    let query = supabase
      .from('calendar_events')
      .select('*')
      .eq('user_id', user.id)
      .eq('status', 'confirmed')
      .gte('end_time', past24Hours.toISOString())
      .lte('start_time', next14Days.toISOString())
      .order('start_time', { ascending: true });

    if (folderId === 'unorganised') {
      query = query.is('folder_id', null);
    } else if (folderId) {
      query = query.eq('folder_id', folderId);
    }

    const { data: meetings, error } = await query;

    if (error) {
      console.error('[API] Error fetching meetings:', error);
      return NextResponse.json({ error: 'Failed to fetch meetings' }, { status: 500 });
    }

    // Enrich attendees with VIP status from relationship_graph — one batch query
    const allAttendeeEmails = [
      ...new Set(
        (meetings || []).flatMap((m) => (m.attendees ?? []).map((a: any) => a.email).filter(Boolean))
      ),
    ];

    // The relationship + transcript lookups both depend only on the meetings list, not on
    // each other — run them in parallel instead of two sequential round-trips.
    const eventIds = (meetings || []).map((m) => m.id);
    const [relRes, transRes] = await Promise.all([
      allAttendeeEmails.length > 0
        ? supabase.from('relationship_graph').select('contact_email, importance').eq('user_id', user.id).in('contact_email', allAttendeeEmails)
        : Promise.resolve({ data: [] as { contact_email: string; importance: number }[] }),
      eventIds.length > 0
        ? supabase.from('meeting_transcripts').select('calendar_event_id').eq('user_id', user.id).in('calendar_event_id', eventIds)
        : Promise.resolve({ data: [] as { calendar_event_id: string }[] }),
    ]);

    const relMap = new Map<string, number>();
    (relRes.data ?? []).forEach((r) => relMap.set(r.contact_email, r.importance));
    const transcriptSet = new Set((transRes.data ?? []).map((t) => t.calendar_event_id));

    const enrichedMeetings = (meetings || []).map((meeting) => ({
      ...meeting,
      attendees: (meeting.attendees ?? []).map((attendee: any) => ({
        ...attendee,
        isVIP: (relMap.get(attendee.email) ?? 0) > 80,
        importance: relMap.get(attendee.email) ?? 0,
      })),
      has_transcript: transcriptSet.has(meeting.id),
    }));

    return NextResponse.json({
      meetings: enrichedMeetings,
      count: enrichedMeetings.length,
    });
  } catch (error) {
    console.error('[API] Error in /api/meetings:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
