// Reply/closure resolution — when the user has structurally responded on a thread (a sent message
// after the open item/commitment was created), auto-resolve the answered needs-reply item AND the
// user's own "you owe" commitment on that thread. AGNOSTIC by construction: the decision comes only
// from computeThreadReplyState (direction + time) — NO keyword/phrase/regex matching of email text.
//
// Conservative: resolves ONLY on a clear structural user reply, ONLY touches open needs-reply-ish
// items and open `you_owe` commitments (never FYI/awareness, never waiting_on/ball-in-court — a user
// reply doesn't fulfil something SOMEONE ELSE owes). Everything is logged via logActivity so it shows
// in the Activity timeline AND is undoable through the existing /api/restore paths (status flip). The
// home brief cache is busted so the Home drops the resolved item on next load. Fully non-fatal.

import { logActivity } from '@/lib/activity/log';
import { computeThreadReplyState, messagesForResolution, threadCounterpartyEmail, type ThreadMessage } from './thread-resolution';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DBClient = any;

// The work_states that represent a reply the user owes (mirrors isNeedsReply's reply-state gate). A
// user reply on the thread settles exactly these — never a plain FYI/awareness item.
const REPLY_STATES = ['work_prepared', 'decision_required'];

/**
 * Resolve the open needs-reply item + open you-owe commitment on a thread the user has replied to.
 *
 * @param opts.threadEmails  the thread's messages (is_from_user + received_at) — the SAME set the
 *   update path already assembles. If empty/undefined we cannot judge structurally → no-op (unless a
 *   single confirmed sent message is passed as the whole thread).
 * @param opts.repliedAt     optional: the timestamp of the user's just-sent message, used as a
 *   fallback single-message thread when threadEmails isn't assembled in this path.
 */
