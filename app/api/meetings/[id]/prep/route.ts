import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getAIClient, aiCreate } from '@/lib/ai/factory';

const GENERIC_DOMAINS = new Set(['gmail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'icloud.com', 'me.com', 'live.com']);

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [eventResult, profileResult, connectionsResult] = await Promise.all([
    supabase
      .from('calendar_events')
      .select('id, title, attendees, start_time')
      .eq('id', id)
      .eq('user_id', user.id)
      .single(),
    supabase
      .from('context_profiles')
      .select('data')
      .eq('user_id', user.id)
      .eq('type', 'identity')
      .maybeSingle(),
    // All connected inbox emails — used to exclude the user's own addresses from attendees
    supabase
      .from('connections')
      .select('provider_account_id, metadata')
      .eq('user_id', user.id),
  ]);

  const event = eventResult.data;
  if (!event) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // All email addresses that belong to the user (auth + every connected inbox)
  const userEmails = new Set<string>([
    (user.email ?? '').toLowerCase(),
    ...((connectionsResult.data ?? []).map((c: any) => {
      const email = c.metadata?.email || c.provider_account_id || '';
      return email.toLowerCase();
    })),
  ].filter(Boolean));

  const otherAttendees = ((event.attendees ?? []) as any[]).filter(
    (a: any) => a.email && !userEmails.has(a.email.toLowerCase())
  );
  const attendeeEmails = otherAttendees.map((a: any) => a.email as string);

  if (attendeeEmails.length === 0) {
    return NextResponse.json({ pastMeetings: [], openActionItems: [], recentEmails: [], relevantDocs: [], relationships: [], aiSummary: null });
  }

  // Company domains represented by the attendees (non-generic)
  const attendeeDomains = [...new Set(
    attendeeEmails.map(e => e.split('@')[1]).filter(d => d && !GENERIC_DOMAINS.has(d))
  )];

  const titleWords = event.title.toLowerCase().split(/\s+/).filter((w: string) => w.length > 3);

  const [
    transcriptsResult,
    relationshipsResult,
    emailsFromResult,
    emailsToResult,
    kbResult,
  ] = await Promise.all([
    supabase
      .from('meeting_transcripts')
      .select('id, title, start_time, summary, decisions, calendar_event_id')
      .eq('user_id', user.id)
      .eq('processed', true)
      .neq('calendar_event_id', id)
      .order('start_time', { ascending: false })
      .limit(60),

    supabase
      .from('relationship_graph')
      .select('contact_name, contact_email, relationship_type, importance, last_interaction, typical_topics')
      .eq('user_id', user.id)
      .in('contact_email', attendeeEmails)
      .order('importance', { ascending: false }),

    // Emails FROM attendees (across all connected inboxes)
    supabase
      .from('emails')
      .select('id, subject, from_address, from_name, received_at, snippet, body, thread_id')
      .eq('user_id', user.id)
      .in('from_address', attendeeEmails)
      .order('received_at', { ascending: false })
      .limit(10),

    // Emails the user sent TO these attendees (any inbox)
    supabase
      .from('emails')
      .select('id, subject, from_address, from_name, received_at, snippet, body, thread_id')
      .eq('user_id', user.id)
      .eq('is_from_user', true)
      .or(attendeeEmails.map(e => `to_addresses.cs.{"${e}"}`).join(','))
      .order('received_at', { ascending: false })
      .limit(10),

    supabase
      .from('knowledge_files')
      .select('filename, summary')
      .eq('user_id', user.id)
      .not('summary', 'is', null)
      .order('updated_at', { ascending: false })
      .limit(20),
  ]);

  const allTranscripts = transcriptsResult.data ?? [];

  const transcriptEventIds = allTranscripts
    .map(t => t.calendar_event_id)
    .filter((eid): eid is string => !!eid);

  const { data: pastCalEvents } = transcriptEventIds.length > 0
    ? await supabase.from('calendar_events').select('id, attendees').in('id', transcriptEventIds)
    : { data: [] };

  const eventAttendeeMap = new Map(
    (pastCalEvents ?? []).map(e => [
      e.id,
      (e.attendees ?? []).map((a: any) => a.email).filter(Boolean) as string[],
    ])
  );

  // Match past meetings: require attendee overlap AND at least one shared company domain
  const pastMeetings: Array<{ id: string; title: string; date: string; summary: string; decisions: string[] }> = [];
  for (const t of allTranscripts) {
    const pastEmails = eventAttendeeMap.get(t.calendar_event_id ?? '') ?? [];
    const sharedAttendees = pastEmails.filter(e => attendeeEmails.includes(e));
    const minRequired = attendeeEmails.length <= 2 ? 1 : 2;
    if (sharedAttendees.length < minRequired) continue;

    // Require ALL company domains from today's meeting to be present in the past meeting.
    // This prevents meetings about a different client (missing one of today's companies) from leaking in.
    const pastDomains = new Set(pastEmails.map(e => e.split('@')[1]).filter(d => d && !GENERIC_DOMAINS.has(d)));
    const allDomainsPresent = attendeeDomains.every(d => pastDomains.has(d));
    if (attendeeDomains.length > 0 && !allDomainsPresent) continue;

    pastMeetings.push({
      id: t.id,
      title: t.title ?? 'Untitled',
      date: t.start_time,
      summary: t.summary ?? '',
      decisions: ((t.decisions as any[]) ?? []).map(d => typeof d === 'string' ? d : d.text).filter(Boolean),
    });
    if (pastMeetings.length >= 5) break;
  }

  const pastTranscriptIds = pastMeetings.map(pm => pm.id);
  let openActionItems: Array<{ title: string; fromMeeting: string }> = [];
  if (pastTranscriptIds.length > 0) {
    const { data: items } = await supabase
      .from('inbox_items')
      .select('work_title, transcript_id, status')
      .in('transcript_id', pastTranscriptIds)
      .neq('status', 'done')
      .limit(8);

    openActionItems = (items ?? []).map((item: any) => ({
      title: item.work_title ?? item.title ?? '',
      fromMeeting: pastMeetings.find(pm => pm.id === item.transcript_id)?.title ?? '',
    })).filter(i => i.title);
  }

  // Merge emails from all inboxes, deduplicate by id, sort by date
  const allEmailsRaw = [
    ...((emailsFromResult as any).data ?? []),
    ...((emailsToResult as any).data ?? []),
  ];
  const seen = new Set<string>();
  const recentEmails = allEmailsRaw
    .filter(e => { if (seen.has(e.id)) return false; seen.add(e.id); return true; })
    .sort((a, b) => new Date(b.received_at).getTime() - new Date(a.received_at).getTime())
    .slice(0, 8)
    .map((e: any) => ({
      subject: e.subject ?? '(no subject)',
      from: e.from_name ?? e.from_address,
      date: e.received_at,
      snippet: e.snippet || (e.body ? e.body.replace(/<[^>]+>/g, '').slice(0, 200) : ''),
    }));

  const relationships = (relationshipsResult.data ?? []).map((r: any) => ({
    name: r.contact_name,
    email: r.contact_email,
    type: r.relationship_type,
    lastInteraction: r.last_interaction,
    topics: (r.typical_topics ?? []).slice(0, 3),
  }));

  const allFiles = kbResult.data ?? [];
  const relevantDocs = allFiles
    .filter((f: any) => {
      const text = `${f.filename} ${f.summary ?? ''}`.toLowerCase();
      return titleWords.some((w: string) => text.includes(w));
    })
    .slice(0, 3)
    .map((f: any) => ({ title: f.filename, snippet: f.summary ?? '' }));

  // AI brief
  let aiSummary: string | null = null;
  if (relationships.length > 0 || pastMeetings.length > 0 || recentEmails.length > 0) {
    try {
      const { client, model } = await getAIClient(user.id, 'generation', supabase);

      const userIdentity = (profileResult.data?.data as any) ?? null;

      const lines: string[] = [];

      if (userIdentity?.name || userIdentity?.role) {
        lines.push(`You: ${[userIdentity.name, userIdentity.role, userIdentity.company].filter(Boolean).join(', ')}`);
      }

      lines.push(`Upcoming meeting: "${event.title}" — ${new Date(event.start_time).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}`);

      const attendeeList = otherAttendees.map((a: any) => {
        const rel = relationships.find(r => r.email === a.email);
        return `${a.name ?? a.email}${rel?.type ? ` (${rel.type})` : ''}`;
      });
      if (attendeeList.length > 0) lines.push(`Attendees: ${attendeeList.join(', ')}`);

      if (pastMeetings.length > 0) {
        lines.push(`Past meetings with this group:`);
        pastMeetings.slice(0, 3).forEach(pm => {
          lines.push(`- ${pm.title} (${new Date(pm.date).toLocaleDateString()}): ${pm.summary || 'no summary'}`);
          if (pm.decisions.length > 0) lines.push(`  Decisions: ${pm.decisions.slice(0, 2).join(', ')}`);
        });
      }
      if (openActionItems.length > 0) {
        lines.push(`Still open: ${openActionItems.map(i => i.title).slice(0, 3).join(', ')}`);
      }

      if (recentEmails.length > 0) {
        lines.push(`Recent emails:`);
        recentEmails.slice(0, 4).forEach((e: { subject: string; from: string; snippet: string }) => {
          lines.push(`- "${e.subject}" from ${e.from}: ${e.snippet}`);
        });
      }

      const res = await aiCreate(client, {
        model,
        messages: [
          {
            role: 'system',
            content: 'You write first-person meeting prep briefs for the user listed as "You". Be specific and direct. No bullet points — 2-3 sentences of prose. Never start with "Here is" or "Based on". Only use what is explicitly listed.',
          },
          {
            role: 'user',
            content: `${lines.join('\n')}\n\nWrite a 2-3 sentence brief: who you're meeting and what context matters going in.`,
          },
        ],
        max_tokens: 180,
        temperature: 0.2,
        stream: false as const,
      });
      aiSummary = (res as any).choices?.[0]?.message?.content?.trim() ?? null;
    } catch {
      // best-effort
    }
  }

  return NextResponse.json({ pastMeetings, openActionItems, recentEmails, relevantDocs, relationships, aiSummary });
}
