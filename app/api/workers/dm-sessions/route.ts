import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// GET /api/workers/dm-sessions?agent=<id> — the DM header's history (Aug 11, owner: "shouldn't
// there be a history button for these DM conversations?"). Past sessions with ONE coworker,
// under the user-voice law (only threads the user actually typed in), titled by their own
// first ask — the same titling law the Home chat rooms follow.
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const agentId = request.nextUrl.searchParams.get('agent');
    if (!agentId) return NextResponse.json({ error: 'agent required' }, { status: 400 });

    const { data: wts } = await supabase.from('work_threads')
      .select('id, title, updated_at')
      .eq('user_id', user.id).eq('agent_id', agentId).eq('status', 'active')
      .is('workflow_id', null)
      .or('is_temporary.eq.false,is_temporary.is.null')
      .not('title', 'like', 'Handed to %')
      .order('updated_at', { ascending: false }).limit(15);
    const rows = (wts ?? []) as Array<{ id: string; title: string | null; updated_at: string | null }>;
    if (!rows.length) return NextResponse.json({ sessions: [] });

    // First USER message per thread = the session's title; threads without one don't list.
    const { data: msgs } = await supabase.from('work_messages')
      .select('thread_id, content, created_at')
      .in('thread_id', rows.map((r) => r.id)).eq('role', 'user')
      .order('created_at', { ascending: true }).limit(400);
    const firstAsk = new Map<string, string>();
    for (const m of (msgs ?? []) as Array<{ thread_id: string; content: string | null }>) {
      if (!firstAsk.has(m.thread_id) && String(m.content ?? '').trim()) {
        firstAsk.set(m.thread_id, String(m.content).replace(/\s+/g, ' ').trim().slice(0, 70));
      }
    }
    const sessions = rows
      .filter((r) => firstAsk.has(r.id))
      .map((r) => ({ id: r.id, title: firstAsk.get(r.id)!, at: r.updated_at }));
    return NextResponse.json({ sessions });
  } catch (e) {
    console.error('[workers/dm-sessions] error:', e);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
