import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { generateNudgeDraft } from '@/lib/inbox/draft-reply';

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
    .select('id, description, counterparty, direction, source, source_id, thread_id, created_at')
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

  const { body } = await request.json();
  if (!body || typeof body !== 'string') return NextResponse.json({ error: 'Missing body' }, { status: 400 });

  const commitment = await loadCommitment(supabase, user.id, id);
  if (!commitment) return NextResponse.json({ error: 'not found' }, { status: 404 });

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
            });
            sent = true;
          } else if (provider === 'outlook') {
            const { sendOutlookReply } = await import('@/lib/microsoft/outlook');
            const outlookMessageId = (email.metadata as { outlook_id?: string } | null)?.outlook_id || email.message_id;
            await sendOutlookReply({ encryptedTokens: connection.metadata.tokens, messageId: outlookMessageId, body, to });
            sent = true;
          }
        }
      }
    }
  } catch (e) {
    console.error('[nudge] send failed', e);
    return NextResponse.json({ error: 'Could not send the nudge.' }, { status: 500 });
  }

  if (!sent) {
    // No connected-mailbox thread to reply on (e.g. no OAuth). We don't silently drop it — tell the
    // client so it can keep the draft open for the user to copy/send manually.
    return NextResponse.json({ error: 'No connected mailbox to send this nudge — copy it and send from your email.', sent: false }, { status: 409 });
  }

  // Sent → the ball moved; close the commitment so it leaves "Ball in your court".
  await supabase.from('commitments').update({ status: 'done', last_nudged_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', id).eq('user_id', user.id).then(() => {}, () => {});
  return NextResponse.json({ success: true, sent: true });
}
