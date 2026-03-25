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

    // Enrich attendees with VIP status from relationship_graph
    const enrichedMeetings = await Promise.all(
      (meetings || []).map(async (meeting) => {
        const attendeeEmails = meeting.attendees.map((a: any) => a.email);

        // Get relationship data for attendees
        const { data: relationships } = await supabase
          .from('relationship_graph')
          .select('contact_email, importance')
          .eq('user_id', user.id)
          .in('contact_email', attendeeEmails);

        // Enrich attendees with VIP status
        const enrichedAttendees = meeting.attendees.map((attendee: any) => {
          const rel = relationships?.find(r => r.contact_email === attendee.email);
          return {
            ...attendee,
            isVIP: rel ? rel.importance > 80 : false,
            importance: rel?.importance || 0,
          };
        });

        return {
          ...meeting,
          attendees: enrichedAttendees,
          has_transcript: false, // filled below
        };
      })
    );

    // Batch-check which events have transcripts
    const eventIds = enrichedMeetings.map((m) => m.id);
    if (eventIds.length > 0) {
      const { data: transcripts } = await supabase
        .from('meeting_transcripts')
        .select('calendar_event_id')
        .eq('user_id', user.id)
        .in('calendar_event_id', eventIds);

      const transcriptSet = new Set((transcripts ?? []).map((t) => t.calendar_event_id));
      enrichedMeetings.forEach((m) => {
        m.has_transcript = transcriptSet.has(m.id);
      });
    }

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
