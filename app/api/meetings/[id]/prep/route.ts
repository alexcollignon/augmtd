import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * GET /api/meetings/[id]/prep
 * Generate a meeting prep brief: past meetings with same attendees,
 * open action items, recent emails, relevant KB docs.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Load the calendar event to get attendees
  const { data: event } = await supabase
    .from('calendar_events')
    .select('id, title, attendees, start_time')
    .eq('id', id)
    .eq('user_id', user.id)
    .single();

  if (!event) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const attendeeEmails = (event.attendees ?? [])
    .map((a: any) => a.email)
    .filter(Boolean) as string[];

  if (attendeeEmails.length === 0) {
    return NextResponse.json({
      pastMeetings: [],
      openActionItems: [],
      recentEmails: [],
      relevantDocs: [],
    });
  }

  // 1. Past meetings with overlapping attendees
  // Get all user transcripts, then filter client-side for attendee overlap
  const { data: allTranscripts } = await supabase
    .from('meeting_transcripts')
    .select('id, title, start_time, summary, decisions, calendar_event_id')
    .eq('user_id', user.id)
    .eq('processed', true)
    .order('start_time', { ascending: false })
    .limit(50);

  const pastMeetings: Array<{ title: string; date: string; summary: string; decisions: any[] }> = [];

  if (allTranscripts) {
    // For each past transcript, check if any attendee overlaps
    for (const t of allTranscripts) {
      if (t.calendar_event_id === id) continue; // skip current meeting
      // Load event attendees
      const { data: pastEvent } = await supabase
        .from('calendar_events')
        .select('attendees')
        .eq('id', t.calendar_event_id)
        .maybeSingle();

      if (pastEvent) {
        const pastEmails = (pastEvent.attendees ?? []).map((a: any) => a.email).filter(Boolean);
        const overlap = pastEmails.some((e: string) => attendeeEmails.includes(e));
        if (overlap) {
          pastMeetings.push({
            title: t.title,
            date: t.start_time,
            summary: t.summary ?? '',
            decisions: (t.decisions as any[]) ?? [],
          });
        }
      }
      if (pastMeetings.length >= 5) break;
    }
  }

  // 2. Open action items from those past meetings
  const pastTranscriptIds = pastMeetings
    .map((pm) => allTranscripts?.find((t) => t.title === pm.title && t.start_time === pm.date)?.id)
    .filter(Boolean) as string[];

  let openActionItems: Array<{ title: string; fromMeeting: string; dueDate?: string }> = [];
  if (pastTranscriptIds.length > 0) {
    const { data: items } = await supabase
      .from('inbox_items')
      .select('work_title, source_data, status')
      .in('source_meeting_transcript_id', pastTranscriptIds)
      .neq('status', 'done')
      .limit(10);

    openActionItems = (items ?? []).map((item: any) => ({
      title: item.work_title,
      fromMeeting: item.source_data?.meeting_title ?? '',
      dueDate: item.source_data?.due_date ?? undefined,
    }));
  }

  // 3. Recent emails to/from attendees
  let recentEmails: Array<{ subject: string; from: string; date: string; snippet: string }> = [];
  try {
    const { data: emails } = await supabase
      .from('emails')
      .select('subject, sender_email, sender_name, received_at, snippet')
      .eq('user_id', user.id)
      .in('sender_email', attendeeEmails)
      .order('received_at', { ascending: false })
      .limit(5);

    recentEmails = (emails ?? []).map((e: any) => ({
      subject: e.subject ?? '(no subject)',
      from: e.sender_name ?? e.sender_email,
      date: e.received_at,
      snippet: e.snippet ?? '',
    }));
  } catch {
    // emails table might not have data
  }

  // 4. Relevant KB docs — simple title-based search
  let relevantDocs: Array<{ title: string; snippet: string }> = [];
  try {
    const { data: files } = await supabase
      .from('knowledge_files')
      .select('filename, summary')
      .eq('user_id', user.id)
      .not('summary', 'is', null)
      .order('updated_at', { ascending: false })
      .limit(20);

    // Simple keyword matching on meeting title
    const titleWords = event.title.toLowerCase().split(/\s+/).filter((w: string) => w.length > 3);
    relevantDocs = (files ?? [])
      .filter((f: any) => {
        const fname = (f.filename ?? '').toLowerCase();
        const fsummary = (f.summary ?? '').toLowerCase();
        return titleWords.some((w: string) => fname.includes(w) || fsummary.includes(w));
      })
      .slice(0, 3)
      .map((f: any) => ({
        title: f.filename,
        snippet: f.summary ?? '',
      }));
  } catch {
    // KB might not be populated
  }

  return NextResponse.json({
    pastMeetings,
    openActionItems,
    recentEmails,
    relevantDocs,
  });
}
