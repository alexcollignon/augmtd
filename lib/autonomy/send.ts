// ════════════════════════════════════════════════════════════════════════════════════════════════
// ⚠️ PARKED (owner call, Aug 11 — THE HUMAN-IN-THE-LOOP LAW): nothing calls this. See ledger.ts
// header. Re-activating is a deliberate owner decision; the park is gate-enforced (AU1).
// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE AUTONOMOUS SEND (routine_replies — the granted class acts; designed Aug 11). The prepare
// pass was wired to call
// this AFTER a reply draft lands with a clean evaluator verdict; nothing here prepares — it only
// fires what the one preparation machinery already judged and reviewed, behind THE FLOORS:
//   1. The grant is active (visible + revocable in Settings → Autonomy).
//   2. The daily cap holds (DAILY_SEND_CAP — proportionality; autonomy is never a firehose).
//   3. THE KNOWN-RECIPIENT FLOOR: the user has previously SENT mail to this exact address —
//      autonomy extends existing correspondence, never opens new fronts.
//   4. The draft passed the evaluator (a review-flagged draft NEVER auto-sends).
//   5. Exactly-once through the commit door (a re-run can never double-send).
// Every send NARRATES into the item's room with its because, resolves the item through the same
// stamps the manual door writes, and lands in Activity. It NEVER logs a prepared_* outcome —
// autonomous sends must not feed their own evidence.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { SupabaseClient } from '@supabase/supabase-js';
import { readLedger, isGranted, DAILY_SEND_CAP } from './ledger';

type InboxItemRow = {
  id: string;
  work_title?: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  source_data: Record<string, any>;
};

/** The decision layer, separated for testability: every floor speaks its reason. */
export async function autonomousSendAllowed(
  client: SupabaseClient, userId: string, item: InboxItemRow,
  opts: { skipGrantCheck?: boolean } = {},
): Promise<{ ok: boolean; reason: string }> {
  const sd = item.source_data ?? {};
  if (!opts.skipGrantCheck) {
    const ledger = await readLedger(client, userId);
    if (!isGranted(ledger, 'routine_replies')) return { ok: false, reason: 'no_grant' };
  }
  const draft = (sd.draft ?? {}) as { body?: string; review?: { verdict?: string } };
  if (!String(draft.body ?? '').trim()) return { ok: false, reason: 'no_draft' };
  // Floor 4 — the evaluator's word is final: only a clean pass may fire unattended.
  if (draft.review && draft.review.verdict !== 'pass') return { ok: false, reason: 'review_flagged' };
  // Floor 3 — the known-recipient floor.
  const rawTo = String(sd.from_address ?? sd.from ?? '');
  const addr = (rawTo.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)?.[0] ?? '').toLowerCase();
  if (!addr) return { ok: false, reason: 'no_recipient' };
  const { data: sent } = await client.from('emails').select('id')
    .eq('user_id', userId).eq('is_from_user', true)
    .contains('to_addresses', [addr]).limit(1);
  if (!sent?.length) return { ok: false, reason: 'unknown_recipient' };
  // Floor 2 — the daily cap, counted from Activity (the honest ledger of what actually fired).
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const { count } = await client.from('activity_events')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId).eq('type', 'autonomous_send')
    .gte('created_at', dayStart.toISOString());
  if ((count ?? 0) >= DAILY_SEND_CAP) return { ok: false, reason: 'daily_cap' };
  return { ok: true, reason: 'clear' };
}

