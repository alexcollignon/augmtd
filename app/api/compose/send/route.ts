import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { sendGmailEmail } from '@/lib/google/gmail';
import { sendOutlookEmail } from '@/lib/microsoft/outlook';
import { sendCoworkerEmail } from '@/lib/tools/coworker-email';
import { logActivity } from '@/lib/activity/log';
import { checkRateLimit } from '@/lib/utils/rate-limit';

export const maxDuration = 30;

// ── Universal send — the counterpart of /api/compose/draft. Sends the composed message AS THE USER
// via their connected Gmail/Outlook mailbox (fresh email, not a thread reply). If no mailbox is
// connected, falls back to the OAuth-free coworker-email channel (Resend, team.augmtd.ai) and flags
// it so the UI can note "sent via your assistant's address". Logs a `message_sent` activity event.
//
// POST /api/compose/send { to[], cc[], subject, bodyHTML, threadId? }
//   → { success, viaCoworker?: boolean }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const cleanList = (v: unknown): string[] =>
  [...new Set((Array.isArray(v) ? v : []).map((s) => String(s).trim()).filter((e) => EMAIL_RE.test(e)))].slice(0, 20);

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const rl = checkRateLimit(`compose-send:${user.id}`, 10, 60_000);
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) } });
    }

    const raw = (await request.json()) as { to?: unknown; cc?: unknown; subject?: string; bodyHTML?: string };
    const to = cleanList(raw.to);
    const cc = cleanList(raw.cc);
    const subject = String(raw.subject ?? '').trim();
    const bodyHTML = String(raw.bodyHTML ?? '');
    const plain = bodyHTML.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

    if (to.length === 0) return NextResponse.json({ error: 'A recipient is required.' }, { status: 400 });
    if (!subject) return NextResponse.json({ error: 'A subject is required.' }, { status: 400 });
    if (!plain) return NextResponse.json({ error: 'The message body is empty.' }, { status: 400 });

    // Content-scoped idempotency: the identical message (same recipients + subject + body) can't be sent
    // twice inside 2 min — kills a transient double-fire/loop while a genuinely different message still
    // goes through. (Complements the coarse per-user rate limit above; mirrors the send-reply dedup.)
    const dedupHash = createHash('sha1').update(`${to.join(',')}|${cc.join(',')}|${subject}|${plain}`.toLowerCase()).digest('hex').slice(0, 16);
    if (!checkRateLimit(`compose-send-dedup:${user.id}:${dedupHash}`, 1, 120_000).allowed) {
      return NextResponse.json({ success: true, deduped: true });
    }

    // Prefer sending AS the user via a connected mailbox.
    const { data: connection } = await supabase
      .from('connections')
      .select('*')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .in('provider', ['gmail', 'outlook'])
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    let viaCoworker = false;

    if (connection?.metadata?.tokens && (connection.provider === 'gmail' || connection.provider === 'outlook')) {
      const args = {
        encryptedTokens: connection.metadata.tokens,
        to: to.join(', '),
        cc: cc.length ? cc.join(', ') : undefined,
        subject,
        body: bodyHTML,
      };
      if (connection.provider === 'gmail') await sendGmailEmail(args);
      else await sendOutlookEmail(args);
    } else {
      // Fallback: no connected mailbox → send from the coworker (Clara) address, Reply-To the user.
      viaCoworker = true;
      const admin = createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
      // Attribute to the user's personal assistant so the from-name + signature read sensibly.
      const { data: pa } = await admin
        .from('custom_agents')
        .select('id')
        .eq('user_id', user.id)
        .eq('is_worker', true)
        .eq('worker_role', 'personal_assistant')
        .maybeSingle();
      const res = await sendCoworkerEmail(admin, user.id, pa?.id, { to, cc, subject, body: plain });
      if (!res.ok) return NextResponse.json({ error: res.error || 'Could not send the message.' }, { status: 502 });
    }

    // Activity timeline (non-fatal).
    await logActivity(supabase, user.id, {
      type: 'message_sent',
      title: `Sent to ${to[0]}${to.length > 1 ? ` +${to.length - 1}` : ''}`,
      entityType: 'compose',
      entityId: null,
      metadata: { via: viaCoworker ? 'coworker' : (connection?.provider ?? 'mailbox'), recipients: to.length + cc.length },
    });

    return NextResponse.json({ success: true, viaCoworker });
  } catch (error) {
    console.error('[compose/send] error:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to send the message.' }, { status: 500 });
  }
}
