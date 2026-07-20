import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdmin } from '@supabase/supabase-js';
import { listTranscriptRows } from '@/lib/meetings/list-transcripts';

// GET /api/meetings/transcripts — own + shared-with-me, via the SHARED fetcher (identical to the SSR first
// paint), so shared meetings no longer "pop in" a beat after load. Caps live in list-transcripts.ts.
export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const adminClient = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

    // Auto-fail rows stuck in processing for > 2 hours — fire-and-forget.
    void Promise.resolve(
      adminClient.from('meeting_transcripts').update({ bot_state: 'failed', processed: true })
        .eq('user_id', user.id).eq('processed', false).eq('bot_state', 'processing')
        .lt('updated_at', new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString())
    ).catch(() => {});

    const transcripts = await listTranscriptRows(supabase, adminClient, user.id);
    return NextResponse.json({ transcripts });
  } catch (error) {
    console.error('[Meetings/Transcripts] Error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
