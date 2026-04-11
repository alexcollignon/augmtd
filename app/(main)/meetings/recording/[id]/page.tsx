import { createClient } from '@/lib/supabase/server';
import { redirect, notFound } from 'next/navigation';
import RecordingDetailClient from '@/app/meetings/recording/[id]/recording-detail-client';

export default async function RecordingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: transcriptRaw } = await supabase
    .from('meeting_transcripts')
    .select('id, title, start_time, end_time, duration_minutes, work_items_generated, processed, bot_state, source, summary, decisions, risks, suggested_next_step, key_moments, transcript_segments, recording_storage_path')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!transcriptRaw) notFound();

  let audioUrl: string | null = null;
  if (transcriptRaw.recording_storage_path) {
    const { createClient: createAdminClient } = await import('@supabase/supabase-js');
    const adminClient = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    const { data: signed } = await adminClient.storage
      .from('meeting-recordings')
      .createSignedUrl(transcriptRaw.recording_storage_path, 3600);
    audioUrl = signed?.signedUrl ?? null;
  }

  const transcript = {
    id: transcriptRaw.id,
    title: transcriptRaw.title,
    startTime: transcriptRaw.start_time,
    endTime: transcriptRaw.end_time,
    durationMinutes: transcriptRaw.duration_minutes ?? 0,
    source: transcriptRaw.source ?? 'recording',
    processed: transcriptRaw.processed,
    botState: transcriptRaw.bot_state ?? null,
    summary: transcriptRaw.summary ?? null,
    decisions: (transcriptRaw.decisions as any[]) ?? [],
    risks: (transcriptRaw.risks as any[]) ?? [],
    suggestedNextStep: (transcriptRaw.suggested_next_step as string | null) ?? null,
    keyMoments: (transcriptRaw.key_moments as any[]) ?? [],
    transcriptSegments: (transcriptRaw.transcript_segments as any[]) ?? [],
    workItemsGenerated: transcriptRaw.work_items_generated ?? 0,
  };

  const { data: actionItemsRaw } = await supabase
    .from('inbox_items')
    .select('id, work_title, why_matters, priority, source, source_data')
    .eq('source_meeting_transcript_id', id)
    .order('priority', { ascending: false });

  const actionItems = (actionItemsRaw ?? []).map((item: any) => ({
    id: item.id,
    workTitle: item.work_title,
    whyMatters: item.why_matters,
    priority: item.priority ?? 50,
    source: item.source ?? 'meeting',
    assignee: item.source_data?.assignee ?? null,
    category: item.source_data?.category ?? 'todo',
  }));

  return (
    <main className="flex-1 min-h-0 overflow-hidden bg-gradient-to-br from-neutral-50 to-white">
      <RecordingDetailClient
        transcript={transcript}
        actionItems={actionItems}
        userId={user.id}
        risks={transcript.risks}
        suggestedNextStep={transcript.suggestedNextStep}
        audioUrl={audioUrl}
      />
    </main>
  );
}
