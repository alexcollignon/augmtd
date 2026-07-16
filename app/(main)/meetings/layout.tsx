import { createClient } from '@/lib/supabase/server';
import { createClient as createAdmin } from '@supabase/supabase-js';
import { redirect } from 'next/navigation';
import { guardFeaturePage } from '@/lib/workspace/guards';
import MeetingsShell from '@/components/meetings/meetings-shell';
import type { Transcript } from '@/context/meetings-data-context';
import { listTranscriptRows } from '@/lib/meetings/list-transcripts';

export default async function MeetingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await guardFeaturePage('meetings');

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const now = new Date();
  const past24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const next14d = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString();

  // SSR the SAME set the client refreshes with (own + shared-with-me, via the shared fetcher) so the list
  // doesn't grow after first paint. Needs a service-role client for the cross-user shared rows.
  const adminClient = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const [eventsResult, transcriptRows, foldersResult] = await Promise.all([
    supabase
      .from('calendar_events')
      .select('*')
      .eq('user_id', user.id)
      .eq('status', 'confirmed')
      .gte('end_time', past24h)
      .lte('start_time', next14d)
      .order('start_time', { ascending: true }),
    listTranscriptRows(supabase, adminClient, user.id).catch(() => [] as Array<Record<string, unknown>>),
    supabase
      .from('meeting_folders')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false }),
  ]);

  const events = eventsResult.data ?? [];
  const rawTranscripts = transcriptRows as Array<Record<string, any>>;
  const folders = foldersResult.data ?? [];

  // Batch relationship enrichment
  const allEmails = [
    ...new Set(events.flatMap((e) => (e.attendees ?? []).map((a: any) => a.email).filter(Boolean))),
  ];
  const relMap = new Map<string, number>();
  if (allEmails.length > 0) {
    const { data: rels } = await supabase
      .from('relationship_graph')
      .select('contact_email, importance')
      .eq('user_id', user.id)
      .in('contact_email', allEmails);
    (rels ?? []).forEach((r) => relMap.set(r.contact_email, r.importance));
  }

  // Batch transcript presence
  const eventIds = events.map((e) => e.id);
  const transcriptEventIds = new Set<string>();
  if (eventIds.length > 0) {
    const { data: tCheck } = await supabase
      .from('meeting_transcripts')
      .select('calendar_event_id')
      .eq('user_id', user.id)
      .in('calendar_event_id', eventIds);
    (tCheck ?? []).forEach((t) => { if (t.calendar_event_id) transcriptEventIds.add(t.calendar_event_id); });
  }

  const initialUpcoming = events.map((e) => ({
    ...e,
    attendees: (e.attendees ?? []).map((a: any) => ({
      ...a,
      isVIP: (relMap.get(a.email) ?? 0) > 80,
      importance: relMap.get(a.email) ?? 0,
    })),
    has_transcript: transcriptEventIds.has(e.id),
  }));

  const initialTranscripts: Transcript[] = rawTranscripts.map((t) => ({
    id: t.id,
    calendarEventId: t.calendar_event_id,
    title: t.title,
    startTime: t.start_time,
    durationMinutes: t.duration_minutes,
    workItemsGenerated: t.work_items_generated,
    processed: t.processed,
    botState: t.bot_state ?? null,
    source: t.source as Transcript['source'],
    summary: t.summary,
    processedAt: t.updated_at ?? null,
    folderId: t.folder_id ?? null,
    projectId: t.project_id ?? null,
    hasRecording: !!t.recording_storage_path,
    hasDocument: !!t.has_document,
    attendees: (t.attendees as any[]) ?? [],
    sharingMode: t.sharing_mode ?? null,
    isSharedWithMe: t.is_shared_with_me ?? false,
    sharedByName: t.shared_by_name ?? null,
  }));

  return (
    <main className="flex-1 min-h-0 flex flex-col">
      <MeetingsShell
        userEmail={user.email ?? ''}
        initialUpcoming={initialUpcoming}
        initialTranscripts={initialTranscripts}
        initialFolders={folders}
      >
        {children}
      </MeetingsShell>
    </main>
  );
}
