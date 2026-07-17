/**
 * Meeting Bot Manager
 *
 * Handles bot creation for calendar events and transcript storage.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import { getAIClient } from '@/lib/ai/factory';
import { logAIUsage } from '@/lib/ai/log-usage';
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
  document: string;
  decisions: MeetingDecision[];
  actionItems: ExtractedActionItem[];
  keyMoments: KeyMoment[];
  risks: MeetingRisk[];
  suggested_next_step: string | null;
  generatedTitle?: string | null;
}

const GENERIC_TITLES = new Set([
  '', 'untitled note', 'untitled meeting', 'ad-hoc meeting', 'meeting', 'new note',
]);

function isGenericTitle(title: string): boolean {
  return GENERIC_TITLES.has(title.trim().toLowerCase());
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

  // Bots are only created when the user explicitly clicks "Send assistant" in the UI.
  // This function only handles orphan recovery — re-queuing bots that were explicitly
  // scheduled but whose Hetzner job was lost (e.g. container restart).

  // Fetch profile for bot name display
  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', userId)
    .single();

  const firstName = profile?.full_name?.split(' ')[0] ?? 'Your';
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

  const now = new Date();
  const twoWeeksFromNow = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  let created = 0;
  const errors: string[] = [];

  // --- Orphan recovery: re-queue bots whose Hetzner job was lost (e.g. after container restart) ---
  const { data: scheduledEvents } = await supabase
    .from('calendar_events')
    .select('id, title, meeting_link, start_time, attendee_bot_id')
    .eq('user_id', userId)
    .gte('start_time', now.toISOString())
    .lte('start_time', twoWeeksFromNow.toISOString())
    .eq('attendee_bot_state', 'scheduled')
    .not('attendee_bot_id', 'is', null)
    .not('meeting_link', 'is', null)
    .order('start_time', { ascending: true })
    .limit(50);

  if (scheduledEvents && scheduledEvents.length > 0) {
    console.log(`[MeetingBot] Checking ${scheduledEvents.length} scheduled bot(s) for orphans (user: ${userId})`);

    const { checkMeetingBotExists } = await import('@/lib/integrations/meeting-bot/client');

    for (const event of scheduledEvents) {
      try {
        if (!event.meeting_link?.includes('meet.google.com')) continue;

        const isAlive = await checkMeetingBotExists(event.attendee_bot_id);
        if (isAlive) {
          console.log(`[MeetingBot] Bot ${event.attendee_bot_id} is alive for: ${event.title} — skipping`);
          continue;
        }

        console.log(`[MeetingBot] Orphaned bot ${event.attendee_bot_id} for: ${event.title} — re-queuing`);

        const meetingStart = new Date(event.start_time);
        const minJoinTime = new Date(now.getTime() + 2 * 60 * 1000);
        const joinAt = meetingStart > minJoinTime ? meetingStart : minJoinTime;

        const { createMeetingBot: createBot } = await import('@/lib/integrations/meeting-bot/client');
        const result = await createBot(event.meeting_link, joinAt, event.id, userId, botName, googleAccessToken);

        const { error } = await supabase
          .from('calendar_events')
          .update({
            attendee_bot_id: result.botId,
            attendee_bot_state: 'scheduled',
            attendee_bot_created_at: new Date().toISOString(),
          })
          .eq('id', event.id);

        if (error) {
          errors.push(`Failed to save re-queued bot for event ${event.id}: ${error.message}`);
        } else {
          created++;
          console.log(`[MeetingBot] Re-queued bot ${result.botId} for: ${event.title} (joins at ${joinAt.toISOString()})`);
        }
      } catch (error: any) {
        console.error(`[MeetingBot] Error checking/re-queuing orphan for event ${event.id}:`, error);
        errors.push(`Orphan check for ${event.title}: ${error.message}`);
      }
    }
  }
  // --- End orphan recovery ---

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
  options?: { source?: 'bot' | 'recording' | 'upload'; recordingStoragePath?: string; existingTranscriptId?: string; liveNotes?: string }
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
        // Don't overwrite duration_minutes here — the transcription worker already wrote
        // the correct value from the actual audio length. Recalculating from start/end
        // times produces 0 when the recording was confirmed with identical timestamps.
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

  // Collect live notes — from options (in-person) or calendar_events.metadata (bot)
  let liveNotes = options?.liveNotes || '';
  if (!liveNotes && calendarEventId) {
    try {
      const { data: eventRow } = await supabase
        .from('calendar_events')
        .select('metadata')
        .eq('id', calendarEventId)
        .single();
      if (eventRow?.metadata?.live_notes) {
        liveNotes = eventRow.metadata.live_notes;
      }
    } catch {}
  }

  const insights = await extractMeetingInsights(userId, title, normalizedSegments, supabase, liveNotes || undefined);
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

  // Capture meeting action items as commitments (you owe / awaiting) — the don't-drop-the-ball tracker.
  // Pass the real named participants (assignees + decision owners) so a 1:1 user-task commitment can
  // resolve its counterpart instead of leaving it null; and the user's own name so we don't treat the
  // user as the "other" party. writeMeetingCommitments dedups + drops fabricated due_dates.
  const participants = [
    ...(insights.actionItems ?? []).map((a) => a.assignee),
    ...(insights.decisions ?? []).map((d) => d.owner),
  ].filter(Boolean) as string[];

  // GROUNDED meeting initiative — resolve from the attendees the SAME way meeting commitments do, so the
  // transcript joins its project via the magnet (lib/projects/associate.ts). Only when the attendees point
  // to ONE clean initiative (no other variants — the "exactly one" bridge safety); a group spanning deals
  // or a brand-new contact stays loose (null). Hoisted so it tags BOTH the commitments and the transcript.
  let meetingInitiative: string | null = null;
  try {
    const { getInitiativeCandidates } = await import('@/lib/inbox/initiative-candidates');
    const names = [...new Set(participants)];
    if (names.length) {
      const { canonical, candidates } = await getInitiativeCandidates(supabase, userId, { personNames: names, personEmails: names });
      if (canonical && candidates.length === 0) meetingInitiative = canonical;
    }
  } catch { /* non-fatal */ }

  try {
    const { writeMeetingCommitments } = await import('@/lib/commitments/extract');
    const { data: prof } = await supabase.from('profiles').select('full_name').eq('id', userId).maybeSingle();
    await writeMeetingCommitments(
      userId,
      insights.actionItems ?? [],
      { transcriptId: transcriptRecord.id, attendees: participants, userName: prof?.full_name ?? null },
      supabase,
    );
  } catch (e) {
    console.warn('[MeetingBot] Non-fatal: failed to write meeting commitments', e);
  }

  const transcriptUpdate: Record<string, any> = {
    processed: true,
    work_items_generated: workItemsCreated,
    summary: insights.document || null,
    decisions: insights.decisions,
    key_moments: insights.keyMoments,
    risks: insights.risks ?? [],
    suggested_next_step: insights.suggested_next_step ?? null,
    notes_structured: {
      document: insights.document || '',
      live_notes: liveNotes || '',
    },
    // The deal this meeting belongs to (grounded from attendees) — the magnet associates the transcript to
    // its project by this, so the notes become first-class project context. null = loose (safe default).
    ...(meetingInitiative ? { initiative: meetingInitiative } : {}),
  };

  if (insights.generatedTitle && isGenericTitle(title)) {
    transcriptUpdate.title = insights.generatedTitle;
  }

  const { error: finalUpdateError } = await supabase
    .from('meeting_transcripts')
    .update(transcriptUpdate)
    .eq('id', transcriptRecord.id);
  if (finalUpdateError) {
    console.error('[MeetingBot] Failed to mark transcript processed:', finalUpdateError);
  }

  // LIVE Initiative Brain (S5) — a meeting just happened on this initiative → refresh its state so "where it
  // stands" reflects it within seconds. Background, sig-gated, non-fatal.
  if (meetingInitiative) {
    try { const { refreshInitiativeStates } = await import('@/lib/initiatives/state-store'); await refreshInitiativeStates(supabase, userId, [meetingInitiative]); }
    catch { /* non-fatal — Home-load hook backstops */ }
  }

  // Fire-and-forget: index transcript text into KB so it's searchable in Drive
  if (transcriptText.trim()) {
    const { createClient: createAdminClient } = await import('@supabase/supabase-js');
    const adminClient = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );
    void indexArtifact({
      artifactId: `transcript::${transcriptRecord.id}`,
      storagePath: null,
      filename: `Meeting: ${title}.txt`,
      mimeType: 'text/plain',
      userId,
      emailBody: transcriptText,
    }, adminClient).catch(() => {});
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
/**
 * Convert plain text into pseudo-segments for AI extraction.
 * Each paragraph becomes one segment with speaker 'Note'.
 */
