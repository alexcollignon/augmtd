import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * GET /api/meetings
 * Fetches calendar events with meeting_status for sidebar display
 */
export async function GET() {
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

    // Fetch calendar events for the next 7 days and past 24 hours
    const now = new Date();
    const past24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const next7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const { data: meetings, error } = await supabase
      .from('calendar_events')
      .select('*')
      .eq('user_id', user.id)
      .eq('status', 'confirmed') // Only show confirmed meetings
      .gte('end_time', past24Hours.toISOString()) // Include meetings that ended in last 24h
      .lte('start_time', next7Days.toISOString()) // Only show meetings in next 7 days
      .order('start_time', { ascending: true });

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
        };
      })
    );

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
