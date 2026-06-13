import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdmin } from '@supabase/supabase-js';

const TRANSCRIPT_FIELDS = 'id, title, start_time, end_time, duration_minutes, work_items_generated, processed, source, summary, calendar_event_id, bot_state, updated_at, folder_id, recording_storage_path, notes_structured, attendees, sharing_mode, company_id';

// GET /api/meetings/transcripts
export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const adminClient = createAdmin(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    // Auto-fail rows stuck in processing for > 2 hours — fire-and-forget
    void Promise.resolve(
      adminClient
        .from('meeting_transcripts')
        .update({ bot_state: 'failed', processed: true })
        .eq('user_id', user.id)
        .eq('processed', false)
        .eq('bot_state', 'processing')
        .lt('updated_at', new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString())
    ).catch(() => {});

    // 1. Own transcripts
    const { data: own, error } = await supabase
      .from('meeting_transcripts')
      .select(TRANSCRIPT_FIELDS)
      .eq('user_id', user.id)
      .order('start_time', { ascending: false })
      .limit(50);

    if (error) throw error;

    // 2. Shared with me by teammates in the same company
    const { data: memberships } = await supabase
      .from('company_members')
      .select('company_id')
      .eq('user_id', user.id)
      .eq('status', 'active');

    const companyIds = (memberships ?? []).map((m: any) => m.company_id);

    let sharedMapped: any[] = [];
    if (companyIds.length > 0) {
      // 'live' mode: any company member can access
      const { data: liveShared } = await adminClient
        .from('meeting_transcripts')
        .select(`${TRANSCRIPT_FIELDS}, profiles!meeting_transcripts_user_id_fkey(full_name), shared_note_receipts!left(folder_id, user_id)`)
        .eq('sharing_mode', 'live')
        .in('company_id', companyIds)
        .neq('user_id', user.id)
        .order('start_time', { ascending: false })
        .limit(30);

      // 'specific' mode: only users with a receipt row can access
      const { data: specificShared } = await adminClient
        .from('meeting_transcripts')
        .select(`${TRANSCRIPT_FIELDS}, profiles!meeting_transcripts_user_id_fkey(full_name), shared_note_receipts!inner(folder_id, user_id)`)
        .eq('sharing_mode', 'specific')
        .in('company_id', companyIds)
        .neq('user_id', user.id)
        .eq('shared_note_receipts.user_id', user.id)
        .order('start_time', { ascending: false })
        .limit(30);

      const toMapped = (rows: any[]) => rows.map((t: any) => {
        const myReceipt = (t.shared_note_receipts ?? []).find((r: any) => r.user_id === user.id);
        return {
          ...t,
          folder_id: myReceipt?.folder_id ?? null,
          is_shared_with_me: true,
          shared_by_name: t.profiles?.full_name ?? null,
          profiles: undefined,
          shared_note_receipts: undefined,
        };
      });

      sharedMapped = [...toMapped(liveShared ?? []), ...toMapped(specificShared ?? [])];
    }

    const ownMapped = (own ?? []).map((t) => ({ ...t, is_shared_with_me: false, shared_by_name: null }));

    // Merge, sort by start_time descending, cap at 60
    const all = [...ownMapped, ...sharedMapped]
      .sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime())
      .slice(0, 60)
      .map((t) => ({
        ...t,
        has_document: !!(t.notes_structured as any)?.document,
        notes_structured: undefined,
      }));

    return NextResponse.json({ transcripts: all });
  } catch (error) {
    console.error('[Meetings/Transcripts] Error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
