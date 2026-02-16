/**
 * Meeting Processor
 *
 * Analyzes calendar events and creates meeting prep inbox items.
 * Uses email history and relationships to generate context-aware prep.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

interface CalendarEvent {
  id: string;
  user_id: string;
  title: string;
  description?: string;
  start_time: string;
  end_time: string;
  attendees: Array<{
    email: string;
    name?: string;
    status?: string;
  }>;
  organizer?: string;
  meeting_link?: string;
  location?: string;
  provider: string;
}

interface MeetingContext {
  event: CalendarEvent;
  isOrganizer: boolean;
  userEmail: string;
  attendeeRelationships: Array<{
    email: string;
    name?: string;
    importance: number;
    lastInteraction?: string;
    recentTopics: string[];
  }>;
  recentEmailThreads: Array<{
    subject: string;
    lastMessage: string;
    participants: string[];
    date: string;
  }>;
  hoursUntilMeeting: number;
}

/**
 * Process calendar events and create meeting prep inbox items
 */
export async function processMeetingsForUser(
  userId: string,
  supabase: SupabaseClient
): Promise<{ processed: number; created: number }> {
  console.log(`[MeetingProcessor] Processing meetings for user ${userId}`);

  // Get user's email for organizer detection
  const { data: profile } = await supabase
    .from('profiles')
    .select('email')
    .eq('id', userId)
    .single();

  if (!profile?.email) {
    console.error('[MeetingProcessor] User email not found');
    return { processed: 0, created: 0 };
  }

  const userEmail = profile.email;

  // Get upcoming meetings (next 48 hours)
  const now = new Date();
  const next48Hours = new Date(now.getTime() + 48 * 60 * 60 * 1000);

  const { data: upcomingEvents, error } = await supabase
    .from('calendar_events')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'confirmed')
    .gte('start_time', now.toISOString())
    .lte('start_time', next48Hours.toISOString())
    .order('start_time', { ascending: true });

  if (error) {
    console.error('[MeetingProcessor] Error fetching events:', error);
    return { processed: 0, created: 0 };
  }

  if (!upcomingEvents || upcomingEvents.length === 0) {
    console.log('[MeetingProcessor] No upcoming meetings in next 48 hours');
    return { processed: 0, created: 0 };
  }

  console.log(`[MeetingProcessor] Found ${upcomingEvents.length} upcoming meetings`);

  let processed = 0;
  let created = 0;

  for (const event of upcomingEvents) {
    try {
      // Check if we've already generated prep for this meeting
      const hasPrepAlready = event.metadata?.prep !== undefined;

      if (hasPrepAlready) {
        console.log(`[MeetingProcessor] Prep already exists for event ${event.id}`);
        processed++;
        continue;
      }

      // Build meeting context
      const context = await buildMeetingContext(event, userEmail, supabase);

      // Generate meeting prep
      const prep = await generateMeetingPrep(context);

      // Store prep in calendar_event metadata (not in inbox_items)
      // Meetings now live in sidebar, prep shown in detail panel
      const { error: updateError } = await supabase
        .from('calendar_events')
        .update({
          metadata: {
            ...event.metadata,
            prep: {
              title: prep.title,
              agenda: prep.agenda,
              context: prep.context,
            },
            context: {
              attendeeRelationships: context.attendeeRelationships,
              recentEmailThreads: context.recentEmailThreads,
              hoursUntilMeeting: context.hoursUntilMeeting,
              isOrganizer: context.isOrganizer,
            },
          },
        })
        .eq('id', event.id);

      if (updateError) {
        console.error(`[MeetingProcessor] Error storing prep for ${event.id}:`, updateError);
      } else {
        console.log(`[MeetingProcessor] Stored prep for: ${prep.title}`);
        created++;
      }

      processed++;
    } catch (error) {
      console.error(`[MeetingProcessor] Error processing event ${event.id}:`, error);
      processed++;
    }
  }

  return { processed, created };
}

/**
 * Build context for a meeting
 */
async function buildMeetingContext(
  event: CalendarEvent,
  userEmail: string,
  supabase: SupabaseClient
): Promise<MeetingContext> {
  const isOrganizer = event.organizer?.toLowerCase() === userEmail.toLowerCase();
  const attendeeEmails = event.attendees?.map(a => a.email) || [];

  // Get relationships for attendees
  const { data: relationships } = await supabase
    .from('relationship_graph')
    .select('*')
    .eq('user_id', event.user_id)
    .in('contact_email', attendeeEmails);

  const attendeeRelationships = attendeeEmails.map(email => {
    const rel = relationships?.find(r => r.contact_email === email);
    return {
      email,
      name: rel?.contact_name || event.attendees?.find(a => a.email === email)?.name,
      importance: rel?.importance || 50,
      lastInteraction: rel?.last_interaction,
      recentTopics: rel?.typical_topics || [],
    };
  });

  // Get recent email threads with these attendees (last 30 days)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data: recentEmails } = await supabase
    .from('emails')
    .select('subject, body, from_address, to_addresses, received_at')
    .eq('user_id', event.user_id)
    .gte('received_at', thirtyDaysAgo)
    .or(attendeeEmails.map(email => `from_address.eq.${email},to_addresses.cs.{${email}}`).join(','))
    .order('received_at', { ascending: false })
    .limit(10);

  const recentEmailThreads = (recentEmails || []).map(email => ({
    subject: email.subject || '(no subject)',
    lastMessage: email.body?.substring(0, 200) || '',
    participants: [email.from_address, ...(email.to_addresses || [])],
    date: email.received_at,
  }));

  // Calculate hours until meeting
  const hoursUntilMeeting = (new Date(event.start_time).getTime() - Date.now()) / (1000 * 60 * 60);

  return {
    event,
    isOrganizer,
    userEmail,
    attendeeRelationships,
    recentEmailThreads,
    hoursUntilMeeting,
  };
}

