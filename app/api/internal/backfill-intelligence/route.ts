import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { extractEmailCommitments, writeMeetingCommitments } from '@/lib/commitments/extract';
import { synthesizeVoiceProfile } from '@/lib/context/voice-profile';

export const maxDuration = 300;

// POST /api/internal/backfill-intelligence  (bearer CRON_SECRET)
// One-shot: run the new commitment extraction + voice synthesis over a user's EXISTING data
// (no delete, no re-sync). Body: { userId? , email?, days?, emailLimit? }.
function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

export async function POST(request: NextRequest) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { userId: bodyUserId, email, days = 30, emailLimit = 80 } = await request.json().catch(() => ({}));
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Resolve the user id (accept it directly, or look it up from a connection by email).
  let userId: string | null = bodyUserId ?? null;
  if (!userId && email) {
    const { data: conns } = await sb.from('connections').select('user_id, metadata').limit(1000);
    userId = (conns ?? []).find((c) => (c.metadata as { email?: string } | null)?.email?.toLowerCase() === String(email).toLowerCase())?.user_id ?? null;
  }
  if (!userId) return NextResponse.json({ error: 'user not found (pass userId or a connected email)' }, { status: 404 });

  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  // 1. Voice profile from sent emails
  const voice = await synthesizeVoiceProfile(userId, sb).catch(() => null);

  // 2. Commitments from existing emails (sent + received)
  const { data: emails } = await sb.from('emails')
    .select('id, subject, body, html_body, is_from_user, from_address, to_addresses, thread_id')
    .eq('user_id', userId).gte('received_at', since)
    .order('received_at', { ascending: false }).limit(emailLimit);
  let emailCommits = 0, emailsScanned = 0;
  for (const e of emails ?? []) {
    emailsScanned++;
    const body = (e.body && e.body.trim()) ? e.body : stripHtml(e.html_body || '');
    const n = await extractEmailCommitments({
      userId, subject: e.subject || '', body, isFromUser: !!e.is_from_user, userName: null,
      counterparty: e.is_from_user ? ((e.to_addresses as string[] | null)?.[0] || null) : (e.from_address || null),
      sourceId: e.id, threadId: e.thread_id || null, client: sb,
    }).catch(() => 0);
    emailCommits += n;
  }

  // 3. Commitments from existing meeting action items (inbox_items, source='meeting')
  const { data: mItems } = await sb.from('inbox_items')
    .select('work_title, source_meeting_transcript_id, source_data')
    .eq('user_id', userId).eq('source', 'meeting');
  const byMeeting = new Map<string, { action: string; assignee?: string | null; isUserTask: boolean; dueDate?: string | null }[]>();
  for (const it of mItems ?? []) {
    const tid = it.source_meeting_transcript_id;
    if (!tid) continue;
    const arr = byMeeting.get(tid) ?? [];
    arr.push({ action: it.work_title || 'Action item', isUserTask: true, dueDate: (it.source_data as { due_date?: string } | null)?.due_date ?? null });
    byMeeting.set(tid, arr);
  }
  let meetingsBackfilled = 0;
  for (const [tid, items] of byMeeting) {
    await writeMeetingCommitments(userId, items, { transcriptId: tid }, sb).catch(() => {});
    meetingsBackfilled++;
  }

  return NextResponse.json({
    userId, voiceBuilt: !!voice, emailsScanned, emailCommitsWritten: emailCommits,
    meetingsBackfilled,
  });
}
