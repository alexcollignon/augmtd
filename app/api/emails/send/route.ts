import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { sendGmailEmail } from '@/lib/google/gmail';
import { sendOutlookEmail } from '@/lib/microsoft/outlook';
import { sendCoworkerEmail } from '@/lib/tools/coworker-email';
import { claimCommit, recordCommitResult, releaseCommitClaim } from '@/lib/work/commit-door';
import { readChatEmail, updateChatEmailPayload, markChatEmailSent } from '@/lib/prepare/chat-email-store';
import { emailBodyHTML, emailBodyText, type StandaloneEmailDraft } from '@/lib/prepare/email-card';
import { logActivity } from '@/lib/activity/log';
import { checkRateLimit } from '@/lib/utils/rate-limit';
import { sanitizeHeaderValue } from '@/lib/utils/email-headers';

export const maxDuration = 60;

// ════════════════════════════════════════════════════════════════════════════════════════════════
// POST /api/emails/send — the CHAT-BORN standalone email's commit door.
//
// ⚠️ SAFETY INVARIANT, identical to /api/items/execute and /api/invites/send: this route COMMITS an
// irreversible act (a real message to a real person). It fires ONLY from the user's own explicit
// Send click on the email card. Nothing here runs without that click; nothing chains into it; no
// model-reachable path calls it (the draft door returns a CARD and never a commit).
//
// THE SEND READS THE STORE, NEVER THE BODY (the invite door's law, one kind over). The card's edits
// are written to the stored payload first, under this door's own validation — a recipient must be a
// real address, and the FROM must be one of THIS user's own active mailboxes — and the send then
// re-reads the row and mails what the row says. A door that sends the fields a browser handed it is
// a door that can be told to mail anyone.
//
// TWO LANES, ONE DOOR. A mailbox lane sends AS THE USER through the connection they picked; with no
// connected mailbox at all the draft rides the OAuth-free coworker channel (the fallback
// /api/compose/send has always had) — stated on the card, never silently substituted.
// ════════════════════════════════════════════════════════════════════════════════════════════════

