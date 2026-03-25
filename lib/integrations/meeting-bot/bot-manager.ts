/**
 * Meeting Bot Manager
 *
 * Handles bot creation for calendar events and transcript storage.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import { getAIClient } from '@/lib/ai/factory';
import { buildUserContextBlock } from '@/lib/context/build-user-context';
import { getOAuth2Client } from '@/lib/google/oauth';
import { indexArtifact } from '@/lib/knowledge/indexer';

interface ExtractedActionItem {
  action: string;
  assignee?: string;
  priority: number; // 1-100
  context?: string;
  dueDate?: string;
  category: 'todo' | 'waiting_for' | 'project';
  isUserTask?: boolean;
}

interface MeetingDecision {
  text: string;
  owner?: string;
  date?: string;
}

interface KeyMoment {
  segmentIndex: number;
  type: 'decision' | 'risk' | 'commitment';
  text: string;
}

interface MeetingRisk {
  text: string;
  severity: 'high' | 'medium' | 'low';
}

interface MeetingInsights {
  summary: string;
  decisions: MeetingDecision[];
  actionItems: ExtractedActionItem[];
  keyMoments: KeyMoment[];
  risks: MeetingRisk[];
  suggested_next_step: string | null;
}

/**
 * Create bots for calendar events with Google Meet links.
 * Uses self-hosted bot service (MEETING_BOT_SERVICE_URL).
 * Called after calendar sync completes.
 */
export async function createBotsForCalendarEvents(
  userId: string,
  supabase: SupabaseClient
): Promise<{ created: number; errors: string[] }> {
  if (!process.env.MEETING_BOT_SERVICE_URL) {
    return { created: 0, errors: [] };
  }

  // Check if user has meeting assistant enabled + get name for bot display
  const { data: profile } = await supabase
    .from('profiles')
    .select('attendee_enabled, full_name')
    .eq('id', userId)
    .single();

  if (!profile?.attendee_enabled) {
    return { created: 0, errors: [] };
  }

  // Derive bot name: "Alex's Assistant"
  const firstName = profile.full_name?.split(' ')[0] ?? 'Your';
  const botName = `${firstName}'s Assistant`;

  // Get a fresh Google OAuth access token for the user (used to authenticate the bot browser session)
  let googleAccessToken: string | undefined;
  try {
    const { data: conn } = await supabase
      .from('connections')
      .select('metadata')
      .eq('user_id', userId)
      .eq('provider', 'gmail')
      .eq('status', 'active')
      .single();
    if (conn?.metadata?.tokens) {
      const tokens = JSON.parse(Buffer.from(conn.metadata.tokens, 'base64').toString());
      const oauth2 = getOAuth2Client();
      oauth2.setCredentials(tokens);
      const { credentials } = await oauth2.refreshAccessToken();
      googleAccessToken = credentials.access_token ?? undefined;
    }
  } catch (err) {
    console.warn('[MeetingBot] Could not get Google access token — bot will join as guest:', err);
  }

  // Find upcoming events (next 2 weeks) with Google Meet links but no bot created yet
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

  console.log(`[MeetingBot] Found ${events.length} events to create bots for (user: ${userId})`);

  let created = 0;
  const errors: string[] = [];

  for (const event of events) {
    try {
      // Only Google Meet is supported
      if (!event.meeting_link?.includes('meet.google.com')) continue;

      console.log(`[MeetingBot] Creating bot for: ${event.title}`);

      const meetingStart = new Date(event.start_time);
      const minJoinTime = new Date(now.getTime() + 2 * 60 * 1000);
      const joinAt = meetingStart > minJoinTime ? meetingStart : minJoinTime;

      const { createMeetingBot } = await import('@/lib/integrations/meeting-bot/client');
      const result = await createMeetingBot(event.meeting_link, joinAt, event.id, userId, botName, googleAccessToken);
      const bot = { id: result.botId, state: 'scheduled' };

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
        console.log(`[MeetingBot] Scheduled bot ${bot.id} for: ${event.title} (joins at ${joinAt.toISOString()})`);
      }
    } catch (error: any) {
      console.error(`[MeetingBot] Error creating bot for event ${event.id}:`, error);
      errors.push(`Event ${event.title}: ${error.message}`);
    }
  }

  return { created, errors };
}

/**
 * Store transcript and generate work items.
 * Accepts pre-normalized segments ({ speaker, text, timestamp }) from the Whisper pipeline
 * or raw Attendee.dev segments ({ speaker_name, transcription.transcript, timestamp_ms }).
 * Exported for use by the transcription pipeline.
 */
