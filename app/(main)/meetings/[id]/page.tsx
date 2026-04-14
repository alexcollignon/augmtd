import { createClient } from '@/lib/supabase/server';
import { redirect, notFound } from 'next/navigation';
import MeetingDetailClient from '@/app/meetings/[id]/meeting-detail-client';
import { guardFeaturePage } from '@/lib/workspace/guards';

export default async function MeetingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await guardFeaturePage('meetings');

  const { id } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: event } = await supabase
    .from('calendar_events')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .single();

  if (!event) notFound();

  const { data: transcriptRaw } = await supabase
    .from('meeting_transcripts')
    .select('id, summary, decisions, risks, suggested_next_step, key_moments, transcript_segments, duration_minutes, work_items_generated, source, recording_storage_path, bot_state, processed, notes_structured, template_id')
    .eq('calendar_event_id', id)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  let audioUrl: string | null = null;
  if (transcriptRaw?.recording_storage_path) {
    const { createClient: createAdmin } = await import('@supabase/supabase-js');
    const adminClient = createAdmin(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
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
      }
    : null;

  const actionItems = transcript
    ? await (async () => {
        const { data } = await supabase
          .from('inbox_items')
          .select('id, work_title, why_matters, priority, source, source_data')
          .eq('source_meeting_transcript_id', transcript.id)
          .order('priority', { ascending: false });
        return (data ?? []).map((item: any) => ({
          id: item.id,
          workTitle: item.work_title,
          whyMatters: item.why_matters,
          priority: item.priority ?? 50,
          source: item.source ?? 'meeting',
          assignee: item.source_data?.assignee ?? null,
          category: item.source_data?.category ?? 'todo',
        }));
      })()
    : [];

  return (
    <main className="flex-1 min-h-0 overflow-hidden bg-gradient-to-br from-neutral-50 to-white">
      <MeetingDetailClient
        event={event}
        transcript={transcript}
        actionItems={actionItems}
        risks={transcript?.risks ?? []}
        suggestedNextStep={transcript?.suggestedNextStep ?? null}
        audioUrl={audioUrl}
        transcriptBotState={transcript?.botState ?? null}
        transcriptProcessed={transcript?.processed ?? false}
      />
    </main>
  );
}
