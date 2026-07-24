// READ-TIME reply reconcile — the self-healing counterpart to the sync-time resolver. It re-derives
// truth from the actual thread instead of trusting a frozen snapshot, so a "needs reply" item that the
// user has ALREADY answered can never stay stuck as to-do on the Home, the board, or the Timeline.
//
// WHY this exists: `resolveThreadOnReply` (resolve-on-reply.ts) only fires at ONE instant — when a
// user-sent message is stored during sync. If that firing misses its window (the item wasn't yet in a
// reply-state at that moment, the sent mail arrived via a dedup/backfill path, or a later reclassification
// re-touched the row), nothing ever re-checks the thread and the item is frozen as "reply needed" forever.
// This batch re-runs the SAME structural resolver over every open reply-ish item at read time.
//
// AGNOSTIC + safe: direction + time only (computeThreadReplyState) — no keywords. It resolves a thread
// ONLY when the user's reply is the LATEST message (ball in their court); a newer inbound reopens it
// (that's reactivate-on-reply's job), so a reopened thread is never wrongly closed. Idempotent (already-
// resolved items don't re-match), batched (one emails query for all candidate threads), fully non-fatal.

import { computeThreadReplyState, type ThreadMessage } from './thread-resolution';
import { resolveThreadOnReply } from './resolve-on-reply';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DBClient = any;

export async function reconcileRepliedItems(
  client: DBClient,
  userId: string,
  opts?: { bustBriefCache?: () => Promise<void> },
): Promise<{ resolvedThreads: number }> {
  let resolvedThreads = 0;
  try {
    // Candidate open reply-ish items — anything the board would treat as a reply the user owes. This
    // UNION (rule_type OR work_state) is what closes the resolver/spine eligibility gap (the sync
    // resolver historically only looked at work_state). We only need their thread ids here.
    const { data: items } = await client
      .from('inbox_items')
      .select('source_data, type_override')
      .eq('user_id', userId)
      .eq('source', 'email')
      .eq('status', 'pending')
      .or('rule_type.eq.needs_reply,work_state.in.(work_prepared,decision_required)')
      .limit(500);

    const threadIds = [
      ...new Set(
        ((items ?? []) as Array<{ source_data?: { thread_id?: string }; type_override?: string }>)
          // A user reply doesn't fulfil what SOMEONE ELSE owes — never touch a waiting_on/fyi override.
          .filter((it) => it.type_override !== 'waiting_on' && it.type_override !== 'fyi' && it.source_data?.thread_id)
          .map((it) => String(it.source_data!.thread_id)),
      ),
    ];
    if (!threadIds.length) return { resolvedThreads };

    // One query for ALL candidate threads' messages, grouped by thread. Sender + recipients ride
    // along for the T1 resolution floor (a forward to a third party is not fulfillment).
    const { data: emails } = await client
      .from('emails')
      .select('thread_id, is_from_user, received_at, from_address, to_addresses, cc_addresses')
      .eq('user_id', userId)
      .in('thread_id', threadIds);

    const byThread = new Map<string, ThreadMessage[]>();
    for (const e of (emails ?? []) as Array<{ thread_id: string; is_from_user: boolean; received_at: string | null; from_address?: string | null; to_addresses?: string[] | null; cc_addresses?: string[] | null }>) {
      const t = String(e.thread_id);
      let arr = byThread.get(t);
      if (!arr) { arr = []; byThread.set(t, arr); }
      arr.push({
        is_from_user: e.is_from_user, received_at: e.received_at,
        from: e.from_address ?? null,
        to: [...(e.to_addresses ?? []), ...(e.cc_addresses ?? [])],
      });
    }

    for (const tid of threadIds) {
      const msgs = byThread.get(tid) ?? [];
      // Only reconcile when the user's message is the LATEST on the thread. If a newer inbound followed
      // their reply, the ball is back in the user's court (reopened) — leave it for reactivate-on-reply.
      const st = computeThreadReplyState(msgs, null);
      if (!st.lastMessageFromUser) continue;

      // Reuse the SAME structural resolver the sync path uses (items + you-owe commitments + logging +
      // undo). Pass the pre-fetched thread so it doesn't re-query. Skip the mailbox label swap here — this
      // is a hot read path; the label-sweep cron reconciles labels eventually (state flip is what matters).
      const r = await resolveThreadOnReply({
        userId,
        threadId: tid,
        threadEmails: msgs,
        client,
        skipLabelReconcile: true,
      });
      if (r.resolvedItems || r.resolvedCommitments) resolvedThreads++;
    }

    if (resolvedThreads && opts?.bustBriefCache) await opts.bustBriefCache().catch(() => {});
  } catch (e) {
    // Fully non-fatal — never break a read path.
    console.error('[reconcile-replied] non-fatal error:', e);
  }
  return { resolvedThreads };
}
