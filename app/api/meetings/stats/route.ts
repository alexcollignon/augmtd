import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// GET /api/meetings/stats
// Returns stats bar data for the meetings hub page
export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay()); // Sunday
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 7);

    // Meetings this week (from calendar)
    const { count: meetingsThisWeek } = await supabase
      .from('calendar_events')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('status', 'confirmed')
      .gte('start_time', weekStart.toISOString())
      .lt('start_time', weekEnd.toISOString());

    // Transcripts needing review (processed but no work items generated)
    const { count: needsReview } = await supabase
      .from('meeting_transcripts')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('processed', true)
      .eq('work_items_generated', 0);

    // Actions extracted this week from meetings
    const { count: actionsExtracted } = await supabase
      .from('inbox_items')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('source', 'meeting')
      .gte('created_at', weekStart.toISOString());

    // Linked to processes: transcripts whose title shares tokens with any active process
    const { data: transcripts } = await supabase
      .from('meeting_transcripts')
      .select('title')
      .eq('user_id', user.id)
      .limit(100);

    const { data: processes } = await supabase
      .from('processes')
      .select('title')
      .eq('created_by', user.id)
      .limit(50);

    let linkedToProcesses = 0;
    if (transcripts && processes) {
      const processTokenSets = processes.map((p) =>
        new Set(
          p.title.split(/\s+/)
            .map((w: string) => w.replace(/[^a-zA-Z0-9]/g, '').toLowerCase())
            .filter((w: string) => w.length > 3)
        )
      );
      for (const t of transcripts) {
        const meetingTokens = t.title.split(/\s+/)
          .map((w: string) => w.replace(/[^a-zA-Z0-9]/g, '').toLowerCase())
          .filter((w: string) => w.length > 3);
        const linked = processTokenSets.some((set) =>
          meetingTokens.some((tok: string) => set.has(tok))
        );
        if (linked) linkedToProcesses++;
      }
    }

    return NextResponse.json({
      meetingsThisWeek: meetingsThisWeek ?? 0,
      needsReview: needsReview ?? 0,
      linkedToProcesses,
      actionsExtracted: actionsExtracted ?? 0,
    });
  } catch (error) {
    console.error('[Meetings/Stats] Error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