/**
 * Generate meeting prep using AI
 */
async function generateMeetingPrep(context: MeetingContext): Promise<{
  title: string;
  agenda: string;
  context: string;
}> {
  const { event, isOrganizer, attendeeRelationships, recentEmailThreads, hoursUntilMeeting } = context;

  // Build context summary
  const vipAttendees = attendeeRelationships.filter(a => a.importance > 80);
  const recentTopics = attendeeRelationships
    .flatMap(a => a.recentTopics)
    .filter((topic, index, self) => self.indexOf(topic) === index)
    .slice(0, 5);

  const prompt = `You are preparing someone for an upcoming meeting. Be concise and actionable.

MEETING DETAILS:
Title: ${event.title}
When: ${new Date(event.start_time).toLocaleString()} (in ${Math.round(hoursUntilMeeting)} hours)
Duration: ${calculateDuration(event.start_time, event.end_time)} minutes
${event.meeting_link ? `Link: ${event.meeting_link}` : ''}
${event.location ? `Location: ${event.location}` : ''}

ATTENDEES (${attendeeRelationships.length}):
${attendeeRelationships.slice(0, 5).map(a =>
  `- ${a.name || a.email}${a.importance > 80 ? ' (VIP)' : ''}`
).join('\n')}

${vipAttendees.length > 0 ? `\nVIP ATTENDEES: ${vipAttendees.map(a => a.name || a.email).join(', ')}` : ''}

${recentTopics.length > 0 ? `\nRECENT TOPICS WITH ATTENDEES:\n${recentTopics.map(t => `- ${t}`).join('\n')}` : ''}

${recentEmailThreads.length > 0 ? `\nRECENT EMAIL THREADS:\n${recentEmailThreads.slice(0, 3).map(t =>
  `- ${t.subject} (${new Date(t.date).toLocaleDateString()})`
).join('\n')}` : ''}

${event.description ? `\nMEETING DESCRIPTION:\n${event.description.substring(0, 500)}` : ''}

Generate a brief meeting prep with:
1. AGENDA: 2-3 bullet points of likely topics based on context
2. CONTEXT: 1-2 sentences on why this meeting matters (relationships, recent topics, etc.)

Keep it concise and actionable. Use bullet points.`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are a meeting prep assistant. Be concise, bullet-pointed, and focus on actionable insights.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.7,
      max_tokens: 300,
    });

    const prepText = response.choices[0].message.content || '';

    // Parse the response
    const agendaMatch = prepText.match(/AGENDA:?\s*([\s\S]*?)(?=CONTEXT:|$)/i);
    const contextMatch = prepText.match(/CONTEXT:?\s*([\s\S]*?)$/i);

    const agenda = agendaMatch?.[1]?.trim() || prepText.trim();
    const contextText = contextMatch?.[1]?.trim() ||
      `Meeting with ${attendeeRelationships.length} attendee${attendeeRelationships.length > 1 ? 's' : ''}` +
      (vipAttendees.length > 0 ? `, including VIP contacts` : '');

    // Generate title
    const timeStr = hoursUntilMeeting < 24
      ? hoursUntilMeeting < 2 ? 'soon' : 'today'
      : 'tomorrow';

    const title = `Prep: ${event.title} (${timeStr})`;

    return {
      title,
      agenda,
      context: contextText,
    };
  } catch (error) {
    console.error('[MeetingProcessor] AI generation error:', error);

    // Fallback prep
    return {
      title: `Prep: ${event.title}`,
      agenda: `• Review meeting details\n• Prepare talking points\n• Review recent interactions with attendees`,
      context: `Meeting with ${attendeeRelationships.length} attendees in ${Math.round(hoursUntilMeeting)} hours`,
    };
  }
}

/**
 * Calculate meeting priority based on context
 */
function calculateMeetingPriority(context: MeetingContext): number {
  let priority = 50; // Base priority

  // Time urgency
  if (context.hoursUntilMeeting < 2) priority += 30;
  else if (context.hoursUntilMeeting < 6) priority += 20;
  else if (context.hoursUntilMeeting < 24) priority += 10;

  // VIP attendees
  const vipCount = context.attendeeRelationships.filter(a => a.importance > 80).length;
  priority += vipCount * 10;

  // User is organizer
  if (context.isOrganizer) priority += 10;

  // Large meeting
  if (context.attendeeRelationships.length > 5) priority += 5;

  return Math.min(100, priority);
}

/**
 * Calculate meeting duration in minutes
 */
function calculateDuration(startTime: string, endTime: string): number {
  const start = new Date(startTime).getTime();
  const end = new Date(endTime).getTime();
  return Math.round((end - start) / (1000 * 60));
}
