/**
 * Attendee Bot Manager
 *
 * Handles bot creation for calendar events and transcript retrieval.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { createAttendeeBot, getAttendeeBot, getAttendeeBotTranscript, isSupportedMeetingUrl } from './client';

/**
 * Create Attendee bots for calendar events with meeting links
 * Called after calendar sync completes
 */
export async function createBotsForCalendarEvents(
  userId: string,
  supabase: SupabaseClient
): Promise<{ created: number; errors: string[] }> {
  // Check if user has Attendee enabled
  const { data: profile } = await supabase
    .from('profiles')
    .select('attendee_enabled')
    .eq('id', userId)
    .single();

  if (!profile?.attendee_enabled) {
    return { created: 0, errors: [] };
  }

  // Find upcoming events (next 2 weeks) with meeting links but no bot created yet
  const now = new Date();
  const twoWeeksFromNow = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

  const { data: events } = await supabase
    .from('calendar_events')
    .select('id, title, meeting_link, start_time')
    .eq('user_id', userId)
    .gte('start_time', now.toISOString())
    .lte('start_time', twoWeeksFromNow.toISOString())
    .is('attendee_bot_id', null)
    .not('meeting_link', 'is', null)
    .order('start_time', { ascending: true })
    .limit(50);

  if (!events || events.length === 0) {
    return { created: 0, errors: [] };
  }

  console.log(`[AttendeeBot] Found ${events.length} events to create bots for (user: ${userId})`);

  let created = 0;
  const errors: string[] = [];

  for (const event of events) {
    try {
      // Verify meeting link is supported
      if (!isSupportedMeetingUrl(event.meeting_link)) {
        continue;
      }

      console.log(`[AttendeeBot] Creating bot for: ${event.title}`);

      // Create bot
      const bot = await createAttendeeBot(event.meeting_link, 'AUGMTD Assistant');

      // Update event with bot info
      const { error } = await supabase
        .from('calendar_events')
        .update({
          attendee_bot_id: bot.id,
          attendee_bot_state: bot.state,
          attendee_bot_created_at: new Date().toISOString(),
        })
        .eq('id', event.id);

      if (error) {
        errors.push(`Failed to save bot for event ${event.id}: ${error.message}`);
      } else {
        created++;
        console.log(`[AttendeeBot] Created bot ${bot.id} for event: ${event.title}`);
      }
    } catch (error: any) {
      console.error(`[AttendeeBot] Error creating bot for event ${event.id}:`, error);
      errors.push(`Event ${event.title}: ${error.message}`);
    }
  }

  return { created, errors };
}

/**
 * Poll bot status and fetch completed transcripts
 * Should be run periodically (e.g., every 5 minutes)
 */
export async function pollAndFetchTranscripts(
  supabase: SupabaseClient
): Promise<{ processed: number; errors: string[] }> {
  // Find events with active bots that haven't been processed yet
  const { data: events } = await supabase
    .from('calendar_events')
    .select('id, user_id, title, attendee_bot_id, attendee_bot_state, start_time, end_time')
    .not('attendee_bot_id', 'is', null)
    .in('attendee_bot_state', ['joining', 'active', 'ended'])
    .order('start_time', { ascending: false })
    .limit(100);

  if (!events || events.length === 0) {
    return { processed: 0, errors: [] };
  }

  console.log(`[AttendeeBot] Polling ${events.length} active bots`);

  let processed = 0;
  const errors: string[] = [];

  for (const event of events) {
    try {
      // Fetch bot status
      const bot = await getAttendeeBot(event.attendee_bot_id);

      // Update bot state
      await supabase
        .from('calendar_events')
        .update({ attendee_bot_state: bot.state })
        .eq('id', event.id);

      // If bot ended and transcription completed, fetch transcript
      if (bot.state === 'ended' && bot.transcription_state === 'completed') {
        console.log(`[AttendeeBot] Fetching transcript for: ${event.title}`);

        const transcript = await getAttendeeBotTranscript(event.attendee_bot_id);

        // Store transcript
        await storeTranscriptAndGenerateWork(
          event.user_id,
          event.id,
          event.attendee_bot_id,
          event.title,
          event.start_time,
          event.end_time,
          transcript,
          supabase
        );

        processed++;
      }
    } catch (error: any) {
      console.error(`[AttendeeBot] Error polling bot ${event.attendee_bot_id}:`, error);
      errors.push(`Event ${event.title}: ${error.message}`);

      // Mark bot as failed if error persists
      if (error.message.includes('404') || error.message.includes('not found')) {
        await supabase
          .from('calendar_events')
          .update({ attendee_bot_state: 'failed' })
          .eq('id', event.id);
      }
    }
  }

  return { processed, errors };
}

