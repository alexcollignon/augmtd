import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { executeSendCalendarInvite } from '@/lib/tools/send-calendar-invite';
import { claimCommit, recordCommitResult, releaseCommitClaim } from '@/lib/work/commit-door';
import { readChatInvite, updateChatInvitePayload, markChatInviteSent } from '@/lib/prepare/chat-invite-store';
import { logActivity } from '@/lib/activity/log';
import { isEmailStrict } from '@/lib/core/email';

export const maxDuration = 60;

// ════════════════════════════════════════════════════════════════════════════════════════════════
// POST /api/invites/send — the CHAT-BORN invite's commit door.
//
// ⚠️ SAFETY INVARIANT, identical to /api/items/execute: this route COMMITS an irreversible act (a
// real calendar invite with real notifications). It fires ONLY from the user's own explicit Send
// click on the invite card. Nothing here runs without that click; nothing chains into it.
//
// TWO DOORS, ONE EXECUTOR — deliberate. An item-born invite lives on its item (`source_data
// .prepared_invite`) and commits through /api/items/execute, which also stamps the artifact spent,
// marks the plan step done and logs the prepared OUTCOME against that item. A chat-born invite has
// no item: its payload lives in the `chat_invite` store, so it needs a door that reads THAT store.
// The stores differ; the send does not — both call `executeSendCalendarInvite` through the SAME
// commit door (claim → fire → record, exactly-once), so a double-click or a retried request gets
// the prior result back instead of a second event.
//
// THE SEND READS THE STORE, NEVER THE BODY. Edits the user made in the card are WRITTEN to the
// stored payload first, under the door's own validation; the send then re-reads the row and mails
// what the row says. A door that sends the fields a browser handed it is a door that can be told
// to mail anyone — the words persist first, then the deed.
// ════════════════════════════════════════════════════════════════════════════════════════════════

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = (await request.json()) as {
      inviteId?: string;
      edits?: { title?: string; startISO?: string; endISO?: string; attendees?: string[]; description?: string };
    };
    const inviteId = String(body.inviteId ?? '').trim();
    if (!inviteId) return NextResponse.json({ error: 'inviteId required' }, { status: 400 });

    const stored = await readChatInvite(supabase, user.id, inviteId);
    // Unknown / foreign / not-an-invite are ONE indistinguishable not-found (the share-door law).
    if (!stored) return NextResponse.json({ error: 'That invite is no longer available.' }, { status: 404 });
    if (stored.sentAt) return NextResponse.json({ ok: true, alreadyExecuted: true, result: 'Already sent.' });

    // ── THE EDITS LAND FIRST. Each field is validated on its own terms: a time must parse, an
    // attendee must be a real address, the prose is the user's own. Anything absent keeps what
    // the preparer grounded.
    const e = body.edits ?? {};
    const merged = {
      ...stored.invite,
      title: (typeof e.title === 'string' ? e.title : stored.invite.title || '').trim().slice(0, 200),
      startISO: typeof e.startISO === 'string' && e.startISO.trim() && !isNaN(new Date(e.startISO).getTime())
        ? new Date(e.startISO).toISOString() : stored.invite.startISO,
      endISO: typeof e.endISO === 'string' && e.endISO.trim() && !isNaN(new Date(e.endISO).getTime())
        ? new Date(e.endISO).toISOString() : stored.invite.endISO,
      attendees: Array.isArray(e.attendees)
        ? [...new Set(e.attendees.map((a) => String(a).trim()).filter((a) => isEmailStrict(a)))].slice(0, 10)
        : stored.invite.attendees,
      description: typeof e.description === 'string' ? e.description.slice(0, 2000) : stored.invite.description,
    };

    // Approve-before-commit strictness: a card that isn't complete never sends a broken invite.
    if (!merged.title) return NextResponse.json({ error: 'Add a title before sending the invite.' }, { status: 400 });
    if (!merged.startISO || !merged.endISO || isNaN(new Date(merged.startISO).getTime()) || isNaN(new Date(merged.endISO).getTime())) {
      return NextResponse.json({ error: 'Set a valid date and time before sending the invite.' }, { status: 400 });
    }
    if (!merged.attendees.length) {
      return NextResponse.json({ error: 'Add at least one attendee before sending the invite.' }, { status: 400 });
    }

    // The merged payload becomes the STORED payload — the send below reads it back from the row.
    // (The stamp that spends the card comes AFTER a successful send: a failed executor must leave
    // the card alive to retry.)
    await updateChatInvitePayload(supabase, user.id, inviteId, { ...merged, type: 'calendar_invite' });
    const record = await readChatInvite(supabase, user.id, inviteId);
    const toSend = record?.invite ?? merged;

    // ── THE COMMIT DOOR — one atomic claim per irreversible act; a duplicate returns the prior
    // result and never mails twice.
    const idemKey = `chat_invite:${inviteId}`;
    const claim = await claimCommit(supabase, user.id, {
      idempotencyKey: idemKey, actionType: 'calendar_invite',
      payload: toSend as unknown as Record<string, unknown>,
    });
    if (claim.status === 'duplicate') {
      return NextResponse.json({ ok: true, alreadyExecuted: true, result: claim.priorResult ?? 'Already sent.' });
    }

    const result = await executeSendCalendarInvite({
      title: toSend.title, startISO: toSend.startISO, endISO: toSend.endISO,
      attendees: toSend.attendees, description: toSend.description || '',
      timezone: toSend.timezone || 'UTC', includeMeetLink: true,
    }, user.id, supabase);

    const failed = /^(Cannot|Failed)\b/.test(result);
    if (claim.status === 'claimed') {
      if (failed) await releaseCommitClaim(supabase, user.id, idemKey);
      else await recordCommitResult(supabase, user.id, idemKey, result);
    }
    if (failed) return NextResponse.json({ ok: false, error: result }, { status: 502 });
    await markChatInviteSent(supabase, user.id, inviteId);

    // THE OUTCOME LOG (W3.2 — THE TWO-WAY LEDGER): the chat-born invite's fate — sent as prepared
    // (accepted) or changed in the card first (edited). Compared on the fields the user can edit,
    // against the payload the preparer grounded (read BEFORE the edits landed). Non-fatal.
    {
      const { logPreparedOutcome } = await import('@/lib/prepare/outcome');
      const before = stored.invite as unknown as Record<string, unknown>;
      const after_ = toSend as unknown as Record<string, unknown>;
      const edited = ['title', 'startISO', 'endISO', 'attendees', 'description']
        .some((k) => JSON.stringify(before[k] ?? '') !== JSON.stringify(after_[k] ?? ''));
      await logPreparedOutcome(supabase, user.id, {
        outcome: edited ? 'edited' : 'accepted', artifact: 'invite', itemKind: 'chat', itemId: inviteId,
        door: 'invite_send', senderClass: 'unknown', preparedAt: stored.createdAt ?? null,
      });
    }

    await logActivity(supabase, user.id, {
      type: 'invite_sent',
      title: `Sent calendar invite: ${toSend.title}`,
      metadata: { attendees: toSend.attendees, startISO: toSend.startISO, endISO: toSend.endISO, result, from: 'chat' },
    });

    return NextResponse.json({ ok: true, result });
  } catch (error) {
    console.error('[invites/send] error:', error);
    return NextResponse.json({ error: 'Could not send the invite.' }, { status: 500 });
  }
}
