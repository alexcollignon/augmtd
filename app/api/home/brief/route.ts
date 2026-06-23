import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSystemClient, aiCreate } from '@/lib/ai/factory';

export const maxDuration = 30;

// GET /api/home/brief — the day brief: what needs you, what's aging, today's meetings (with
// light prep), what was handled, + a cached one-line narration. Reconciles email + meetings +
// commitments. The coworker feed is fetched separately by the Home (reuses /api/workers/home).

const DAY = 86_400_000;
const BRIEF_TTL = 3 * 60 * 60 * 1000; // re-narrate at most every 3h

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function attendeeEmails(ev: any): string[] {
  return (ev?.attendees ?? []).map((a: any) => (a?.email || '').toLowerCase()).filter(Boolean);
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const endOfDay = `${todayStr}T23:59:59Z`;

  const [needsRes, commitsRes, meetingsRes, handledRes, profileRes] = await Promise.all([
    // Emails awaiting your reply
    supabase.from('inbox_items')
      .select('id, work_title, source_data, created_at')
      .eq('user_id', user.id).eq('status', 'pending').eq('work_state', 'action_required')
      .order('created_at', { ascending: false }).limit(8),
    // Open commitments (both directions)
    supabase.from('commitments').select('*').eq('user_id', user.id).eq('status', 'open'),
    // Today's remaining meetings
    supabase.from('calendar_events')
      .select('id, title, start_time, attendees')
      .eq('user_id', user.id).eq('status', 'confirmed')
      .gte('start_time', new Date(now.getTime() - 30 * 60_000).toISOString())
      .lte('start_time', endOfDay)
      .order('start_time', { ascending: true }).limit(6),
    // Handled in the last 24h (trust)
    supabase.from('commitments').select('id', { count: 'exact', head: true })
      .eq('user_id', user.id).eq('status', 'done').gte('updated_at', new Date(now.getTime() - DAY).toISOString()),
    supabase.from('profiles').select('full_name, home_brief').eq('id', user.id).single(),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const commits = (commitsRes.data ?? []) as any[];
  const youOwe = commits
    .filter((c) => c.direction === 'you_owe')
    .filter((c) => (c.due_date && c.due_date <= todayStr) || (now.getTime() - new Date(c.created_at).getTime()) >= 2 * DAY)
    .map((c) => ({ id: c.id, description: c.description, due_date: c.due_date, overdue: !!(c.due_date && c.due_date < todayStr), counterparty: c.counterparty }));
  const waitingOn = commits
    .filter((c) => c.direction === 'awaiting')
    .map((c) => ({ id: c.id, description: c.description, counterparty: c.counterparty, ageDays: Math.floor((now.getTime() - new Date(c.created_at).getTime()) / DAY) }))
    .filter((c) => c.ageDays >= 2)
    .sort((a, b) => b.ageDays - a.ageDays);

  const needsYou = (needsRes.data ?? []).map((i) => {
    const sd = (i.source_data ?? {}) as Record<string, unknown>;
    return { id: i.id, title: i.work_title || (sd.subject as string) || 'Email', from: (sd.from_name as string) || (sd.from as string) || null };
  });

  // Light, RIGHT-context prep for the next meeting only: who, your last thread with them, open commitments.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const meetings = (meetingsRes.data ?? []) as any[];
  let nextPrep: { lastEmail?: { subject: string; date: string }; openCommitments: string[] } | null = null;
  if (meetings[0]) {
    const emails = attendeeEmails(meetings[0]);
    const selfish = new Set([user.email?.toLowerCase()]);
    const others = emails.filter((e) => !selfish.has(e));
    if (others.length) {
      const [lastEmailRes] = await Promise.all([
        supabase.from('emails').select('subject, received_at')
          .eq('user_id', user.id).contains('to_addresses', [others[0]])
          .order('received_at', { ascending: false }).limit(1),
      ]);
      const le = lastEmailRes.data?.[0];
      const related = commits.filter((c) => others.includes((c.counterparty || '').toLowerCase())).map((c) => c.description);
      nextPrep = {
        ...(le ? { lastEmail: { subject: le.subject || '(no subject)', date: le.received_at } } : {}),
        openCommitments: related.slice(0, 3),
      };
    }
  }
  const today = meetings.map((m, i) => ({
    id: m.id, title: m.title || '(untitled)', start: m.start_time,
    attendees: attendeeEmails(m).filter((e) => e !== user.email?.toLowerCase()).length,
    prep: i === 0 ? nextPrep : null,
  }));

  // ── Cached one-line narration ──
  const fullName = (profileRes.data as { full_name?: string } | null)?.full_name ?? null;
  const firstName = fullName?.split(' ')[0] ?? null;
  const cached = (profileRes.data as { home_brief?: { text: string; generated_at: string } } | null)?.home_brief ?? null;
  let briefLine = cached?.text ?? null;
  const stale = !cached || (now.getTime() - new Date(cached.generated_at).getTime()) > BRIEF_TTL;
  if (stale) {
    try {
      const facts = [
        `${needsYou.length} email(s) need a reply`,
        youOwe.length ? `${youOwe.length} thing(s) you owe${youOwe.some((c) => c.overdue) ? ' (some overdue)' : ''}` : '',
        waitingOn.length ? `${waitingOn.length} you're waiting on (oldest ${waitingOn[0].ageDays}d)` : '',
        today.length ? `${today.length} meeting(s) today` : 'no meetings today',
      ].filter(Boolean).join('; ');
      const { client, model } = getSystemClient('summarization');
      const res = await aiCreate(client, {
        model, max_tokens: 90, temperature: 0.5,
        messages: [{ role: 'user', content: `Write ONE short, warm sentence to ${firstName || 'the user'} summarising their day from these facts. Lead with what matters (overdue / waiting). Natural, specific, no preamble, no "Here's". Facts: ${facts}.` }],
      });
      briefLine = res.choices?.[0]?.message?.content?.trim() || briefLine;
      if (briefLine) {
        await supabase.from('profiles').update({ home_brief: { text: briefLine, generated_at: now.toISOString() } }).eq('id', user.id).then(() => {}, () => {});
      }
    } catch { /* keep cached/none */ }
  }

  return NextResponse.json({
    firstName,
    briefLine,
    needsYou,
    youOwe,
    waitingOn,
    today,
    handled: { commitmentsClosed: handledRes.count ?? 0 },
  });
}