export function textToSegments(text: string): Array<{ speaker: string; text: string; timestamp: number }> {
  return text.split(/\n\n+/).filter((p) => p.trim()).map((para, i) => ({
    speaker: 'Note',
    text: para.trim(),
    timestamp: i * 60,
  }));
}

export async function extractMeetingInsights(
  userId: string,
  meetingTitle: string,
  segments: any[],
  supabase: SupabaseClient,
  liveNotes?: string,
): Promise<MeetingInsights> {
  try {
    const { client: openai, model: defaultModel, endpoint, tier } = await getAIClient(userId, 'generation', supabase);

    const userContext = await buildUserContextBlock(userId, supabase);

    const transcriptText = segments
      .map((s, i) => `[${i}] [${s.speaker}]: ${s.text}`)
      .join('\n');

    const isTextNote = segments.every((s: any) => s.speaker === 'Note');

    const notesBlock = liveNotes?.trim()
      ? `The participant wrote these notes during the meeting:\n<notes>\n${liveNotes.trim()}\n</notes>`
      : '';

    const documentInstruction = liveNotes?.trim()
      ? `Each note becomes a top-level bullet. Add 1–2 indented sub-bullets (starting with "  - ") with supporting detail and exact context from the transcript. Convert first-person notes ("I agreed to...") to meeting-level past tense ("Alex agreed to..."). Don't show the raw note text — rephrase it as a clean bullet.`
      : `Produce top-level bullets covering what happened, what was decided, and what matters. For each bullet, add 1–2 indented sub-bullets ("  - ") with supporting detail from the transcript if it adds meaningful context. Skip sub-bullets for simple facts.`;

    const prompt = `${userContext ? userContext + '\n\n' : ''}You are producing clean meeting notes in the style of a smart colleague's bullet-point notebook.

Meeting: "${meetingTitle}"
${notesBlock ? '\n' + notesBlock + '\n' : ''}
${isTextNote ? 'These are written notes (no audio transcript).' : 'Transcript (each line prefixed with segment index [N]):'}
${transcriptText}

Return a JSON object with exactly these fields:

{
  "generatedTitle": "3–6 word descriptive title capturing the meeting topic (e.g. 'Q2 Budget Review', 'Product Roadmap Alignment', 'Client Onboarding Call'). Use null only if the provided meeting title already describes the topic well.",
  "document": "<meeting note — see rules below>",
  "decisions": [
    { "text": "Concrete thing decided", "owner": "Name or null", "date": "YYYY-MM-DD or null" }
  ],
  "actionItems": [
    {
      "action": "Specific task",
      "assignee": "Name or null",
      "priority": 75,
      "context": "Why this matters",
      "dueDate": "YYYY-MM-DD ONLY if a deadline was explicitly stated in the meeting, else null — never invent a date",
      "category": "todo",
      "isUserTask": true
    }
  ],
  "risks": [
    { "text": "Blocker or risk raised", "severity": "high" }
  ],
  "keyMoments": [
    { "segmentIndex": 0, "type": "decision", "text": "Brief label" }
  ],
  "suggested_next_step": "Single sentence — most important thing for the user to do next, or null"
}

Rules for the document field:
- Format: one optional context sentence (max 15 words, only if the meeting title alone isn't self-explanatory), then bullet list. Bullets are the primary format — not prose paragraphs.
- ${documentInstruction}
- Past tense throughout. Meeting-level perspective — never first person. Names over pronouns.
- Capture every decision, commitment, open question, and risk — miss nothing. No redundancy: each fact once.
- Use ## section headers only for genuinely distinct groups in longer meetings (30+ min). Short meetings: no headers, just bullets.
- If follow-up actions were discussed, close with ## Next Steps (bullet list, owner after em dash, e.g. "- Review the contract — Alex").
- Short meetings (< 10 min): 3–6 bullets max. No padding, no filler.
- Never write: "The meeting covered...", "It was noted that...", "The discussion included...".

Rules for other fields:
- decisions: concrete things agreed or decided (not tasks). Max 8. Must be grounded in the transcript.
- actionItems: only SPECIFIC obligations a participant explicitly took on (or is explicitly owed) — NOT every idea, sub-step, or suggestion discussed. Merge related sub-tasks of one obligation into a single item. Be selective: prefer fewer, real commitments (typically 0–6). Max 10. category: "todo" | "waiting_for" | "project". isUserTask=true if assignee matches user or is unassigned. dueDate: only when a deadline was explicitly stated — otherwise null (never invent one).
- risks: blockers or concerns raised explicitly or implicitly. Max 6. severity: "high" | "medium" | "low".
- keyMoments: up to 6 notable segments. type: "decision" | "risk" | "commitment". segmentIndex must be a real [N] from the transcript.
- Return ONLY the JSON object, no other text.`;

    // Use json_object mode for providers that support it (OpenAI, Fireworks, Azure)
    const supportsJsonMode = endpoint.provider !== 'anthropic';
    const completion = await openai.chat.completions.create({
      model: defaultModel,
      messages: [
        { role: 'system', content: 'You are an expert meeting analyst. Always return valid JSON only.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
      max_tokens: 8192,
      ...(supportsJsonMode ? { response_format: { type: 'json_object' } } : {}),
    });

    logAIUsage(supabase, {
      userId, source: 'meeting_insights', provider: endpoint.provider, model: defaultModel,
      tier, taskType: 'generation', usage: completion.usage,
    }).catch(() => {});

    const response = completion.choices[0]?.message?.content?.trim();
    if (!response) throw new Error('No response');

    // Strip <think>...</think> blocks (DeepSeek reasoning traces) then markdown fences,
    // then find the first complete JSON object.
    // Also strip unclosed <think> blocks — happens when a long reasoning trace hits the token limit
    // and the closing </think> is never emitted, causing the regex not to match.
    const stripped = response
      .replace(/<think>[\s\S]*?<\/think>/g, '')
      .replace(/<think>[\s\S]*/g, '')
      .replace(/^```(?:json)?\n?/, '')
      .replace(/\n?```$/, '')
      .trim();
    const jsonStart = stripped.indexOf('{');
    const jsonEnd = stripped.lastIndexOf('}');
    if (jsonStart === -1 || jsonEnd === -1) throw new Error('No JSON object in response');
    const parsed = JSON.parse(stripped.slice(jsonStart, jsonEnd + 1)) as MeetingInsights;

    console.log(`[MeetingBot] Extracted insights: ${parsed.decisions?.length ?? 0} decisions, ${parsed.actionItems?.length ?? 0} actions, ${parsed.risks?.length ?? 0} risks, ${parsed.keyMoments?.length ?? 0} key moments`);
    return {
      document: parsed.document ?? '',
      decisions: parsed.decisions ?? [],
      actionItems: parsed.actionItems ?? [],
      risks: parsed.risks ?? [],
      keyMoments: parsed.keyMoments ?? [],
      suggested_next_step: parsed.suggested_next_step ?? null,
      generatedTitle: parsed.generatedTitle ?? null,
    };
  } catch (error) {
    console.error('[MeetingBot] Error extracting meeting insights:', error);
    const actionItems = await extractActionItemsWithAI(userId, meetingTitle, segments, supabase);
    return { document: '', decisions: [], actionItems, risks: [], keyMoments: [], suggested_next_step: null };
  }
}

/**
 * Re-run insight extraction on an existing transcript with a different template.
 * Looks up the transcript by calendar_event_id or transcript id, re-runs AI, updates DB.
 */
export async function reEnhanceTranscript(
  userId: string,
  eventOrTranscriptId: string,
  templateId: string,
  supabase: SupabaseClient,
): Promise<MeetingInsights> {
  // Try calendar_event_id first, then transcript id
  let transcript: any = null;
  const { data: byEvent } = await supabase
    .from('meeting_transcripts')
    .select('id, title, transcript_segments, notes_structured, calendar_event_id')
    .eq('calendar_event_id', eventOrTranscriptId)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  transcript = byEvent;

  if (!transcript) {
    const { data: byId } = await supabase
      .from('meeting_transcripts')
      .select('id, title, transcript_segments, notes_structured, calendar_event_id')
      .eq('id', eventOrTranscriptId)
      .eq('user_id', userId)
      .maybeSingle();
    transcript = byId;
  }

  if (!transcript) throw new Error('Transcript not found');

  const segments = transcript.transcript_segments ?? [];
  const liveNotes = transcript.notes_structured?.live_notes || '';

  // Get template for custom instructions
  const { getTemplate } = await import('@/lib/meetings/templates');
  const template = getTemplate(templateId);

  // Re-run extraction (template instructions are built into the prompt via liveNotes enrichment)
  let templateHint = '';
  if (template && templateId !== 'default') {
    templateHint = `\n\nFormat the analysis according to the "${template.name}" template. Focus on these sections:\n${template.sections.map((s) => `- ${s.label}: ${s.instruction}`).join('\n')}\n`;
  }

  const combinedNotes = [liveNotes, templateHint].filter(Boolean).join('\n');
  const insights = await extractMeetingInsights(userId, transcript.title, segments, supabase, combinedNotes || undefined);

  // Update transcript
  const update: Record<string, any> = {
    summary: insights.document || null,
    decisions: insights.decisions,
    key_moments: insights.keyMoments,
    risks: insights.risks ?? [],
    suggested_next_step: insights.suggested_next_step ?? null,
    template_id: templateId,
    notes_structured: {
      document: insights.document || '',
      live_notes: liveNotes,
    },
  };

  await supabase
    .from('meeting_transcripts')
    .update(update)
    .eq('id', transcript.id);

  return insights;
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
    const { client: openai, model: defaultModel, endpoint, tier } = await getAIClient(userId, 'summarization', supabase);

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

    logAIUsage(supabase, {
      userId, source: 'meeting_insights', provider: endpoint.provider, model: defaultModel,
      tier, taskType: 'summarization', usage: completion.usage,
    }).catch(() => {});

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