/**
 * Store transcript and generate work items
 */
async function storeTranscriptAndGenerateWork(
  userId: string,
  calendarEventId: string,
  botId: string,
  title: string,
  startTime: string,
  endTime: string,
  transcript: any,
  supabase: SupabaseClient
): Promise<void> {
  // Calculate duration
  const durationMinutes = Math.round(
    (new Date(endTime).getTime() - new Date(startTime).getTime()) / (1000 * 60)
  );

  // Store transcript
  const { data: transcriptRecord, error: insertError } = await supabase
    .from('meeting_transcripts')
    .insert({
      user_id: userId,
      calendar_event_id: calendarEventId,
      attendee_bot_id: botId,
      bot_state: 'ended',
      title,
      start_time: startTime,
      end_time: endTime,
      duration_minutes: durationMinutes,
      transcript_segments: transcript.segments || [],
      attendees: [],
      processed: false,
    })
    .select()
    .single();

  if (insertError) {
    console.error('[AttendeeBot] Failed to store transcript:', insertError);
    return;
  }

  console.log(`[AttendeeBot] Stored transcript ${transcriptRecord.id}`);

  // Extract action items and key topics from transcript
  const actionItems = extractActionItems(transcript.segments);
  const keyTopics = extractKeyTopics(transcript.segments);

  let workItemsCreated = 0;

  // Create work items from action items
  for (const actionItem of actionItems) {
    const workTitle = `Follow up: ${actionItem}`;
    const whyMatters = `Action item from meeting: ${title}`;

    const { error } = await supabase
      .from('inbox_items')
      .insert({
        user_id: userId,
        source: 'meeting',
        source_id: botId,
        source_meeting_transcript_id: transcriptRecord.id,
        work_state: 'action_required',
        work_title: workTitle,
        why_matters: whyMatters,
        source_data: {
          meeting_title: title,
          meeting_start: startTime,
          action_item: actionItem,
          key_topics: keyTopics,
          auto_generated: true,
        },
        auto_generated: true,
        priority: 70, // Higher priority - from meeting
        status: 'pending',
      });

    if (!error) {
      workItemsCreated++;
      console.log(`[AttendeeBot] Created work item: ${workTitle}`);
    }
  }

  // Mark transcript as processed
  await supabase
    .from('meeting_transcripts')
    .update({
      processed: true,
      work_items_generated: workItemsCreated,
    })
    .eq('id', transcriptRecord.id);

  console.log(`[AttendeeBot] Generated ${workItemsCreated} work items from: ${title}`);
}

/**
 * Extract action items from transcript segments
 * Simple keyword-based extraction (can be enhanced with AI later)
 */
function extractActionItems(segments: any[]): string[] {
  const actionItems: string[] = [];
  const actionKeywords = [
    'will do',
    'i\'ll',
    'let me',
    'action item',
    'todo',
    'need to',
    'should',
    'follow up',
    'next step',
  ];

  for (const segment of segments) {
    const text = segment.text.toLowerCase();

    // Check if segment contains action keywords
    const hasActionKeyword = actionKeywords.some(keyword => text.includes(keyword));

    if (hasActionKeyword && segment.text.length > 20) {
      actionItems.push(segment.text.trim());
    }
  }

  // Limit to 10 most relevant action items
  return actionItems.slice(0, 10);
}

/**
 * Extract key topics from transcript
 * Groups segments by speaker and finds frequently mentioned terms
 */
function extractKeyTopics(segments: any[]): string[] {
  // Simple implementation - can be enhanced with NLP
  const text = segments.map(s => s.text).join(' ');
  const words = text.toLowerCase().split(/\s+/);

  // Count word frequency (filter common words)
  const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'is', 'was', 'are', 'were', 'we', 'i', 'you', 'it', 'this', 'that', 'so', 'just', 'like']);
  const wordCount = new Map<string, number>();

  for (const word of words) {
    if (word.length > 3 && !stopWords.has(word)) {
      wordCount.set(word, (wordCount.get(word) || 0) + 1);
    }
  }

  // Get top 5 words
  return Array.from(wordCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([word]) => word);
}
