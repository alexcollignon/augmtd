/**
 * Attendee Bot Manager
 *
 * Handles bot creation for calendar events and transcript retrieval.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { createAttendeeBot, getAttendeeBot, getAttendeeBotTranscript, isSupportedMeetingUrl } from './client';
import { getAIClient } from '@/lib/ai/factory';

interface ExtractedActionItem {
  action: string;
  assignee?: string;
  priority: number; // 1-100
  context?: string;
  dueDate?: string;
  category: 'todo' | 'waiting_for' | 'project';
}

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

      // Create scheduled bot (joins at meeting start time)
      // Attendee requires join_at to be at least 2 minutes in the future
      const meetingStart = new Date(event.start_time);
      const now = new Date();
      const minJoinTime = new Date(now.getTime() + 2 * 60 * 1000); // 2 minutes from now

      // Use the later of meeting start or minimum join time
      const joinAt = meetingStart > minJoinTime ? meetingStart : minJoinTime;

      const bot = await createAttendeeBot(
        event.meeting_link,
        'AUGMTD Assistant',
        joinAt.toISOString()  // Schedule bot to join at meeting start
      );

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
        console.log(`[AttendeeBot] Created scheduled bot ${bot.id} for event: ${event.title} (joins at ${joinAt.toISOString()})`);
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
 *
 * Bot lifecycle: scheduled → joining → joined_recording/active → ended → transcript fetched
 */