export async function storeTranscriptAndGenerateWork(
  userId: string,
  calendarEventId: string | null,
  botId: string | null,
  title: string,
  startTime: string,
  endTime: string,
  transcript: any,
  supabase: SupabaseClient,
  options?: { source?: 'bot' | 'recording' | 'upload'; recordingStoragePath?: string; existingTranscriptId?: string }
): Promise<void> {
  const durationMinutes = Math.round(
    (new Date(endTime).getTime() - new Date(startTime).getTime()) / (1000 * 60)
  );

  const rawSegments = Array.isArray(transcript) ? transcript : [];

  const transcriptText = rawSegments
    .map((s: any) => `[${s.speaker_name || s.speaker || 'Unknown'}]: ${s.transcription?.transcript || s.text || ''}`)
    .join('\n');

  const normalizedSegments = rawSegments.map((s: any) => ({
    speaker: s.speaker || s.speaker_name || 'Unknown',
    text: s.text || s.transcription?.transcript || '',
    timestamp: s.timestamp ?? Math.floor((s.timestamp_ms || 0) / 1000),
  }));

  let transcriptRecord: any;
  if (options?.existingTranscriptId) {
    const { data, error: updateError } = await supabase
      .from('meeting_transcripts')
      .update({
        attendee_bot_id: botId,
        bot_state: 'ended',
        duration_minutes: durationMinutes,
        transcript: transcriptText,
        transcript_segments: normalizedSegments,
      })
      .eq('id', options.existingTranscriptId)
      .eq('user_id', userId)
      .select()
      .single();
    if (updateError) {
      console.error('[MeetingBot] Failed to update transcript:', updateError);
      return;
    }
    transcriptRecord = data;
  } else {
    const { data, error: insertError } = await supabase
      .from('meeting_transcripts')
      .insert({
        user_id: userId,
        meeting_id: calendarEventId ?? randomUUID(),
        calendar_event_id: calendarEventId,
        attendee_bot_id: botId,
        bot_state: 'ended',
        source: options?.source ?? 'bot',
        recording_storage_path: options?.recordingStoragePath ?? null,
        title,
        start_time: startTime,
        end_time: endTime,
        duration_minutes: durationMinutes,
        transcript: transcriptText,
        transcript_segments: normalizedSegments,
        attendees: [],
        processed: false,
      })
      .select()
      .single();
    if (insertError) {
      console.error('[MeetingBot] Failed to store transcript:', insertError);
      return;
    }
    transcriptRecord = data;
  }

  console.log(`[MeetingBot] Stored transcript ${transcriptRecord.id}`);

  const insights = await extractMeetingInsights(userId, title, normalizedSegments, supabase);
  const keyTopics = extractKeyTopics(normalizedSegments);

  let workItemsCreated = 0;

  for (const item of insights.actionItems) {
    const isUserTask = item.isUserTask === true || item.isUserTask == null || !item.assignee;
    if (!isUserTask) {
      console.log(`[MeetingBot] Skipping non-user task: ${item.action} (assignee: ${item.assignee})`);
      continue;
    }

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
        work_title: item.action,
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
      console.log(`[MeetingBot] Created work item: ${item.action} (priority: ${item.priority})`);
    }
  }

  await supabase
    .from('meeting_transcripts')
    .update({
      processed: true,
      work_items_generated: workItemsCreated,
      summary: insights.summary || null,
      decisions: insights.decisions,
      key_moments: insights.keyMoments,
      risks: insights.risks ?? [],
      suggested_next_step: insights.suggested_next_step ?? null,
    })
    .eq('id', transcriptRecord.id);

  // Fire-and-forget: index transcript text into KB so it's searchable in Drive
  if (transcriptText.trim()) {
    void indexArtifact({
      artifactId: `transcript::${transcriptRecord.id}`,
      storagePath: null,
      filename: `Meeting: ${title}.txt`,
      mimeType: 'text/plain',
      userId,
      emailBody: transcriptText,
    }, supabase).catch(() => {});
  }

  console.log(`[MeetingBot] Generated ${workItemsCreated} work items from: ${title}`);
}

/**
 * Reprocess existing transcripts that never generated work items.
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

  console.log(`[MeetingBot] Reprocessing ${transcripts.length} transcripts for user ${userId}`);

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
          console.error('[MeetingBot] Reprocess insert error:', error);
        }
      }

      await supabase
        .from('meeting_transcripts')
        .update({ work_items_generated: workItemsCreated, processed: true })
        .eq('id', transcript.id);

      reprocessed++;
    } catch (error: any) {
      console.error(`[MeetingBot] Reprocess error for transcript ${transcript.id}:`, error);
      errors.push(`${transcript.title}: ${error.message}`);
    }
  }

  return { reprocessed, created, errors };
}

/**
 * Extract full meeting insights in a single AI call.
 */
