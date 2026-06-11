import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getAIClient, aiCreate } from '@/lib/ai/factory';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: event } = await supabase
    .from('calendar_events')
    .select('id, title, description, attendees, start_time')
    .eq('id', id)
    .eq('user_id', user.id)
    .single();

  if (!event) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const attendeeEmails = (event.attendees ?? [])
    .map((a: any) => a.email)
    .filter(Boolean) as string[];

  const agenda = (event.description ?? '').trim() || null;

  if (attendeeEmails.length === 0) {
    return NextResponse.json({ pastMeetings: [], openActionItems: [], recentEmails: [], relevantDocs: [], relationships: [], agenda, aiSummary: null });
  }

  // Meeting title keywords for topic-based email filter
  const titleWords = event.title.toLowerCase().split(/\s+/).filter((w: string) => w.length > 3);

  // Run all independent queries in parallel
  const [
    transcriptsResult,
    relationshipsResult,
    topicEmailsResult,
    recentEmailsResult,
    kbResult,
  ] = await Promise.all([
    // Past transcripts (for attendee matching later)
    supabase
      .from('meeting_transcripts')
      .select('id, title, start_time, summary, decisions, calendar_event_id')
      .eq('user_id', user.id)
      .eq('processed', true)
      .neq('calendar_event_id', id)
      .order('start_time', { ascending: false })
      .limit(60),

    // Relationship context for attendees
    supabase
      .from('relationship_graph')
      .select('contact_name, contact_email, relationship_type, importance, last_interaction, typical_topics')
      .eq('user_id', user.id)
      .in('contact_email', attendeeEmails)
      .order('importance', { ascending: false }),

    // Topic-filtered emails from attendees
    titleWords.length > 0
      ? supabase
          .from('emails')
          .select('subject, sender_email, sender_name, received_at, snippet')
          .eq('user_id', user.id)
          .in('sender_email', attendeeEmails)
          .or(titleWords.map((w: string) => `subject.ilike.%${w}%`).join(','))
          .order('received_at', { ascending: false })
          .limit(5)
      : Promise.resolve({ data: [] }),

    // Fallback: recent emails from attendees (no topic filter)
    supabase
      .from('emails')
      .select('subject, sender_email, sender_name, received_at, snippet')
      .eq('user_id', user.id)
      .in('sender_email', attendeeEmails)
      .order('received_at', { ascending: false })
      .limit(5),

    // Relevant KB docs
    supabase
      .from('knowledge_files')
      .select('filename, summary')
      .eq('user_id', user.id)
      .not('summary', 'is', null)
      .order('updated_at', { ascending: false })
      .limit(20),
  ]);

  const allTranscripts = transcriptsResult.data ?? [];

  // Batch-fetch calendar events for all past transcripts (no N+1)
  const transcriptEventIds = allTranscripts
    .map(t => t.calendar_event_id)
    .filter((eid): eid is string => !!eid);

  const { data: pastCalEvents } = transcriptEventIds.length > 0
    ? await supabase
        .from('calendar_events')
        .select('id, attendees')
        .in('id', transcriptEventIds)
    : { data: [] };

  const eventAttendeeMap = new Map(
    (pastCalEvents ?? []).map(e => [
      e.id,
      (e.attendees ?? []).map((a: any) => a.email).filter(Boolean) as string[],
    ])
  );

  // Filter transcripts with attendee overlap — in memory, no extra queries
  const pastMeetings: Array<{ id: string; title: string; date: string; summary: string; decisions: string[] }> = [];
  for (const t of allTranscripts) {
    const pastEmails = eventAttendeeMap.get(t.calendar_event_id ?? '') ?? [];
    if (pastEmails.some(e => attendeeEmails.includes(e))) {
      pastMeetings.push({
        id: t.id,
        title: t.title ?? 'Untitled',
        date: t.start_time,
        summary: t.summary ?? '',
        decisions: ((t.decisions as any[]) ?? []).map(d => typeof d === 'string' ? d : d.text).filter(Boolean),
      });
    }
    if (pastMeetings.length >= 5) break;
  }

  // Open action items from those past meetings
  const pastTranscriptIds = pastMeetings.map(pm => pm.id);
  let openActionItems: Array<{ title: string; fromMeeting: string }> = [];
  if (pastTranscriptIds.length > 0) {
    const { data: items } = await supabase
      .from('inbox_items')
      .select('work_title, status')
      .in('transcript_id', pastTranscriptIds)
      .neq('status', 'done')
      .limit(8);

    openActionItems = (items ?? []).map((item: any) => ({
      title: item.work_title ?? item.title ?? '',
      fromMeeting: pastMeetings.find(pm => pm.id === item.transcript_id)?.title ?? '',
    })).filter(i => i.title);
  }

  // Emails: prefer topic-filtered, fall back to recent
  const topicEmails = (topicEmailsResult as any).data ?? [];
  const fallbackEmails = recentEmailsResult.data ?? [];
  const emailsRaw = topicEmails.length > 0 ? topicEmails : fallbackEmails;
  const recentEmails = emailsRaw.map((e: any) => ({
    subject: e.subject ?? '(no subject)',
    from: e.sender_name ?? e.sender_email,
    date: e.received_at,
    snippet: e.snippet ?? '',
  }));

  // Relationships
  const relationships = (relationshipsResult.data ?? []).map((r: any) => ({
    name: r.contact_name,
    email: r.contact_email,
    type: r.relationship_type,
    lastInteraction: r.last_interaction,
    topics: (r.typical_topics ?? []).slice(0, 3),
  }));

  // KB docs matching title keywords
  const allFiles = kbResult.data ?? [];
  const relevantDocs = allFiles
    .filter((f: any) => {
      const text = `${f.filename} ${f.summary ?? ''}`.toLowerCase();
      return titleWords.some((w: string) => text.includes(w));
    })
    .slice(0, 3)
    .map((f: any) => ({ title: f.filename, snippet: f.summary ?? '' }));

  // AI-generated brief — synthesizes everything into 2-3 actionable sentences
  let aiSummary: string | null = null;
  try {
    const { client, model } = await getAIClient(user.id, 'summarization', supabase);
    const lines: string[] = [
      `Meeting: "${event.title}" on ${new Date(event.start_time).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}`,
    ];
    if (agenda) lines.push(`Agenda: ${agenda}`);
    if (relationships.length > 0) {
      lines.push(`Attendees context: ${relationships.map(r => `${r.name} (${r.type || 'contact'}${r.topics.length ? ', topics: ' + r.topics.join(', ') : ''})`).join('; ')}`);
    }
    if (pastMeetings.length > 0) {
      lines.push(`Previous meetings with these attendees:`);
      pastMeetings.slice(0, 3).forEach(pm => {
        lines.push(`- ${pm.title} (${new Date(pm.date).toLocaleDateString()}): ${pm.summary || 'no summary'}`);
        if (pm.decisions.length > 0) lines.push(`  Decisions: ${pm.decisions.slice(0, 2).join(', ')}`);
      });
    }
    if (openActionItems.length > 0) {
      lines.push(`Still open from past meetings: ${openActionItems.map(i => i.title).slice(0, 3).join(', ')}`);
    }
    if (recentEmails.length > 0) {
      lines.push(`Recent emails from attendees: ${recentEmails.slice(0, 3).map((e: { subject: string; from: string }) => `"${e.subject}" (${e.from})`).join(', ')}`);
    }

    const res = await aiCreate(client, {
      model,
      messages: [
        {
          role: 'system',
          content: 'You write concise meeting prep briefs. Be specific, direct, and actionable. Never start with "Here is" or "Based on". No bullet points — write prose.',
        },
        {
          role: 'user',
          content: `${lines.join('\n')}\n\nWrite a 2-3 sentence meeting brief covering: who these people are, the most relevant context from past interactions, and what to focus on or bring up. Be specific.`,
        },
      ],
      max_tokens: 180,
      temperature: 0.3,
      stream: false as const,
    });
    aiSummary = (res as any).choices?.[0]?.message?.content?.trim() ?? null;
  } catch {
    // AI brief is best-effort — return data without it if it fails
  }

  return NextResponse.json({ pastMeetings, openActionItems, recentEmails, relevantDocs, relationships, agenda, aiSummary });
}