export async function pollAndFetchTranscripts(
  supabase: SupabaseClient
): Promise<{ processed: number; errors: string[] }> {
  // Find events with active bots that haven't been processed yet
  const { data: events } = await supabase
    .from('calendar_events')
    .select('id, user_id, title, attendee_bot_id, attendee_bot_state, start_time, end_time')
    .not('attendee_bot_id', 'is', null)
    .in('attendee_bot_state', ['scheduled', 'joining', 'joined_recording', 'active', 'ended'])
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
      // Note: API returns 'complete' not 'completed'
      if (bot.state === 'ended' && bot.transcription_state === 'complete') {
        // Check if transcript already exists (prevent duplicates)
        const { data: existingTranscript } = await supabase
          .from('meeting_transcripts')
          .select('id')
          .eq('attendee_bot_id', event.attendee_bot_id)
          .single();

        if (existingTranscript) {
          console.log(`[AttendeeBot] Transcript already exists for: ${event.title}`);
          continue; // Skip - already processed
        }

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

  // Normalize transcript structure (Attendee API returns array directly)
  const rawSegments = Array.isArray(transcript) ? transcript : [];

  // Format transcript as plain text for storage
  const transcriptText = rawSegments
    .map((s: any) => `[${s.speaker_name || 'Unknown'}]: ${s.transcription?.transcript || ''}`)
    .join('\n');

  // Normalize segments to our expected format {speaker, text, timestamp}
  const normalizedSegments = rawSegments.map((s: any) => ({
    speaker: s.speaker_name || 'Unknown',
    text: s.transcription?.transcript || '',
    timestamp: Math.floor((s.timestamp_ms || 0) / 1000), // Convert ms to seconds
  }));

  // Store transcript
  const { data: transcriptRecord, error: insertError} = await supabase
    .from('meeting_transcripts')
    .insert({
      user_id: userId,
      meeting_id: calendarEventId, // meeting_id is required (same as calendar_event_id)
      calendar_event_id: calendarEventId,
      attendee_bot_id: botId,
      bot_state: 'ended',
      title,
      start_time: startTime,
      end_time: endTime,
      duration_minutes: durationMinutes,
      transcript: transcriptText, // Plain text transcript (required)
      transcript_segments: normalizedSegments, // Normalized format
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

  // Extract action items and key topics from transcript with AI
  const actionItems = await extractActionItemsWithAI(userId, title, normalizedSegments, supabase);
  const keyTopics = extractKeyTopics(normalizedSegments);

  let workItemsCreated = 0;

  // Create work items from action items
  for (const item of actionItems) {
    const workTitle = item.action;
    const whyMatters = item.context
      ? `${item.context} (from meeting: ${title})`
      : `Action item from meeting: ${title}`;

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
          action_item: item.action,
          assignee: item.assignee,
          due_date: item.dueDate,
          key_topics: keyTopics,
          category: item.category || 'todo',
          auto_generated: true,
        },
        auto_generated: true,
        priority: item.priority,
        status: 'pending',
        visual_section: 'suggested',
      });

    if (!error) {
      workItemsCreated++;
      console.log(`[AttendeeBot] Created work item: ${workTitle} (priority: ${item.priority})`);
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
 * Reprocess existing transcripts that never generated work items (e.g. due to missing columns).
 * Safe to call multiple times — only processes transcripts with work_items_generated = 0.
 */
export async function reprocessTranscripts(
  userId: string,
  supabase: SupabaseClient
): Promise<{ reprocessed: number; created: number; errors: string[] }> {
  const { data: transcripts } = await supabase
    .from('meeting_transcripts')
    .select('*')
    .eq('user_id', userId)
    .eq('work_items_generated', 0)
    .order('created_at', { ascending: false })
    .limit(50);

  if (!transcripts || transcripts.length === 0) {
    return { reprocessed: 0, created: 0, errors: [] };
  }

  console.log(`[AttendeeBot] Reprocessing ${transcripts.length} transcripts for user ${userId}`);

  let reprocessed = 0;
  let created = 0;
  const errors: string[] = [];

  for (const transcript of transcripts) {
    try {
      const segments = transcript.transcript_segments || [];
      if (segments.length === 0) continue;

      const actionItems = await extractActionItemsWithAI(userId, transcript.title, segments, supabase);
      const keyTopics = extractKeyTopics(segments);

      let workItemsCreated = 0;

      for (const item of actionItems) {
        const { error } = await supabase
          .from('inbox_items')
          .insert({
            user_id: userId,
            source: 'meeting',
            source_id: transcript.attendee_bot_id,
            source_meeting_transcript_id: transcript.id,
            work_state: 'action_required',
            work_title: item.action,
            why_matters: item.context
              ? `${item.context} (from meeting: ${transcript.title})`
              : `Action item from meeting: ${transcript.title}`,
            source_data: {
              meeting_title: transcript.title,
              meeting_start: transcript.start_time,
              action_item: item.action,
              assignee: item.assignee || null,
              due_date: item.dueDate || null,
              key_topics: keyTopics,
              category: item.category || 'todo',
              auto_generated: true,
            },
            auto_generated: true,
            priority: item.priority,
            status: 'pending',
            visual_section: 'suggested',
          });

        if (!error) {
          workItemsCreated++;
          created++;
        } else {
          console.error('[AttendeeBot] Reprocess insert error:', error);
        }
      }

      await supabase
        .from('meeting_transcripts')
        .update({ work_items_generated: workItemsCreated, processed: true })
        .eq('id', transcript.id);

      reprocessed++;
    } catch (error: any) {
      console.error(`[AttendeeBot] Reprocess error for transcript ${transcript.id}:`, error);
      errors.push(`${transcript.title}: ${error.message}`);
    }
  }

  return { reprocessed, created, errors };
}

/**
 * Extract action items from transcript using GPT-4o mini with user context
 */
async function extractActionItemsWithAI(
  userId: string,
  meetingTitle: string,
  segments: any[],
  supabase: SupabaseClient
): Promise<ExtractedActionItem[]> {
  try {
    const { client: openai, model: defaultModel } = await getAIClient(userId, 'summarization', supabase);

    // Load user profiles for context
    const { data: profiles } = await supabase
      .from('profiles')
      .select('profile_type, data, confidence_score')
      .eq('user_id', userId)
      .in('profile_type', ['identity', 'meeting_behavior', 'communication_patterns']);

    // Build context from profiles
    const identity = profiles?.find(p => p.profile_type === 'identity')?.data;
    const meetingBehavior = profiles?.find(p => p.profile_type === 'meeting_behavior')?.data;

    // Format transcript for AI
    const transcriptText = segments
      .map(s => `[${s.speaker}]: ${s.text}`)
      .join('\n');

    // Build context prompt
    let contextPrompt = '';
    if (identity) {
      contextPrompt += `User context:
- Role: ${identity.role || 'Unknown'}
- Title: ${identity.title || 'Unknown'}
- Authority: ${identity.authority || 'Unknown'}
- Responsibilities: ${identity.responsibilities?.join(', ') || 'Unknown'}

`;
    }

    if (meetingBehavior) {
      contextPrompt += `Meeting patterns:
- Typical meetings: ${meetingBehavior.commonMeetingTypes?.join(', ') || 'Various'}
- Meeting frequency: ${meetingBehavior.averageMeetingsPerWeek || 'Unknown'} per week

`;
    }

    const prompt = `${contextPrompt}Meeting: "${meetingTitle}"

Transcript:
${transcriptText}

Extract concrete action items from this meeting transcript. For each action item:
1. Identify what needs to be done (clear, actionable)
2. Determine who should do it (if mentioned or implied from context)
3. Estimate priority (1-100) based on urgency and user's role
4. Note any due dates mentioned
5. Provide brief context explaining why this matters

Return ONLY a JSON array of action items in this exact format:
[
  {
    "action": "Brief description of what needs to be done",
    "assignee": "Name or null if unclear",
    "priority": 75,
    "context": "Brief explanation of why this matters",
    "dueDate": "YYYY-MM-DD or null",
    "category": "todo"
  }
]

Category must be one of:
- "todo" — a specific task the user needs to do
- "waiting_for" — something the user is waiting on from someone else
- "project" — a larger initiative or ongoing effort to track

Rules:
- Only extract items that require action (not discussions or updates)
- Focus on items relevant to the user based on their role
- Maximum 10 action items
- Higher priority (70-100) for urgent or role-critical items
- Medium priority (40-69) for important but not urgent
- Lower priority (1-39) for nice-to-have or delegatable items
- If no clear action items, return empty array []

Return ONLY the JSON array, no other text.`;

    const completion = await openai.chat.completions.create({
      model: defaultModel,
      messages: [
        {
          role: 'system',
          content: 'You are an expert at analyzing meeting transcripts and extracting actionable items. Always return valid JSON only.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.3, // Lower temperature for more consistent extraction
      max_tokens: 2000,
    });

    const response = completion.choices[0]?.message?.content?.trim();

    if (!response) {
      console.error('[AttendeeBot] No response from GPT-4o mini');
      return [];
    }

    // Parse JSON response
    const actionItems = JSON.parse(response) as ExtractedActionItem[];

    console.log(`[AttendeeBot] Extracted ${actionItems.length} action items with AI`);
    return actionItems;
  } catch (error) {
    console.error('[AttendeeBot] Error extracting action items with AI:', error);
    // Fallback: return empty array rather than crashing
    return [];
  }
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
