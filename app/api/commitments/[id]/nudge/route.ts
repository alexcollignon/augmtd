import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { generateNudgeDraft } from '@/lib/inbox/draft-reply';
import { createHash } from 'crypto';
import { logActivity } from '@/lib/activity/log';
import { claimCommit, recordCommitResult, releaseCommitClaim } from '@/lib/work/commit-door';

/** THE LIVE STATES a nudge may answer (W0.4): an open debt, or a surfaced-but-unconfirmed one.
 *  A done or dismissed commitment has nothing left to chase — a nudge there is a stray email. */
const NUDGEABLE = ['open', 'suggested'];

export const maxDuration = 30;

// Commitment nudge — the "Ball in your court" action (Bug #2). A gentle, voice-grounded follow-up
// from the user to the counterparty they're WAITING ON. A draft the user reviews + sends — never
// auto-sent. Non-fatal throughout: falls back cleanly and never breaks the brief.
//
// POST   /api/commitments/[id]/nudge          → generate (or return cached) a nudge draft body.
// PATCH  /api/commitments/[id]/nudge  {body}   → send the nudge, then mark the commitment done.
//
// Send path: if the commitment traces back to an email thread (source='email' with a stored email),
// reply on that thread via the user's connected mailbox — same mechanics as /inbox/[id]/send-reply.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadCommitment(supabase: any, userId: string, id: string) {
  const { data } = await supabase.from('commitments')
    .select('id, description, counterparty, direction, source, source_id, thread_id, created_at, status')
    .eq('id', id).eq('user_id', userId).maybeSingle();
  return data;
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const commitment = await loadCommitment(supabase, user.id, id);
  if (!commitment) return NextResponse.json({ error: 'not found' }, { status: 404 });

  try {
    // PREPARED-FIRST via THE ONE READER (lib/prepare/read.ts) — serve the pass's stored draft
    // INSTANTLY instead of regenerating on every open. W9.1: LIVE, not young — the old <24h clock
    // regenerated an unchanged draft on the day after (and never served the user's own edit past
    // a day). THE GROUND LAW still holds through `live`: a superseded machine draft is not live and
    // falls through; the user's EDITED message stays live (marked `staleUnderEdit` when the thread
    // moved) and is served as theirs.
    const { preparedState } = await import('@/lib/prepare/read');
    const st = await preparedState(supabase, user.id, { kind: 'commitment', id });
    const liveDraft = st.live.find((a) => (a.kind === 'nudge_draft' || a.kind === 'reply_draft') && a.content.trim());
    if (liveDraft) {
      return NextResponse.json({
        draft: liveDraft.content, prepared: true,
        ...(liveDraft.hand ? { edited: true, ...(liveDraft.staleUnderEdit ? { staleUnderEdit: true } : {}) } : {}),
      });
    }
    // THE ONE GATE: an on-open nudge generation is ambient work — the judged verdict must say the
    // work is a chase (an expired/answered commitment gets no nudge). Cached — a read on repeats.
    try {
      const { judgeWork } = await import('@/lib/work/judge');
      const v = await judgeWork(supabase, user.id, { kind: 'commitment', id });
      if (v.work !== 'chase') return NextResponse.json({ draft: '', skipped: 'judged_' + v.work });
    } catch { /* judge unavailable -> generate (the composer is user-facing) */ }
    const ageDays = commitment.created_at ? Math.floor((Date.now() - new Date(commitment.created_at).getTime()) / 86_400_000) : undefined;
    const draft = await generateNudgeDraft(user.id, {
      counterparty: commitment.counterparty ?? null,
      description: commitment.description ?? '',
      ageDays,
    }, supabase);
    // The commitments table has no source_data column, so we don't persist the draft — it regenerates
    // on demand (cheap, one call) each time the user opens the row, like the inbox reply drafter.
    return NextResponse.json({ draft });
  } catch {
    return NextResponse.json({ error: 'Could not draft a nudge.' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { body, attachments: rawAttachments, aiDraft } = await request.json();
  if (!body || typeof body !== 'string') return NextResponse.json({ error: 'Missing body' }, { status: 400 });

  // Same base64 attach shape the inbox reply uses ({filename, content(base64), mimeType}) →
  // EmailAttachment[] (content decoded to a Buffer), forwarded to the provider send fns below.
  const attachments = (rawAttachments || []).map((a: { filename: string; content: string; mimeType: string }) => ({
    filename: a.filename,
    content: Buffer.from(a.content, 'base64'),
    mimeType: a.mimeType,
  }));

  const commitment = await loadCommitment(supabase, user.id, id);
  if (!commitment) return NextResponse.json({ error: 'not found' }, { status: 404 });
  // A CLOSED DEBT IS NOT CHASED (W0.4): the old door re-sent on a done commitment.
  if (!NUDGEABLE.includes(String(commitment.status ?? 'open'))) {
    return NextResponse.json({ error: 'This one is already closed — there is nothing left to nudge.' }, { status: 409 });
  }

  // ── THE COMMIT DOOR (W0.4 — EXACTLY-ONCE DEEDS): one claim per commitment + message. A
  // double-click loses the claim and never mails twice; a failed or unsendable nudge releases it.
  const idemKey = `nudge:${id}:${createHash('sha256').update(body).digest('hex').slice(0, 24)}`;
  const claim = await claimCommit(supabase, user.id, {
    idempotencyKey: idemKey, actionType: 'nudge',
    payload: { commitmentId: id, counterparty: commitment.counterparty ?? null },
  });
  if (claim.status === 'duplicate') {
    if (claim.priorResult == null) {
      return NextResponse.json({ error: 'That nudge is already on its way.' }, { status: 409 });
    }
    return NextResponse.json({ success: true, sent: true, alreadySent: true });
  }
  const release = async () => { if (claim.status === 'claimed') await releaseCommitClaim(supabase, user.id, idemKey); };

  // Resolve the source email (for thread-reply mechanics) when this commitment came from email.
  let sent = false;
  try {
    if (commitment.source === 'email' && commitment.source_id) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: email } = await supabase.from('emails')
        .select('message_id, thread_id, subject, from_address, references_ids, in_reply_to, metadata, connection_id')
        .eq('id', commitment.source_id).eq('user_id', user.id).maybeSingle();
      if (email) {
        // Resolve the mailbox connection — the connection carries the provider (gmail | outlook).
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let connection: any = null;
        if (email.connection_id) {
          const { data } = await supabase.from('connections').select('*').eq('id', email.connection_id).eq('user_id', user.id).maybeSingle();
          connection = data;
        }
        if (!connection) {
          const { data } = await supabase.from('connections').select('*').eq('user_id', user.id).eq('status', 'active').limit(1).maybeSingle();
          connection = data;
        }
        const to = (commitment.counterparty && /[^\s<>"]+@[^\s<>"]+/.test(commitment.counterparty))
          ? (commitment.counterparty.match(/[^\s<>"]+@[^\s<>"]+/)?.[0] as string)
          : email.from_address;
        const provider = connection?.provider;
        if (connection?.metadata?.tokens && to) {
          if (provider === 'gmail') {
            const { sendGmailReply } = await import('@/lib/google/gmail');
            await sendGmailReply({
              encryptedTokens: connection.metadata.tokens,
              threadId: email.thread_id,
              messageId: email.message_id,
              to,
              subject: email.subject || '',
              body,
              inReplyTo: email.in_reply_to,
              references: Array.isArray(email.references_ids) ? email.references_ids.join(' ') : email.references_ids,
              attachments,
            });
            sent = true;
          } else if (provider === 'outlook') {
            const { sendOutlookReply } = await import('@/lib/microsoft/outlook');
            const outlookMessageId = (email.metadata as { outlook_id?: string } | null)?.outlook_id || email.message_id;
            await sendOutlookReply({ encryptedTokens: connection.metadata.tokens, messageId: outlookMessageId, body, to, attachments });
            sent = true;
          }
        }
      }
    }
  } catch (e) {
    console.error('[nudge] send failed', e);
    await release();
    return NextResponse.json({ error: 'Could not send the nudge.' }, { status: 500 });
  }

  if (!sent) {
    await release();
    // No connected-mailbox thread to reply on (e.g. no OAuth). We don't silently drop it — tell the
    // client so it can keep the draft open for the user to copy/send manually.
    return NextResponse.json({ error: 'No connected mailbox to send this nudge — copy it and send from your email.', sent: false }, { status: 409 });
  }

  if (claim.status === 'claimed') await recordCommitResult(supabase, user.id, idemKey, `Nudge sent (${String(commitment.counterparty ?? 'contact')})`);

  // THE OUTCOME LOG (W3.2 — THE TWO-WAY LEDGER): the nudge's fate. The prepared text is the pass's
  // POOLED chase draft (through THE ONE READER) — else the on-demand draft the composer was seeded
  // with (`aiDraft`; the POST never stores it). The pooled row is stamped SPENT so the reader stops
  // offering a chase that already went. Non-fatal: a sent nudge is never lost to bookkeeping.
  try {
    const { getPrepared } = await import('@/lib/prepare/read');
    const pooled = (await getPrepared(supabase, user.id, { kind: 'commitment', id }))
      .find((a) => a.kind === 'nudge_draft' || a.kind === 'reply_draft');
    const prepared = typeof aiDraft === 'string' && aiDraft.trim() ? aiDraft : (pooled?.content ?? '');
    if (pooled?.payload && 'rowId' in pooled.payload && pooled.payload.rowId) {
      const { data: prow } = await supabase.from('item_deliverables').select('metadata')
        .eq('id', pooled.payload.rowId).eq('user_id', user.id).maybeSingle();
      await supabase.from('item_deliverables')
        .update({ metadata: { ...((prow?.metadata ?? {}) as Record<string, unknown>), sent_at: new Date().toISOString() } })
        .eq('id', pooled.payload.rowId).eq('user_id', user.id);
    }
    if (prepared.trim()) {
      const { logPreparedOutcome, sendVerdict } = await import('@/lib/prepare/outcome');
      const v = sendVerdict(prepared, body);
      await logPreparedOutcome(supabase, user.id, {
        outcome: v.outcome, artifact: 'nudge_draft', itemKind: 'commitment', itemId: id,
        ...(v.editShare !== undefined ? { editShare: v.editShare } : {}),
        door: 'nudge_send', senderClass: 'unknown', preparedAt: pooled?.at ?? null,
      });
    }
  } catch { /* the outcome log never breaks the send it observes */ }

  // Sent → the ball moved; close the commitment so it leaves "Ball in your court". A CONDITIONAL
  // flip (only a still-live row) — and its failure is SAID, never swallowed: the send landed, so the
  // answer stays a success, but the client learns the row did not close.
  const { error: flipErr } = await supabase.from('commitments')
    .update({ status: 'done', last_nudged_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', id).eq('user_id', user.id).in('status', NUDGEABLE);
  if (flipErr) console.error('[nudge] sent, but the commitment did not close:', flipErr.message);
  else {
    // W14.2 · the closed commitment's asks settle; the nudge narration follows its (now sent) artifact.
    await import('@/lib/room/turns').then(({ settleAsksForItem }) => settleAsksForItem(supabase, user.id, 'commitment', id)).catch(() => 0);
    await import('@/lib/prepare/narration').then(({ settlePrepNarration }) => settlePrepNarration(supabase, user.id, { kind: 'commitment', id }, { retired: 1 })).catch(() => 0);
  }

  // Activity timeline (non-fatal).
  const who = (commitment.counterparty && String(commitment.counterparty).trim()) || 'a contact';
  await logActivity(supabase, user.id, {
    type: 'nudge_sent',
    title: `Nudged ${who}${commitment.description ? ` — ${commitment.description}` : ''}`,
    entityType: 'commitment',
    entityId: id,
    metadata: { direction: commitment.direction, source: commitment.source },
  });

  return NextResponse.json({ success: true, sent: true, ...(flipErr ? { closed: false, warning: 'Sent — but it is still showing as open; mark it done.' } : {}) });
}
