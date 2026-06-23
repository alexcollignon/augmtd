import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSystemClient, aiCreate } from '@/lib/ai/factory';

export const maxDuration = 30;

// GET /api/home/brief — the day brief, LAYERED by topic (not a flat task list).
// A meeting with N action items is ONE card (items nested); commitments group under their
// source; emails are one card per thread. The Home stays a brief, not a backlog.

const DAY = 86_400_000;
const BRIEF_TTL = 3 * 60 * 60 * 1000;
const MAX_PRIORITIES = 6;

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
  const self = user.email?.toLowerCase();

  const [itemsRes, commitsRes, meetingsRes, handledRes, profileRes] = await Promise.all([
    supabase.from('inbox_items')
      .select('id, work_title, source, source_id, source_meeting_transcript_id, source_data, created_at')
      .eq('user_id', user.id).eq('status', 'pending').eq('work_state', 'action_required')
      .order('created_at', { ascending: false }).limit(40),
    supabase.from('commitments').select('*').eq('user_id', user.id).eq('status', 'open'),
    supabase.from('calendar_events')
      .select('id, title, start_time, attendees')
      .eq('user_id', user.id).eq('status', 'confirmed')
      .gte('start_time', new Date(now.getTime() - 30 * 60_000).toISOString())
      .lte('start_time', endOfDay).order('start_time', { ascending: true }).limit(6),
    supabase.from('commitments').select('id', { count: 'exact', head: true })
      .eq('user_id', user.id).eq('status', 'done').gte('updated_at', new Date(now.getTime() - DAY).toISOString()),
    supabase.from('profiles').select('full_name, home_brief').eq('id', user.id).single(),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items = (itemsRes.data ?? []) as any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const commits = (commitsRes.data ?? []) as any[];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Priority = { id: string; type: 'email' | 'meeting' | 'commitment'; title: string; context: string | null; href: string; itemId?: string; items?: { id: string; text: string }[]; overdue?: boolean };
  const priorities: Priority[] = [];

  // ── Meetings: group action items under their meeting (LAYERED — one card, items nested) ──
  const byMeeting = new Map<string, { title: string; items: { id: string; text: string }[] }>();
  for (const it of items) {
    if (it.source === 'meeting' && it.source_meeting_transcript_id) {
      const key = it.source_meeting_transcript_id;
      const m = byMeeting.get(key) ?? { title: (it.source_data?.meeting_title as string) || 'Meeting', items: [] };
      m.items.push({ id: it.id, text: it.work_title || 'Action item' });
      byMeeting.set(key, m);
    }
  }
  for (const [tid, m] of byMeeting) {
    priorities.push({
      id: `meeting:${tid}`, type: 'meeting', title: m.title,
      context: `${m.items.length} action item${m.items.length > 1 ? 's' : ''} from this meeting`,
      href: `/meetings`, items: m.items.slice(0, 6),
    });
  }

  // ── Emails needing a reply: one card per item (thread-level) ──
  for (const it of items) {
    if (it.source === 'meeting' || it.source === 'commitment') continue;
    const sd = (it.source_data ?? {}) as Record<string, unknown>;
    priorities.push({
      id: `email:${it.id}`, type: 'email',
      title: it.work_title || (sd.subject as string) || 'Email',
      context: (sd.from_name as string) || (sd.from as string) || null,
      href: '/inbox', itemId: it.id,
    });
  }

  // ── Commitments you owe (email/standalone — meeting ones already nested above) ──
  const youOwe = commits
    .filter((c) => c.direction === 'you_owe' && c.source !== 'meeting')
    .filter((c) => (c.due_date && c.due_date <= todayStr) || (now.getTime() - new Date(c.created_at).getTime()) >= 2 * DAY);
  for (const c of youOwe) {
    priorities.push({
      id: `commit:${c.id}`, type: 'commitment', title: c.description,
      context: `You owe${c.counterparty ? ` ${c.counterparty}` : ''}${c.due_date ? ` · due ${c.due_date}` : ''}`,
      href: '/inbox', overdue: !!(c.due_date && c.due_date < todayStr),
    });
  }

  // Overdue first, then meetings, then emails. Cap.
  priorities.sort((a, b) => Number(!!b.overdue) - Number(!!a.overdue));
  const cappedPriorities = priorities.slice(0, MAX_PRIORITIES);

  // ── Waiting on others (compact, not bloated) ──
  const waitingOn = commits
    .filter((c) => c.direction === 'awaiting')
    .map((c) => ({ id: c.id, description: c.description, counterparty: c.counterparty, ageDays: Math.floor((now.getTime() - new Date(c.created_at).getTime()) / DAY) }))
    .filter((c) => c.ageDays >= 2).sort((a, b) => b.ageDays - a.ageDays).slice(0, 4);

  // ── Today's schedule + light prep on the next meeting ──
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const meetings = (meetingsRes.data ?? []) as any[];
  let nextPrep: { lastEmail?: { subject: string }; openCommitments: string[] } | null = null;
  if (meetings[0]) {
    const others = attendeeEmails(meetings[0]).filter((e) => e !== self);
    if (others.length) {
      const { data: le } = await supabase.from('emails').select('subject')
        .eq('user_id', user.id).contains('to_addresses', [others[0]])
        .order('received_at', { ascending: false }).limit(1);
      const related = commits.filter((c) => others.includes((c.counterparty || '').toLowerCase())).map((c) => c.description);
      nextPrep = { ...(le?.[0] ? { lastEmail: { subject: le[0].subject || '(no subject)' } } : {}), openCommitments: related.slice(0, 3) };
    }
  }
  const schedule = meetings.map((m, i) => ({
    id: m.id, time: m.start_time, title: m.title || '(untitled)',
    attendees: attendeeEmails(m).filter((e) => e !== self).length,
    prep: i === 0 ? nextPrep : null,
  }));

  // ── Status chips (live, alive) ──
  const emailCount = items.filter((it) => it.source !== 'meeting' && it.source !== 'commitment').length;
  const status = {
    needsReply: emailCount,
    meetingsToday: schedule.length,
    waitingOn: commits.filter((c) => c.direction === 'awaiting').length,
    handledToday: handledRes.count ?? 0,
  };

  // ── Cached one-line narration (type-aware + busts when the day's shape changes) ──
  const emailP = cappedPriorities.filter((p) => p.type === 'email').length;
  const meetingP = cappedPriorities.filter((p) => p.type === 'meeting').length;
  const commitP = cappedPriorities.filter((p) => p.type === 'commitment').length;
  const overdueP = cappedPriorities.filter((p) => p.overdue).length;
  const sig = `${emailP}|${meetingP}|${commitP}|${overdueP}|${status.waitingOn}|${schedule.length}`;

  const fullName = (profileRes.data as { full_name?: string } | null)?.full_name ?? null;
  const firstName = fullName?.split(' ')[0] ?? null;
  const cached = (profileRes.data as { home_brief?: { text: string; generated_at: string; sig?: string } } | null)?.home_brief ?? null;
  let briefLine = cached?.text ?? null;
  const stale = !cached || cached.sig !== sig || (now.getTime() - new Date(cached.generated_at).getTime()) > BRIEF_TTL;
  if (stale) {
    try {
      const facts = [
        emailP ? `${emailP} email${emailP > 1 ? 's' : ''} to reply to` : '',
        meetingP ? `${meetingP} meeting${meetingP > 1 ? 's' : ''} with action items to follow up on` : '',
        commitP ? `${commitP} commitment${commitP > 1 ? 's' : ''} you owe${overdueP ? ' (some overdue)' : ''}` : '',
        status.waitingOn ? `${status.waitingOn} thing${status.waitingOn > 1 ? 's' : ''} you're waiting on others for` : '',
        status.meetingsToday ? `${status.meetingsToday} meeting${status.meetingsToday > 1 ? 's' : ''} scheduled today` : 'no meetings scheduled today',
        !cappedPriorities.length && !status.waitingOn ? 'nothing urgent needs you' : '',
      ].filter(Boolean).join('; ');
      const { client, model } = getSystemClient('summarization');
      const res = await aiCreate(client, {
        model, max_tokens: 90, temperature: 0.5,
        messages: [{ role: 'user', content: `One short, warm sentence to ${firstName || 'the user'} summarising their day. Lead with what matters most. Be precise — do NOT call meeting action items "emails". Natural, no preamble, no "Here's". Facts: ${facts}.` }],
      });
      briefLine = res.choices?.[0]?.message?.content?.trim() || briefLine;
      if (briefLine) await supabase.from('profiles').update({ home_brief: { text: briefLine, generated_at: now.toISOString(), sig } }).eq('id', user.id).then(() => {}, () => {});
    } catch { /* keep */ }
  }

  return NextResponse.json({ firstName, briefLine, status, priorities: cappedPriorities, waitingOn, schedule });
}