export async function resolveThreadOnReply(opts: {
  userId: string;
  threadId: string | null;
  threadEmails?: ThreadMessage[];
  repliedAt?: string | null;
  client: DBClient;
  /** best-effort cache bust (profiles.home_brief=null) so the Home drops it next load. */
  bustBriefCache?: () => Promise<void>;
  /** skip the mailbox label swap (AUGMTD/Done) — set on hot READ paths (the read-time reconcile), where
   * the label-sweep cron reconciles labels eventually and we don't want to block on a mailbox API call. */
  skipLabelReconcile?: boolean;
}): Promise<{ resolvedItems: number; resolvedCommitments: number }> {
  const { userId, threadId, client } = opts;
  const out = { resolvedItems: 0, resolvedCommitments: 0 };
  if (!threadId) return out;

  try {
    // The thread messages we reason over. Prefer the assembled thread; otherwise treat the single
    // sent message as a one-message thread (a from-user message IS a reply — structural).
    const messages: ThreadMessage[] =
      opts.threadEmails && opts.threadEmails.length
        ? opts.threadEmails
        : opts.repliedAt
          ? [{ is_from_user: true, received_at: opts.repliedAt }]
          : [];

    // ── inbox item: resolve the OPEN needs-reply item on this thread if the user replied after it
    // was created. We fetch first (need created_at as the `since` window + the subject for the log). ──
    // Eligibility is a UNION: the reply work_states OR a rule that classified it needs_reply — so an item
    // the board shows as a reply-you-owe (rule_type='needs_reply') resolves even if its work_state isn't
    // one of the two. A waiting_on/fyi override is excluded (a user reply doesn't fulfil what OTHERS owe).
    const { data: openItems } = await client
      .from('inbox_items')
      .select('id, created_at, work_title, source_data, connection_id, type_override')
      .eq('user_id', userId)
      .eq('source', 'email')
      .eq('status', 'pending')
      .or(`work_state.in.(${REPLY_STATES.join(',')}),rule_type.eq.needs_reply`)
      .eq('source_data->>thread_id', threadId);

    // T1: the thread's counterparty (the newest inbound sender) — the resolution floor's anchor.
    const threadCp = threadCounterpartyEmail(messages);

    for (const it of (openItems ?? []) as Array<{ id: string; created_at: string; work_title?: string; source_data?: { subject?: string; from_address?: string }; connection_id?: string | null; type_override?: string }>) {
      if (it.type_override === 'waiting_on' || it.type_override === 'fyi') continue;
      // T1: a forward is not fulfillment — only user messages ADDRESSED TO the counterparty count.
      const cp = (it.source_data?.from_address || threadCp || null);
      const state = computeThreadReplyState(messagesForResolution(messages, cp), it.created_at ? new Date(it.created_at) : null);
      if (!state.userReplied) continue; // conservative: no clear structural reply → leave it

      const resolvedAt = new Date().toISOString();
      const sd = (it.source_data ?? {}) as Record<string, unknown>;
      const { error } = await client
        .from('inbox_items')
        .update({
          status: 'completed',
          // Reason + timestamp so it's auditable and the UI can explain WHY it cleared.
          source_data: { ...sd, resolved_reason: 'replied', resolved_at: resolvedAt },
          updated_at: resolvedAt,
        })
        .eq('id', it.id)
        .eq('user_id', userId)
        .eq('status', 'pending'); // guard against a concurrent flip
      if (error) continue;

      // Swap the mailbox label to AUGMTD/Done — the user replied from Gmail/Outlook directly, so the
      // thread is resolved and should not linger under "Needs reply". Honors auto_label, non-fatal.
      // Skipped on hot read paths (the label-sweep cron reconciles labels; we don't block on a mailbox call).
      if (!opts.skipLabelReconcile) {
        await import('@/lib/inbox/reconcile-item-label')
          .then(({ reconcileItemLabel }) =>
            reconcileItemLabel({ userId, itemId: it.id, item: it, targetLabel: 'done', client }))
          .catch(() => {});
      }

      out.resolvedItems++;
      import('@/lib/room/turns').then(({ settleAsksForItem }) => settleAsksForItem(client, userId, 'inbox_item', it.id)).catch(() => {});
      const subject = it.work_title || (it.source_data?.subject as string) || 'a thread';
      // marked_done → reversible via /api/restore (inbox_item → status='pending'), reappears on Home.
      await logActivity(client, userId, {
        type: 'marked_done',
        title: `Resolved (you replied): ${subject}`,
        entityType: 'inbox_item',
        entityId: it.id,
        metadata: { reason: 'replied', auto: true },
      });
    }

    // ── commitment: resolve the user's OWN open you-owe commitment on this thread. A user reply
    // fulfils something the USER owed. We deliberately do NOT touch `awaiting` (ball-in-their-court)
    // commitments — a user reply doesn't complete what someone else owes. ──
    const { data: openCommits } = await client
      .from('commitments')
      .select('id, created_at, description, direction, due_date')
      .eq('user_id', userId)
      .eq('status', 'open')
      .eq('direction', 'you_owe')
      .eq('thread_id', threadId);

    for (const c of (openCommits ?? []) as Array<{ id: string; created_at: string; description: string; due_date?: string | null }>) {
      // T1: same floor — a you-owe settles only via a message TO the thread's counterparty.
      const state = computeThreadReplyState(messagesForResolution(messages, threadCp), c.created_at ? new Date(c.created_at) : null);
      if (!state.userReplied) continue;

      // THE FULFILLMENT LAW (July 30): a structural reply settles a REPLY-obligation, but a
      // commitment can owe a DELIVERABLE — and "I'll send it by Sunday" fulfills nothing. One
      // reasoned pass over the user's actual sent message decides delivered vs promised; only
      // delivered closes; a re-promise with a stated new date re-anchors due_date instead.
      // Unclear / AI failure leaves it open (failure is never fulfillment).
      try {
        const { data: sent } = await client.from('emails')
          .select('id, body, metadata')
          .eq('user_id', userId).eq('thread_id', threadId).eq('is_from_user', true)
          .gt('received_at', c.created_at)
          .order('received_at', { ascending: false }).limit(1).maybeSingle();
        const { judgeCommitmentFulfillment, applyFulfillmentVerdict } = await import('@/lib/commitments/fulfillment');
        const meta = (sent?.metadata ?? {}) as { attachments?: unknown[] };
        const fv = await judgeCommitmentFulfillment(client, userId, c,
          { id: (sent?.id as string) ?? null, body: String(sent?.body ?? ''), attachmentCount: Array.isArray(meta.attachments) ? meta.attachments.length : null }, true);
        const closed = await applyFulfillmentVerdict(client, userId, c, fv, async () => true);
        if (!closed) continue; // promised/unclear — the deliverable stays on the plate
      } catch { continue; } // never close on an error path

      const resolvedAt = new Date().toISOString();
      const { error } = await client
        .from('commitments')
        .update({ status: 'done', resolved_reason: 'replied', resolved_at: resolvedAt, updated_at: resolvedAt })
        .eq('id', c.id)
        .eq('user_id', userId)
        .eq('status', 'open');
      if (error) {
        // `resolved_reason`/`resolved_at` may not exist as columns on older schemas — retry status-only
        // so resolution still lands (and stays reversible). Non-fatal either way.
        const retry = await client
          .from('commitments')
          .update({ status: 'done', updated_at: resolvedAt })
          .eq('id', c.id)
          .eq('user_id', userId)
          .eq('status', 'open');
        if (retry.error) continue;
      }

      out.resolvedCommitments++;
      import('@/lib/room/turns').then(({ settleAsksForItem }) => settleAsksForItem(client, userId, 'commitment', c.id)).catch(() => {});
      // commitment_done → reversible via /api/restore (commitment → status='open'), reappears on Home.
      await logActivity(client, userId, {
        type: 'commitment_done',
        title: `Resolved (you replied): ${c.description}`,
        entityType: 'commitment',
        entityId: c.id,
        metadata: { reason: 'replied', auto: true },
      });
    }

    // Bust the Home brief cache once, only if something actually resolved, so the Home drops it.
    if ((out.resolvedItems || out.resolvedCommitments) && opts.bustBriefCache) {
      await opts.bustBriefCache().catch(() => {});
    }
  } catch (e) {
    // Fully non-fatal — never break sync.
    console.error('[resolve-on-reply] non-fatal error:', e);
  }

  return out;
}
