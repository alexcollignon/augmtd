import { NextRequest, NextResponse, after } from 'next/server';
import { noteItemAction } from '@/lib/entities/on-action';
import { createHash } from 'crypto';
import { createClient } from '@/lib/supabase/server';
import { sendGmailReply, EmailAttachment } from '@/lib/google/gmail';
import { sendOutlookReply } from '@/lib/microsoft/outlook';
import { ContextService } from '@/lib/context/context-service';
import { logActivity } from '@/lib/activity/log';
import { resolveConnectionForItem } from '@/lib/inbox/resolve-connection';
import { checkRateLimit } from '@/lib/utils/rate-limit';

// Plain-text, whitespace-normalised view of a draft for comparing AI vs sent.
const norm = (s: string) => s.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const DEDUP_WINDOW_MS = 120_000; // a reply is meant once per (item, body); a burst inside 2 min is a loop

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const { customMessage, aiDraft, attachments: rawAttachments, cc, bcc, to } = await request.json();
    const attachments: EmailAttachment[] = (rawAttachments || []).map((a: { filename: string; content: string; mimeType: string }) => ({
      filename: a.filename,
      content: Buffer.from(a.content, 'base64'),
      mimeType: a.mimeType,
    }));

    // Get inbox item with draft
    const { data: item, error: fetchError } = await supabase
      .from('inbox_items')
      .select('*')
      .eq('id', id)
      .eq('user_id', user.id)
      .single();

    if (fetchError || !item) {
      return NextResponse.json(
        { error: 'Inbox item not found' },
        { status: 404 }
      );
    }

    const sourceData = item.source_data;

    // ── Idempotency guard against duplicate / looping sends. We observed a transient client loop fire the
    // SAME reply ~19× at 2–3s intervals to one thread (which then inflated the day-cleared ring and, worse,
    // actually delivered ~50 duplicate emails). A reply is only ever meant ONCE per (item, body): dedup on
    // a content hash so a burst can't send twice, while a genuinely DIFFERENT follow-up — or the same text
    // sent much later — still goes through. Two layers: an in-memory guard (catches a burst hitting the
    // same warm serverless instance) + a DB-stamped backstop on source_data (survives cold starts / spans
    // instances). Either match within the 2-min window → an idempotent no-op (no send, no re-resolve).
    const bodyHash = createHash('sha1').update(norm(customMessage || '')).digest('hex').slice(0, 16);
    const lastAt = sourceData?.last_reply_at ? Date.parse(sourceData.last_reply_at) : 0;
    const dbDuplicate = !!lastAt && Date.now() - lastAt < DEDUP_WINDOW_MS && sourceData?.last_reply_hash === bodyHash;
    const memGuard = checkRateLimit(`send-reply:${user.id}:${id}:${bodyHash}`, 1, DEDUP_WINDOW_MS);
    if (dbDuplicate || !memGuard.allowed) {
      console.warn('[SendReply] deduped a duplicate/looping send for item', id);
      return NextResponse.json({ success: true, deduped: true });
    }

    // Get user's email connection — prefer connection_id FK, else recipient-aware provider resolution
    // (so a user with two accounts of the same provider replies from the mailbox the mail arrived on).
    const connection = await resolveConnectionForItem(supabase, user.id, item);

    if (!connection) {
      console.error('[SendReply] No connection found for item', id, 'provider:', sourceData.provider);
      return NextResponse.json({ error: 'Email connection not found' }, { status: 404 });
    }

    const messageBody = customMessage;

    // Send reply based on provider
    let sentMessageId: string;

    if (sourceData.provider === 'gmail') {
      sentMessageId = await sendGmailReply({
        encryptedTokens: connection.metadata.tokens,
        threadId: sourceData.thread_id,
        messageId: sourceData.message_id,
        to: to || sourceData.from,
        subject: sourceData.subject,
        body: messageBody,
        inReplyTo: sourceData.message_id,
        references: sourceData.references,
        attachments,
        cc: cc || undefined,
        bcc: bcc || undefined,
      });
    } else if (sourceData.provider === 'outlook') {
      // Graph API needs the internal Outlook ID (not the RFC 2822 internet message ID).
      // Look it up from the emails table where it's stored in metadata.outlook_id.
      let outlookMessageId = sourceData.message_id;
      if (sourceData.email_id) {
        const { data: email } = await supabase
          .from('emails')
          .select('metadata')
          .eq('id', sourceData.email_id)
          .single();
        if (email?.metadata?.outlook_id) {
          outlookMessageId = email.metadata.outlook_id;
        }
      }
      sentMessageId = await sendOutlookReply({
        encryptedTokens: connection.metadata.tokens,
        messageId: outlookMessageId,
        body: messageBody,
        attachments,
        to: to || undefined,
        cc: cc || undefined,
        bcc: bcc || undefined,
      });
    } else {
      return NextResponse.json(
        { error: 'Unsupported provider' },
        { status: 400 }
      );
    }

    // Log learning signal
    const { error: signalError } = await supabase.from('learning_signals').insert({
      user_id: user.id,
      inbox_item_id: id,
      signal_type: 'reply_sent',
      signal_data: {
        action_taken: 'reply_sent',
        sent_message_id: sentMessageId,
        used_ai_draft: !customMessage,
        modified: !!customMessage,
        provider: sourceData.provider,
        work_state: item.work_state,
        suggestion_level: item.recipient_context?.suggestionLevel,
        completed_at: new Date().toISOString(),
      },
    });

    if (signalError) {
      console.error('Error logging learning signal:', signalError);
      // Don't fail the request, just log the error
    }

    // Voice learning: if the user edited our AI draft before sending, capture the delta —
    // this is the single richest signal for learning their voice (was previously never logged).
    if (typeof aiDraft === 'string' && aiDraft.trim() && norm(aiDraft) !== norm(customMessage || '')) {
      ContextService.logDraftEdit(user.id, id, norm(aiDraft), norm(customMessage || '')).catch(() => {});
    }

    // Resolution-on-reply: the loop is closed — clear this item so it leaves "Needs reply"
    // (inbox + Home). Replying ≠ reading; this fires only on an actual sent reply. Stamp
    // source_data.resolved_at — the REAL resolution timestamp the Day-cleared ring counts by.
    await supabase.from('inbox_items')
      .update({ status: 'completed', source_data: { ...sourceData, resolved_at: new Date().toISOString(), last_reply_hash: bodyHash, last_reply_at: new Date().toISOString() } })
      .eq('id', id).eq('user_id', user.id);

    // Swap the mailbox label to AUGMTD/Done (honors auto_label). Non-fatal, after() so it never
    // blocks the send response. We have the connection + thread id already, but reconcileItemLabel
    // re-resolves them cheaply from the item for a single code path.
    after(async () => {
      // L2 ACTION EVENT — the brain hears this send (entity re-synthesis + brief-cache bust).
      await noteItemAction(supabase, user.id, { kind: 'inbox_item', id }).catch(() => {});
      const { reconcileItemLabel } = await import('@/lib/inbox/reconcile-item-label');
      await reconcileItemLabel({ userId: user.id, itemId: id, item, targetLabel: 'done', client: supabase });
      // LIVE Initiative Brain (S5) — you just sent on this thread → refresh its initiative's state (whoOwes
      // flips, momentum moves). Background, sig-gated, non-fatal.
      const init = (sourceData as { understanding?: { initiative?: string } } | null)?.understanding?.initiative;
      // LIVE Person Brain (S1b) — you just replied to this person → refresh their state (you no longer owe;
      // momentum/last-touch move). Sig-gated, non-fatal, degrades to no-op pre-migration.
      const recip = (to as string) || (sourceData as { from?: string } | null)?.from;
      if (recip) { try { const { refreshPersonStates } = await import('@/lib/people/state-store'); await refreshPersonStates(supabase, user.id, [recip]); } catch { /* non-fatal */ } }
    });

    // Chain handoff: a promise inside the reply ("I'll send X Friday") becomes a follow-up
    // immediately — don't wait for the next sync. Gated on the user's To-do capture setting.
    void (async () => {
      const { getEmailSettings } = await import('@/lib/inbox/email-settings');
      const settings = await getEmailSettings(user.id, supabase);
      if (!settings.todo_auto) return;
      const { extractEmailCommitments } = await import('@/lib/commitments/extract');
      await extractEmailCommitments({
        userId: user.id, subject: sourceData.subject || '', body: norm(messageBody || ''),
        isFromUser: true, userName: null,
        counterparty: to || sourceData.from || null,
        sourceId: sentMessageId, threadId: sourceData.thread_id || null,
        instructions: settings.todo_instructions, client: supabase,
      });
    })().catch(() => {});

    // Activity timeline (non-fatal). "Replied to <who>" — recipient, sender name, or subject.
    const who = (() => {
      const pick = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : '');
      return pick(to) || pick(sourceData.from_name) || pick(sourceData.from) || pick(sourceData.subject) || 'a message';
    })();
    await logActivity(supabase, user.id, {
      type: 'reply_sent',
      title: `Replied to ${who}`,
      entityType: 'inbox_item',
      entityId: id,
      metadata: { provider: sourceData.provider, used_ai_draft: !customMessage },
    });

    return NextResponse.json({
      success: true,
      sentMessageId,
      usedAiDraft: !customMessage,
    });

  } catch (error) {
    console.error('Send reply error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to send reply' },
      { status: 500 }
    );
  }
}
