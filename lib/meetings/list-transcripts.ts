// SINGLE source of truth for a user's meeting list (own + shared-with-me), used by BOTH the SSR layout
// (first paint) and GET /api/meetings/transcripts (client refresh). Previously the SSR fetched OWN-only
// while the client fetched own + shared, so shared meetings "popped in" a beat after load — the staggered
// list the user saw. One function → identical first paint and refresh. Caps raised well above the old 50 so
// a normal meeting history loads in full (true pagination is a later concern).
//
// Returns the ROUTE-RESPONSE shape (snake_case + is_shared_with_me / shared_by_name / has_document);
// both consumers map it to the client `Transcript` type the same way.

import type { SupabaseClient } from '@supabase/supabase-js';

const TRANSCRIPT_FIELDS = 'id, title, start_time, end_time, duration_minutes, work_items_generated, processed, source, summary, calendar_event_id, bot_state, updated_at, folder_id, project_id, recording_storage_path, notes_structured, attendees, sharing_mode, company_id';
const OWN_CAP = 300;
const SHARED_CAP = 150;
const TOTAL_CAP = 400;

export type TranscriptRow = Record<string, unknown> & { id: string; start_time: string | null };

export async function listTranscriptRows(
  supabase: SupabaseClient,   // cookie/RLS client — the user's OWN rows
  adminClient: SupabaseClient, // service-role — cross-user shared rows (RLS-bypassing, scoped by company + receipt)
  userId: string,
): Promise<TranscriptRow[]> {
  // 1 — own transcripts
  const { data: own, error } = await supabase
    .from('meeting_transcripts').select(TRANSCRIPT_FIELDS)
    .eq('user_id', userId).order('start_time', { ascending: false }).limit(OWN_CAP);
  if (error) throw error;

  // 2 — shared with me by teammates in the same company
  const { data: memberships } = await supabase
    .from('company_members').select('company_id').eq('user_id', userId).eq('status', 'active');
  const companyIds = (memberships ?? []).map((m: { company_id: string }) => m.company_id);

  let sharedMapped: TranscriptRow[] = [];
  if (companyIds.length) {
    const [{ data: liveShared }, { data: specificShared }] = await Promise.all([
      adminClient.from('meeting_transcripts')
        .select(`${TRANSCRIPT_FIELDS}, profiles!meeting_transcripts_user_id_fkey(full_name), shared_note_receipts!left(folder_id, project_id, user_id)`)
        .eq('sharing_mode', 'live').in('company_id', companyIds).neq('user_id', userId)
        .order('start_time', { ascending: false }).limit(SHARED_CAP),
      adminClient.from('meeting_transcripts')
        .select(`${TRANSCRIPT_FIELDS}, profiles!meeting_transcripts_user_id_fkey(full_name), shared_note_receipts!inner(folder_id, project_id, user_id)`)
        .eq('sharing_mode', 'specific').in('company_id', companyIds).neq('user_id', userId)
        .eq('shared_note_receipts.user_id', userId).order('start_time', { ascending: false }).limit(SHARED_CAP),
    ]);
    const toMapped = (rows: Array<Record<string, unknown>>) => (rows ?? []).map((t) => {
      const myReceipt = ((t.shared_note_receipts as Array<{ folder_id: string | null; project_id: string | null; user_id: string }>) ?? []).find((r) => r.user_id === userId);
      // A shared note's project membership is the RECIPIENT's OWN filing (receipt.project_id), never the
      // owner's transcript.project_id — so my organising is mine and doesn't leak the owner's.
      return { ...t, folder_id: myReceipt?.folder_id ?? null, project_id: myReceipt?.project_id ?? null, is_shared_with_me: true, shared_by_name: (t.profiles as { full_name?: string } | null)?.full_name ?? null, profiles: undefined, shared_note_receipts: undefined } as unknown as TranscriptRow;
    });
    sharedMapped = [...toMapped(liveShared ?? []), ...toMapped(specificShared ?? [])];
  }

  const ownMapped = (own ?? []).map((t) => ({ ...(t as Record<string, unknown>), is_shared_with_me: false, shared_by_name: null } as unknown as TranscriptRow));

  return [...ownMapped, ...sharedMapped]
    .sort((a, b) => new Date((b.start_time as string) || 0).getTime() - new Date((a.start_time as string) || 0).getTime())
    .slice(0, TOTAL_CAP)
    .map((t) => ({ ...t, has_document: !!(t.notes_structured as { document?: string } | null)?.document, notes_structured: undefined }));
}
