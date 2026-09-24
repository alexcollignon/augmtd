import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { sendGmailEmail } from '@/lib/google/gmail';
import { sendOutlookEmail } from '@/lib/microsoft/outlook';
import { sendCoworkerEmail } from '@/lib/tools/coworker-email';
import { logActivity } from '@/lib/activity/log';
import { checkRateLimit } from '@/lib/utils/rate-limit';
import { sanitizeHeaderValue } from '@/lib/utils/email-headers';
import { claimCommit, recordCommitResult, releaseCommitClaim } from '@/lib/work/commit-door';

/** The window a composed message is "the same deed" in: a double-fire inside it sends once; the
 *  identical message sent deliberately later is a new deed (a weekly reminder is not a duplicate). */
const COMPOSE_DEED_WINDOW_MS = 10 * 60_000;

export const maxDuration = 30;

// ── Universal send — the counterpart of /api/compose/draft. Sends the composed message AS THE USER
// via their connected Gmail/Outlook mailbox (fresh email, not a thread reply). If no mailbox is
// connected, falls back to the OAuth-free coworker-email channel (Resend, team.augmtd.ai) and flags
// it so the UI can note "sent via your assistant's address". Logs a `message_sent` activity event.
//
// POST /api/compose/send { to[], cc[], subject, bodyHTML, threadId?, stagedFileIds?, prepared? }
//   stagedFileIds = the card's staged-file chips (W13) — loaded server-side, attached all-or-nothing.
//   prepared = { itemKind: 'inbox'|'commitment'|'meeting', itemId, bodyHTML } — the drafter's text the
//   composer was seeded with (W3.2 — THE TWO-WAY LEDGER: accepted vs edited is measured against it).
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

    const raw = (await request.json()) as { to?: unknown; cc?: unknown; subject?: string; bodyHTML?: string; stagedFileIds?: unknown; prepared?: { itemKind?: unknown; itemId?: unknown; bodyHTML?: unknown } | null };
    const to = cleanList(raw.to);
    const cc = cleanList(raw.cc);
    // THE HEADER FLOOR — one line, no control characters (the same class the chat-born door fixed).
    const subject = sanitizeHeaderValue(raw.subject, 300);
    const bodyHTML = String(raw.bodyHTML ?? '');
    const plain = bodyHTML.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

    if (to.length === 0) return NextResponse.json({ error: 'A recipient is required.' }, { status: 400 });
    if (!subject) return NextResponse.json({ error: 'A subject is required.' }, { status: 400 });
    if (!plain) return NextResponse.json({ error: 'The message body is empty.' }, { status: 400 });

    // W13 · A CLAIM RENDERS — the card's STAGED chips ride as ids and load HERE through THE ONE loader
    // (lib/knowledge/kb-attachment): the send attaches exactly what the chip showed, all or nothing,
    // before any claim. The assistant-address fallback cannot carry files — it refuses rather than
    // dropping them (a message that says "attached" must arrive with its attachment).
    const { stagedFileIdsOf, loadStagedAttachments } = await import('@/lib/knowledge/kb-attachment');
    const stagedIds = stagedFileIdsOf(raw.stagedFileIds);
    let attachments: import('@/lib/google/gmail').EmailAttachment[] = [];
    if (stagedIds.length) {
      const loaded = await loadStagedAttachments(supabase, user.id, stagedIds);
      if (!loaded.ok) return NextResponse.json({ error: loaded.error }, { status: 422 });
      attachments = loaded.files;
    }

    // Content-scoped idempotency: the identical message (same recipients + subject + body) can't be sent
    // twice inside 2 min — kills a transient double-fire/loop while a genuinely different message still
    // goes through. (Complements the coarse per-user rate limit above; mirrors the send-reply dedup.)
    const dedupHash = createHash('sha1').update(`${to.join(',')}|${cc.join(',')}|${subject}|${plain}|${stagedIds.join(',')}`.toLowerCase()).digest('hex').slice(0, 16);

    // ── THE COMMIT DOOR (W0.4 — EXACTLY-ONCE DEEDS). The old in-memory dedup only caught a burst on
    // one warm instance; the claim is ONE atomic insert keyed by the message + its time window. The
    // PREVIOUS window's key is read too, so a double-fire straddling a window edge still sends once.
    const bucket = Math.floor(Date.now() / COMPOSE_DEED_WINDOW_MS);
    const idemKey = `compose:${dedupHash}:${bucket}`;
    {
      const { data: prev } = await supabase.from('action_commits').select('created_at')
        .eq('user_id', user.id).eq('idempotency_key', `compose:${dedupHash}:${bucket - 1}`).maybeSingle();
      if (prev?.created_at && Date.now() - Date.parse(String(prev.created_at)) < 120_000) {
        return NextResponse.json({ success: true, deduped: true });
      }
    }
    const claim = await claimCommit(supabase, user.id, {
      idempotencyKey: idemKey, actionType: 'compose_send',
      payload: { to, cc, subject },
    });
    if (claim.status === 'duplicate') {
      if (claim.priorResult == null) {
        return NextResponse.json({ error: 'That message is already on its way.' }, { status: 409 });
      }
      return NextResponse.json({ success: true, deduped: true });
    }
    const release = async () => { if (claim.status === 'claimed') await releaseCommitClaim(supabase, user.id, idemKey); };

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
        ...(attachments.length ? { attachments } : {}),
      };
      try {
        if (connection.provider === 'gmail') await sendGmailEmail(args);
        else await sendOutlookEmail(args);
      } catch (sendErr) {
        // A FAILED SEND RELEASES ITS CLAIM — nothing left, so a retry must be able to fire.
        await release();
        throw sendErr;
      }
    } else {
      if (attachments.length) {
        await release();
        return NextResponse.json({ error: 'Attachments need your connected mailbox — connect one, or remove the file from the message.' }, { status: 422 });
      }
      // Fallback: no connected mailbox → send from the coworker (Clara) address, Reply-To the user.
      viaCoworker = true;
      const admin = createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
      // Attribute to the user's chief of staff so the from-name + signature read sensibly.
      const { data: pa } = await admin
        .from('custom_agents')
        .select('id')
        .eq('user_id', user.id)
        .eq('is_worker', true)
        .eq('worker_role', 'personal_assistant')
        .maybeSingle();
      const res = await sendCoworkerEmail(admin, user.id, pa?.id, { to, cc, subject, body: plain })
        .catch(async (e) => { await release(); throw e; });
      if (!res.ok) {
        await release();
        return NextResponse.json({ error: res.error || 'Could not send the message.' }, { status: 502 });
      }
    }
    if (claim.status === 'claimed') {
      await recordCommitResult(supabase, user.id, idemKey, `Sent to ${to[0]}${viaCoworker ? ' (assistant address)' : ''}`);
    }

    // Activity timeline (non-fatal).
    await logActivity(supabase, user.id, {
      type: 'message_sent',
      title: `Sent to ${to[0]}${to.length > 1 ? ` +${to.length - 1}` : ''}`,
      entityType: 'compose',
      entityId: null,
      metadata: { via: viaCoworker ? 'coworker' : (connection?.provider ?? 'mailbox'), recipients: to.length + cc.length, ...(attachments.length ? { attachments: attachments.map((a) => a.filename) } : {}) },
    });

    // THE OUTCOME LOG (W3.2 — THE TWO-WAY LEDGER): when the composer was seeded by our drafter, the
    // send is that preparation's fate — as drafted (accepted) or changed (edited). The draft is
    // on-demand (never stored), so the composer hands back the text it was seeded with; the item it
    // belongs to is the ledger's key. Absent/garbled → nothing logged (never a guessed row).
    {
      const p = raw.prepared;
      const kind = p && ['inbox', 'commitment', 'meeting'].includes(String(p.itemKind)) ? String(p.itemKind) as 'inbox' | 'commitment' | 'meeting' : null;
      const itemId = p && typeof p.itemId === 'string' && /^[0-9a-f-]{8,64}$/i.test(p.itemId) ? p.itemId : null;
      const seeded = p && typeof p.bodyHTML === 'string' ? p.bodyHTML : '';
      if (kind && itemId && seeded.replace(/<[^>]*>/g, '').trim()) {
        const { logPreparedOutcome, sendVerdict } = await import('@/lib/prepare/outcome');
        const v = sendVerdict(seeded, bodyHTML);
        await logPreparedOutcome(supabase, user.id, {
          outcome: v.outcome, artifact: 'reply_draft', itemKind: kind, itemId,
          ...(v.editShare !== undefined ? { editShare: v.editShare } : {}),
          door: 'compose_send', senderClass: 'unknown',
        });
      }
    }

    return NextResponse.json({ success: true, viaCoworker });
  } catch (error) {
    console.error('[compose/send] error:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to send the message.' }, { status: 500 });
  }
}
