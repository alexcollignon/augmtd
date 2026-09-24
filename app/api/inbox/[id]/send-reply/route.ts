import { NextRequest, NextResponse, after } from 'next/server';
import { noteItemAction } from '@/lib/entities/on-action';
import { createHash } from 'crypto';
import { createClient } from '@/lib/supabase/server';
import { sendGmailReply, EmailAttachment } from '@/lib/google/gmail';
import { sendOutlookReply } from '@/lib/microsoft/outlook';
import { ContextService } from '@/lib/context/context-service';
import { logActivity } from '@/lib/activity/log';
import { resolveConnectionForItem } from '@/lib/inbox/resolve-connection';
import { claimCommit, recordCommitResult, releaseCommitClaim } from '@/lib/work/commit-door';

// THE AFTER() BUDGET (W0.4): the after() block re-authors the room brief (AI) and reconciles labels —
// it must not die at the platform default.
export const maxDuration = 120;

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
    const { customMessage, aiDraft, attachments: rawAttachments, stagedFileIds: rawStaged, cc, bcc, to } = await request.json();
    const attachments: EmailAttachment[] = (rawAttachments || []).map((a: { filename: string; content: string; mimeType: string }) => ({
      filename: a.filename,
      content: Buffer.from(a.content, 'base64'),
      mimeType: a.mimeType,
    }));
    // W13 · A CLAIM RENDERS — the card's STAGED chips (the prepared file the draft says is attached)
    // ride as ids and are loaded HERE through THE ONE loader: the send attaches exactly what the chip
    // showed, all or nothing (a file that cannot load refuses the send, naming it — before any claim).
    {
      const { stagedFileIdsOf, loadStagedAttachments } = await import('@/lib/knowledge/kb-attachment');
      const ids = stagedFileIdsOf(rawStaged);
      if (ids.length) {
        const loaded = await loadStagedAttachments(supabase, user.id, ids);
        if (!loaded.ok) return NextResponse.json({ error: loaded.error }, { status: 422 });
        attachments.push(...loaded.files);
      }
    }

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
    // sent much later — still goes through. The DB-stamped backstop on source_data stays (a match inside
    // the 2-min window → an idempotent no-op); the atomic guarantee is THE COMMIT DOOR below (W0.4 —
    // the in-memory limiter only ever caught a burst on one warm instance).
    const bodyHash = createHash('sha1').update(norm(customMessage || '')).digest('hex').slice(0, 16);
    const lastAt = sourceData?.last_reply_at ? Date.parse(sourceData.last_reply_at) : 0;
    const dbDuplicate = !!lastAt && Date.now() - lastAt < DEDUP_WINDOW_MS && sourceData?.last_reply_hash === bodyHash;
    if (dbDuplicate) {
      console.warn('[SendReply] deduped a duplicate/looping send for item', id);
      return NextResponse.json({ success: true, deduped: true });
    }

    // ── THE COMMIT DOOR (W0.4 — EXACTLY-ONCE DEEDS). The read-then-write hash above and the old
    // in-memory limiter both let two concurrent requests through (each read "not sent yet"); the
    // claim is ONE atomic insert. The key carries the thread's CURRENT ground (its last activity):
    // a double-click on the same state sends once, while the same words answering a NEW inbound
    // later are a new deed, never a swallowed duplicate.
    const ground = String(item.last_activity_at ?? sourceData?.received_at ?? item.created_at ?? '');
    const recipients = createHash('sha1').update(JSON.stringify([to ?? '', cc ?? '', bcc ?? ''])).digest('hex').slice(0, 8);
    const idemKey = `reply:${id}:${bodyHash}:${recipients}:${ground}`;
    const claim = await claimCommit(supabase, user.id, {
      idempotencyKey: idemKey, actionType: 'send_reply',
      payload: { itemId: id, to: to ?? sourceData?.from ?? null, cc: cc ?? null, provider: sourceData?.provider ?? null },
    });
    if (claim.status === 'duplicate') {
      if (claim.priorResult == null) {
        return NextResponse.json({ error: 'That reply is already on its way.' }, { status: 409 });
      }
      return NextResponse.json({ success: true, deduped: true });
    }
    const release = async () => { if (claim.status === 'claimed') await releaseCommitClaim(supabase, user.id, idemKey); };

    // Get user's email connection — prefer connection_id FK, else recipient-aware provider resolution
    // (so a user with two accounts of the same provider replies from the mailbox the mail arrived on).
    const connection = await resolveConnectionForItem(supabase, user.id, item);

    if (!connection) {
      console.error('[SendReply] No connection found for item', id, 'provider:', sourceData.provider);
      await release();
      return NextResponse.json({ error: 'Email connection not found' }, { status: 404 });
    }

    const messageBody = customMessage;

    // Send reply based on provider
    let sentMessageId: string;

    try {
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
        await release();
        return NextResponse.json(
          { error: 'Unsupported provider' },
          { status: 400 }
        );
      }
    } catch (sendErr) {
      // A FAILED SEND RELEASES ITS CLAIM — nothing left the mailbox, so a retry must be able to fire.
      await release();
      throw sendErr;
    }
    if (claim.status === 'claimed') await recordCommitResult(supabase, user.id, idemKey, `Reply sent (${sentMessageId || 'ok'})`);

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

    // THE OUTCOME LOG (proactive-team R1 → W3.2 THE TWO-WAY LEDGER) — the prepared reply's fate,
    // stamped at its resolution moment: sent verbatim (accepted) or changed first (edited, with a
    // rough edit share). THE PREPARED TEXT is the one the client seeded (`aiDraft`) — else the
    // server's own STORED unsent draft: a surface that posts without `aiDraft` (the stage send did,
    // for weeks — every accept/edit went unlogged) is still measured against what we prepared.
    {
      const storedDraft = (sourceData as { draft?: { body?: unknown; sent_at?: unknown; generated_at?: unknown } } | null)?.draft;
      const storedBody = storedDraft && typeof storedDraft.body === 'string' && !storedDraft.sent_at ? storedDraft.body : '';
      const prepared = typeof aiDraft === 'string' && aiDraft.trim() ? aiDraft : storedBody;
      if (prepared.trim()) {
        const { logPreparedOutcome, sendVerdict } = await import('@/lib/prepare/outcome');
        const sentBody = customMessage || prepared;
        const v = sendVerdict(prepared, sentBody);
        logPreparedOutcome(supabase, user.id, {
          outcome: v.outcome, artifact: 'reply_draft', itemKind: 'inbox', itemId: id,
          ...(v.editShare !== undefined ? { editShare: v.editShare } : {}),
          door: 'send_reply', source: sourceData,
          preparedAt: typeof storedDraft?.generated_at === 'string' ? storedDraft.generated_at : null,
        }).catch(() => {});
      }
    }

    // Resolution-on-reply: the loop is closed — clear this item so it leaves "Needs reply"
    // (inbox + Home). Replying ≠ reading; this fires only on an actual sent reply. Stamp
    // source_data.resolved_at — the REAL resolution timestamp the Day-cleared ring counts by.
    // A SENT DRAFT IS NOT PREPARED WORK (Sep 8): the prepared reply is SPENT the moment it goes —
    // stamped like the invite and the forward always were, so `preparedOf` (lib/room/grounding.ts)
    // stops counting it whatever this item's status later becomes.
    const sentDraft = (sourceData as { draft?: Record<string, unknown> } | null)?.draft;
    await supabase.from('inbox_items')
      .update({
        status: 'completed',
        source_data: {
          ...sourceData,
          ...(sentDraft && typeof sentDraft === 'object' ? { draft: { ...sentDraft, sent_at: new Date().toISOString() } } : {}),
          resolved_at: new Date().toISOString(), last_reply_hash: bodyHash, last_reply_at: new Date().toISOString(),
        },
      })
      .eq('id', id).eq('user_id', user.id);
    // W14.2 · A SENT ITEM'S ASKS AND NARRATION GO WITH IT — the asks settle (the reply is out), and the
    // prep narration ("drafted the reply — ready to review") archives now that nothing unsent backs it.
    await import('@/lib/room/turns').then(({ settleAsksForItem }) => settleAsksForItem(supabase, user.id, 'inbox_item', id)).catch(() => 0);
    await import('@/lib/prepare/narration').then(({ settlePrepNarration }) => settlePrepNarration(supabase, user.id, { kind: 'inbox', id }, { retired: 1 })).catch(() => 0);

    // Swap the mailbox label to AUGMTD/Done (honors auto_label). Non-fatal, after() so it never
    // blocks the send response. We have the connection + thread id already, but reconcileItemLabel
    // re-resolves them cheaply from the item for a single code path.
    after(async () => {
      // L2 ACTION EVENT — the brain hears this send (entity re-synthesis + brief-cache bust).
      // THE DEED MOVES THE BRIEF (Sep 8): the send is the action the brain hears — the room's
      // opening is re-authored on the spot AND the deed lands as one appended event line, so the
      // pinned brief can never keep asking for a thing the reader just sent.
      const sentTo = (() => {
        const pick = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().split('<')[0].trim() : '');
        return pick(to) || pick(sourceData.from_name) || pick(sourceData.from) || '';
      })();
      await noteItemAction(supabase, user.id, { kind: 'inbox_item', id },
        { said: sentTo ? `Reply sent to ${sentTo}.` : 'Reply sent.' }).catch(() => {});
      // PLAN COHERENCE (just-works P1): the send IS the reply step resolving — mark it done in the
      // cached plan SERVER-side (the deep-dive no longer shows steps, so no client hook does this).
      // Non-fatal; only reply-like steps flip, real remaining actions stay open.
      try {
        const { isReplyLikeStep } = await import('@/lib/home/item-plan');
        const { data: planRow } = await supabase.from('item_plans').select('tasks').eq('user_id', user.id).eq('kind', 'email').eq('entity_id', id).maybeSingle();
        if (Array.isArray(planRow?.tasks)) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const tasks = (planRow!.tasks as any[]).map((t) => (t && !t.done && isReplyLikeStep(t) ? { ...t, done: true, status: 'done' } : t));
          await supabase.from('item_plans').update({ tasks, updated_at: new Date().toISOString() }).eq('user_id', user.id).eq('kind', 'email').eq('entity_id', id);
        }
      } catch { /* non-fatal */ }
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