const EMAIL_RE = /^[^\s<>",;:]+@[^\s<>",;:]+\.[a-z]{2,}$/i;
const cleanList = (v: unknown, keep: string[]): string[] =>
  Array.isArray(v)
    ? [...new Set(v.map((s) => String(s ?? '').trim()).filter((a) => EMAIL_RE.test(a)))].slice(0, 20)
    : keep;

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const rl = checkRateLimit(`chat-email-send:${user.id}`, 10, 60_000);
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) } });
    }

    const body = (await request.json()) as {
      emailId?: string;
      edits?: { to?: unknown; cc?: unknown; subject?: string; body?: string; connectionId?: string };
    };
    const emailId = String(body.emailId ?? '').trim();
    if (!emailId) return NextResponse.json({ error: 'emailId required' }, { status: 400 });

    const stored = await readChatEmail(supabase, user.id, emailId);
    // Unknown / foreign / not-a-draft are ONE indistinguishable not-found (the share-door law).
    if (!stored) return NextResponse.json({ error: 'That draft is no longer available.' }, { status: 404 });
    if (stored.sentAt) return NextResponse.json({ ok: true, alreadyExecuted: true, result: 'Already sent.' });

    // ── THE EDITS LAND FIRST, each field on its own terms; anything absent keeps what was prepared.
    const e = body.edits ?? {};
    const options = stored.email.from?.options ?? [];
    // THE FROM IS THE USER'S OWN, ALWAYS: a picked id must name one of the mailboxes this draft was
    // prepared with (themselves read from this user's active connections). Anything else keeps the
    // prepared choice — a request body can never widen who the message can come from.
    const pickedId = typeof e.connectionId === 'string' && options.some((o) => o.id === e.connectionId)
      ? e.connectionId : stored.email.from?.selectedId ?? null;
    const merged: StandaloneEmailDraft = {
      ...stored.email,
      to: cleanList(e.to, stored.email.to ?? []),
      cc: cleanList(e.cc, stored.email.cc ?? []),
      // THE HEADER FLOOR at the door as well as the transport: a subject is ONE line, always. An
      // interior CR/LF used to survive `.trim().slice()` all the way into the RFC822 block.
      subject: sanitizeHeaderValue(typeof e.subject === 'string' ? e.subject : stored.email.subject ?? '', 300),
      body: typeof e.body === 'string' ? e.body.slice(0, 100_000) : stored.email.body ?? '',
      from: { ...stored.email.from, options, selectedId: pickedId },
    };

    // Approve-before-commit strictness: a card that isn't complete never mails a broken message.
    if (!merged.to.length) return NextResponse.json({ error: 'Add a recipient before it can send.' }, { status: 400 });
    if (!merged.subject) return NextResponse.json({ error: 'Add a subject before it can send.' }, { status: 400 });
    if (!emailBodyText(merged.body).trim()) return NextResponse.json({ error: 'The message is empty.' }, { status: 400 });

    await updateChatEmailPayload(supabase, user.id, emailId, merged);
    const record = await readChatEmail(supabase, user.id, emailId);
    const toSend = record?.email ?? merged;
    const viaCoworker = toSend.from?.viaCoworker === true || !toSend.from?.selectedId;

    // ── THE COMMIT DOOR — one atomic claim per irreversible act; a duplicate returns the prior
    // result and never mails twice.
    const idemKey = `chat_email:${emailId}`;
    const claim = await claimCommit(supabase, user.id, {
      idempotencyKey: idemKey, actionType: 'send_email',
      payload: { to: toSend.to, cc: toSend.cc, subject: toSend.subject, via: viaCoworker ? 'coworker' : 'mailbox' },
    });
    if (claim.status === 'duplicate') {
      return NextResponse.json({ ok: true, alreadyExecuted: true, result: claim.priorResult ?? 'Already sent.' });
    }

    let result = '';
    let failed = false;
    try {
      if (!viaCoworker) {
        const { data: conn } = await supabase.from('connections').select('*')
          .eq('id', toSend.from!.selectedId!).eq('user_id', user.id).eq('status', 'active').maybeSingle();
        if (!conn?.metadata?.tokens || (conn.provider !== 'gmail' && conn.provider !== 'outlook')) {
          failed = true; result = 'That mailbox is no longer connected.';
        } else {
          const args = {
            encryptedTokens: conn.metadata.tokens,
            to: toSend.to.join(', '),
            cc: toSend.cc.length ? toSend.cc.join(', ') : undefined,
            subject: toSend.subject,
            body: emailBodyHTML(toSend.body),
          };
          if (conn.provider === 'gmail') await sendGmailEmail(args);
          else await sendOutlookEmail(args);
          result = `Sent to ${toSend.to[0]}${toSend.to.length > 1 ? ` +${toSend.to.length - 1}` : ''}.`;
        }
      } else {
        // The OAuth-free channel escapes its body and lays out paragraphs itself, so it takes words.
        const admin = createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
        const { data: pa } = await admin.from('custom_agents').select('id')
          .eq('user_id', user.id).eq('is_worker', true).eq('worker_role', 'personal_assistant').maybeSingle();
        const res = await sendCoworkerEmail(admin, user.id, pa?.id, {
          to: toSend.to, cc: toSend.cc, subject: toSend.subject, body: emailBodyText(toSend.body).trim(),
        });
        failed = !res.ok;
        result = res.ok ? `Sent to ${toSend.to[0]} from your assistant's address.` : (res.error || 'Could not send the message.');
      }
    } catch (err) {
      failed = true;
      result = err instanceof Error ? err.message.slice(0, 300) : 'Could not send the message.';
    }

    // A failed commit RELEASES its claim — the send did not happen, and holding the key would wedge
    // the card behind a transient error.
    if (claim.status === 'claimed') {
      if (failed) await releaseCommitClaim(supabase, user.id, idemKey);
      else await recordCommitResult(supabase, user.id, idemKey, result);
    }
    if (failed) return NextResponse.json({ ok: false, error: result }, { status: 502 });
    await markChatEmailSent(supabase, user.id, emailId);

    await logActivity(supabase, user.id, {
      type: 'message_sent',
      title: `Sent to ${toSend.to[0]}${toSend.to.length > 1 ? ` +${toSend.to.length - 1}` : ''}`,
      entityType: 'chat_email',
      entityId: emailId,
      metadata: { via: viaCoworker ? 'coworker' : 'mailbox', recipients: toSend.to.length + toSend.cc.length, from: 'chat' },
    });

    return NextResponse.json({ ok: true, result, viaCoworker });
  } catch (error) {
    console.error('[emails/send] error:', error);
    return NextResponse.json({ error: 'Could not send the message.' }, { status: 500 });
  }
}