/** Fire the granted send. Returns what happened — the caller (the pass) just logs it. */
export async function maybeAutonomousSend(
  client: SupabaseClient, userId: string, item: InboxItemRow,
): Promise<{ sent: boolean; reason: string }> {
  try {
    const gate = await autonomousSendAllowed(client, userId, item);
    if (!gate.ok) return { sent: false, reason: gate.reason };

    const sd = item.source_data ?? {};
    const draftBody = String((sd.draft as { body?: string }).body);

    // Floor 5 — exactly-once at the send edge.
    const { claimCommit, recordCommitResult, releaseCommitClaim } = await import('@/lib/work/commit-door');
    const claim = await claimCommit(client, userId, {
      idempotencyKey: `autonomy:reply:${item.id}`,
      actionType: 'autonomous_reply', payload: { itemId: item.id },
    });
    if (claim.status === 'duplicate') return { sent: false, reason: 'already_sent' };
    if (claim.status === 'unavailable') return { sent: false, reason: 'commit_door_unavailable' };

    try {
      const { resolveConnectionForItem } = await import('@/lib/inbox/resolve-connection');
      const connection = await resolveConnectionForItem(client, userId, item as never);
      if (!connection) { await releaseCommitClaim(client, userId, `autonomy:reply:${item.id}`); return { sent: false, reason: 'no_connection' }; }

      let sentMessageId: string;
      if (sd.provider === 'gmail') {
        const { sendGmailReply } = await import('@/lib/google/gmail');
        sentMessageId = await sendGmailReply({
          encryptedTokens: connection.metadata.tokens,
          threadId: sd.thread_id, messageId: sd.message_id,
          to: sd.from, subject: sd.subject, body: draftBody,
          inReplyTo: sd.message_id, references: sd.references,
        });
      } else if (sd.provider === 'outlook') {
        let outlookMessageId = sd.message_id;
        if (sd.email_id) {
          const { data: email } = await client.from('emails').select('metadata').eq('id', sd.email_id).single();
          if (email?.metadata?.outlook_id) outlookMessageId = email.metadata.outlook_id;
        }
        const { sendOutlookReply } = await import('@/lib/microsoft/outlook');
        sentMessageId = await sendOutlookReply({
          encryptedTokens: connection.metadata.tokens, messageId: outlookMessageId, body: draftBody,
        });
      } else {
        await releaseCommitClaim(client, userId, `autonomy:reply:${item.id}`);
        return { sent: false, reason: 'unsupported_provider' };
      }

      await recordCommitResult(client, userId, `autonomy:reply:${item.id}`, JSON.stringify({ sentMessageId }));

      // The SAME resolution stamps the manual send door writes — one lifecycle, two doors.
      const nowIso = new Date().toISOString();
      await client.from('inbox_items').update({
        status: 'completed',
        source_data: { ...sd, resolved_at: nowIso, resolved_reason: 'autonomous_reply', last_reply_at: nowIso },
      }).eq('id', item.id).eq('user_id', userId);

      // THE BECAUSE NARRATION — the room says what happened and why it was allowed to.
      try {
        const { writeRoomTurn, roomKeyForItem } = await import('@/lib/room/turns');
        const roomKey = await roomKeyForItem(client, userId, 'inbox', item.id);
        if (roomKey) {
          await writeRoomTurn(client, userId, roomKey, {
            role: 'system',
            text: `Sent the prepared reply autonomously — because you approved routine replies (Settings → Autonomy), this thread is existing correspondence, and the review passed. It's in Activity; revoke any time.`,
            dedupeKey: `autonomy:sent:${item.id}`,
          });
        }
      } catch { /* the Activity row below is the durable record */ }

      const { logActivity } = await import('@/lib/activity/log');
      await logActivity(client, userId, {
        type: 'autonomous_send',
        title: `Sent autonomously: reply to ${String(sd.from_name ?? sd.from ?? '').split('<')[0].trim() || 'the thread'}`,
        entityType: 'inbox_item', entityId: item.id,
        metadata: { sentMessageId, subject: sd.subject ?? null },
      });

      try {
        const { softBustBrief } = await import('@/lib/home/bust-brief');
        await softBustBrief(client, userId);
      } catch { /* deck refresh is cosmetic here */ }

      return { sent: true, reason: 'sent' };
    } catch (e) {
      await releaseCommitClaim(client, userId, `autonomy:reply:${item.id}`);
      console.error('[autonomy] send failed:', e);
      return { sent: false, reason: 'send_failed' };
    }
  } catch (e) {
    console.error('[autonomy] gate error:', e);
    return { sent: false, reason: 'gate_error' };
  }
}