async function extractMeetingInsights(
  userId: string,
  meetingTitle: string,
  segments: any[],
  supabase: SupabaseClient
): Promise<MeetingInsights> {
  try {
    const { client: openai, model: defaultModel } = await getAIClient(userId, 'planning', supabase);

    const userContext = await buildUserContextBlock(userId, supabase);

    const transcriptText = segments
      .map((s, i) => `[${i}] [${s.speaker}]: ${s.text}`)
      .join('\n');

    const prompt = `${userContext ? userContext + '\n\n' : ''}You are analysing a meeting transcript. Reason step by step (internally) before producing output:
1. What was the purpose of this meeting?
2. What was actually decided (not just discussed)?
3. What risks or blockers were raised, explicitly or implicitly?
4. What actions follow, and who owns each one?
5. Given the user's role and responsibilities, what is the single most important next step for them?

Meeting: "${meetingTitle}"

Transcript (each line prefixed with segment index [N]):
${transcriptText}

Return a JSON object with exactly these fields:
{
  "summary": "2-3 sentence plain text summary of what was discussed and decided",
  "decisions": [
    { "text": "What was decided", "owner": "Name or null", "date": "YYYY-MM-DD or null" }
  ],
  "actionItems": [
    {
      "action": "What needs to be done",
      "assignee": "Name or null",
      "priority": 75,
      "context": "Why this matters",
      "dueDate": "YYYY-MM-DD or null",
      "category": "todo",
      "isUserTask": true
    }
  ],
  "risks": [
    { "text": "Risk or blocker description", "severity": "high" }
  ],
  "keyMoments": [
    { "segmentIndex": 5, "type": "decision", "text": "Brief label for this moment" }
  ],
  "suggested_next_step": "Single sentence — the most important thing for the user to do next"
}

Rules:
- decisions: concrete things that were agreed/decided (not tasks). Max 8.
- actionItems: specific tasks requiring action. Max 10. category: "todo" | "waiting_for" | "project". Set isUserTask=true if assignee matches the user above or is unassigned.
- risks: blockers or risks raised explicitly or implicitly. Max 6. severity: "high" | "medium" | "low".
- keyMoments: up to 6 notable segments. type: "decision" | "risk" | "commitment". segmentIndex must match a real [N] from the transcript.
- suggested_next_step: single sentence, most important action for the user given their role. Null if unclear.
- Return ONLY the JSON object, no other text.`;

    const completion = await openai.chat.completions.create({
      model: defaultModel,
      messages: [
        { role: 'system', content: 'You are an expert meeting analyst. Always return valid JSON only.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
      max_tokens: 3000,
    });

    const response = completion.choices[0]?.message?.content?.trim();
    if (!response) throw new Error('No response');

    const cleaned = response.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    const parsed = JSON.parse(cleaned) as MeetingInsights;

    console.log(`[MeetingBot] Extracted insights: ${parsed.decisions?.length ?? 0} decisions, ${parsed.actionItems?.length ?? 0} actions, ${parsed.risks?.length ?? 0} risks, ${parsed.keyMoments?.length ?? 0} key moments`);
    return {
      summary: parsed.summary ?? '',
      decisions: parsed.decisions ?? [],
      actionItems: parsed.actionItems ?? [],
      risks: parsed.risks ?? [],
      keyMoments: parsed.keyMoments ?? [],
      suggested_next_step: parsed.suggested_next_step ?? null,
    };
  } catch (error) {
    console.error('[MeetingBot] Error extracting meeting insights:', error);
    const actionItems = await extractActionItemsWithAI(userId, meetingTitle, segments, supabase);
    return { summary: '', decisions: [], actionItems, risks: [], keyMoments: [], suggested_next_step: null };
  }
}

/**
 * Extract action items from transcript using AI with user context.
 */
async function extractActionItemsWithAI(
  userId: string,
  meetingTitle: string,
  segments: any[],
  supabase: SupabaseClient
): Promise<ExtractedActionItem[]> {
  try {
    const { client: openai, model: defaultModel } = await getAIClient(userId, 'summarization', supabase);

    const { data: profiles } = await supabase
      .from('profiles')
      .select('profile_type, data, confidence_score')
      .eq('user_id', userId)
      .in('profile_type', ['identity', 'meeting_behavior', 'communication_patterns']);

    const identity = profiles?.find(p => p.profile_type === 'identity')?.data;
    const meetingBehavior = profiles?.find(p => p.profile_type === 'meeting_behavior')?.data;

    const transcriptText = segments
      .map(s => `[${s.speaker}]: ${s.text}`)
      .join('\n');

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

Extract concrete action items from this meeting transcript. Return ONLY a JSON array:
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

Category: "todo" | "waiting_for" | "project". Maximum 10 items. Return ONLY the JSON array.`;

    const completion = await openai.chat.completions.create({
      model: defaultModel,
      messages: [
        { role: 'system', content: 'You are an expert at analyzing meeting transcripts. Always return valid JSON only.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
      max_tokens: 2000,
    });

    const response = completion.choices[0]?.message?.content?.trim();
    if (!response) return [];

    const actionItems = JSON.parse(response) as ExtractedActionItem[];
    console.log(`[MeetingBot] Extracted ${actionItems.length} action items`);
    return actionItems;
  } catch (error) {
    console.error('[MeetingBot] Error extracting action items:', error);
    return [];
  }
}

/**
 * Extract key topics from transcript segments.
 */
function extractKeyTopics(segments: any[]): string[] {
  const text = segments.map(s => s.text).join(' ');
  const words = text.toLowerCase().split(/\s+/);
  const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'is', 'was', 'are', 'were', 'we', 'i', 'you', 'it', 'this', 'that', 'so', 'just', 'like']);
  const wordCount = new Map<string, number>();

  for (const word of words) {
    if (word.length > 3 && !stopWords.has(word)) {
      wordCount.set(word, (wordCount.get(word) || 0) + 1);
    }
  }

  return Array.from(wordCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([word]) => word);
}
