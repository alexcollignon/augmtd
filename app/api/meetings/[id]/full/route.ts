import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * GET /api/meetings/[id]/full
 * Returns all data needed for inline meeting note view:
 * calendar event, transcript, action items, signed audio URL.
 */
const TRANSCRIPT_SELECT = 'id, title, start_time, duration_minutes, summary, decisions, risks, suggested_next_step, key_moments, transcript_segments, work_items_generated, source, recording_storage_path, bot_state, processed, notes_structured, template_id, transcript, sharing_mode, user_id';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const adminClient = (await import('@supabase/supabase-js')).createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  // Load calendar event
  const { data: event } = await supabase
    .from('calendar_events')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .single();

  // Load transcript — either by calendar_event_id (normal) or directly by transcript id (ad-hoc)
  let transcriptRaw: any = null;
  let isOwner = true;
  let sharedByName: string | null = null;

  if (event) {
    const { data } = await supabase
      .from('meeting_transcripts')
      .select(TRANSCRIPT_SELECT)
      .eq('calendar_event_id', id)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    transcriptRaw = data;
  } else {
    // Try as owner first
    const { data: owned } = await supabase
      .from('meeting_transcripts')
      .select(TRANSCRIPT_SELECT)
      .eq('id', id)
      .eq('user_id', user.id)
      .maybeSingle();
    transcriptRaw = owned;

    // If not found as owner, check shared access (live or specific)
    if (!transcriptRaw) {
      const { data: memberships } = await supabase
        .from('company_members')
        .select('company_id')
        .eq('user_id', user.id)
        .eq('status', 'active');
      const companyIds = (memberships ?? []).map((m: any) => m.company_id);

      if (companyIds.length > 0) {
        // Try 'live' first
        const { data: live } = await adminClient
          .from('meeting_transcripts')
          .select(`${TRANSCRIPT_SELECT}, profiles!meeting_transcripts_user_id_fkey(full_name)`)
          .eq('id', id)
          .eq('sharing_mode', 'live')
          .in('company_id', companyIds)
          .maybeSingle();

        if (live) {
          transcriptRaw = live;
          isOwner = false;
          sharedByName = (live as any).profiles?.full_name ?? null;
        } else {
          // Try 'specific' — must have a receipt row
          const { data: receipt } = await adminClient
            .from('shared_note_receipts')
            .select('transcript_id')
            .eq('transcript_id', id)
            .eq('user_id', user.id)
            .maybeSingle();

          if (receipt) {
            const { data: specific } = await adminClient
              .from('meeting_transcripts')
              .select(`${TRANSCRIPT_SELECT}, profiles!meeting_transcripts_user_id_fkey(full_name)`)
              .eq('id', id)
              .eq('sharing_mode', 'specific')
              .in('company_id', companyIds)
              .maybeSingle();

            if (specific) {
              transcriptRaw = specific;
              isOwner = false;
              sharedByName = (specific as any).profiles?.full_name ?? null;
            }
          }
        }
      }
    }
  }

  // For ad-hoc transcripts (no calendar event), synthesize a minimal event object
  const resolvedEvent = event ?? (transcriptRaw ? {
    id: transcriptRaw.id,
    title: (transcriptRaw as any).title || 'Ad-hoc meeting',
    start_time: (transcriptRaw as any).start_time,
    end_time: (() => {
      const start = new Date((transcriptRaw as any).start_time);
      start.setMinutes(start.getMinutes() + ((transcriptRaw as any).duration_minutes ?? 30));
      return start.toISOString();
    })(),
    attendees: [],
    meeting_link: null,
    meeting_status: 'completed',
    attendee_bot_state: (transcriptRaw as any).bot_state ?? null,
    user_id: user.id,
  } : null);

  if (!resolvedEvent) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Generate signed URL for audio playback if recording exists
  let audioUrl: string | null = null;
  if (transcriptRaw?.recording_storage_path) {
    const { data: signed } = await adminClient.storage
      .from('meeting-recordings')
      .createSignedUrl(transcriptRaw.recording_storage_path, 3600);
    audioUrl = signed?.signedUrl ?? null;
  }

  const transcript = transcriptRaw
    ? {
        id: transcriptRaw.id,
        summary: transcriptRaw.summary ?? null,
        decisions: (transcriptRaw.decisions as any[]) ?? [],
        risks: (transcriptRaw.risks as any[]) ?? [],
        suggestedNextStep: (transcriptRaw.suggested_next_step as string | null) ?? null,
        keyMoments: (transcriptRaw.key_moments as any[]) ?? [],
        transcriptSegments: (transcriptRaw.transcript_segments as any[]) ?? [],
        durationMinutes: transcriptRaw.duration_minutes ?? 0,
        workItemsGenerated: transcriptRaw.work_items_generated ?? 0,
        source: transcriptRaw.source ?? 'bot',
        botState: transcriptRaw.bot_state ?? null,
        processed: transcriptRaw.processed ?? false,
        notesStructured: (transcriptRaw as any).notes_structured ?? null,
        templateId: (transcriptRaw as any).template_id ?? 'default',
        rawTranscript: (transcriptRaw as any).transcript ?? null,
        sharingMode: (transcriptRaw as any).sharing_mode ?? null,
        isOwner,
        sharedByName,
      }
    : null;

  // Load action items from inbox
  let actionItems: any[] = [];
  if (transcript) {
    const { data } = await supabase
      .from('inbox_items')
      .select('id, work_title, why_matters, priority, source, source_data')
      .eq('source_meeting_transcript_id', transcript.id)
      .order('priority', { ascending: false });
    actionItems = (data ?? []).map((item: any) => ({
      id: item.id,
      workTitle: item.work_title,
      whyMatters: item.why_matters,
      priority: item.priority ?? 50,
      source: item.source ?? 'meeting',
      assignee: item.source_data?.assignee ?? null,
      category: item.source_data?.category ?? 'todo',
    }));
  }

  return NextResponse.json({
    event: resolvedEvent,
    transcript,
    actionItems,
    audioUrl,
  });
}
