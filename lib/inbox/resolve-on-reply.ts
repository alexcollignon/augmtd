// W19.A (A REPLY IS NOT A DELIVERY): the structural reply closes an item whose ask needs only an ANSWER;
// an item whose ask is a DELIVERABLE the user owes (lib/commitments/deliverable-ask) is closed only when
// the ONE fulfillment judge rules the reply delivered it — a promise keeps it open and is recorded as a
// you-owe commitment through the one creation door. (The "no keyword" contract below still holds: the
// judgment is reasoned; the code applies it.)
//
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

// W19.A · A REPLY IS NOT A DELIVERY (lib/commitments/deliverable-ask.ts): an item whose ask is a
// DELIVERABLE the user owes is closed by a reply only when the one fulfillment judge rules the reply
// DELIVERED it. Bounded: at most this many FRESH judgments per call (a cache hit is free); the rest
// stay open and are REPORTED (no silent caps) — the evidence sweep's forward door re-reads them.
export const REPLY_DELIVERABLE_MAX_FRESH = 3;

/** The injectable seams (the zero-AI gates stub them; production omits them). */
export type ReplyResolveDeps = {
  judge?: typeof import('@/lib/commitments/fulfillment').judgeFulfillmentFromEvidence;
  /** records a PROMISE as a you-owe commitment through the one creation door; returns its outcome. */
  recordPromise?: (client: DBClient, userId: string, args: RecordPromiseArgs) => Promise<'created' | 'reanchored' | 'exists' | 'skipped'>;
};
export type RecordPromiseArgs = {
  item: { id: string; work_title?: string | null; source_data?: Record<string, unknown> | null };
  verdict: import('@/lib/commitments/fulfillment').FulfillmentVerdict;
  sent: { id: string; body: string; received_at: string | null; subject?: string | null };
  threadId: string;
  counterparty: string | null;
};

/**
 * THE PROMISE IS TRACKED (W19.A) — the production recorder. An open you-owe already standing on the
 * conversation for the same matter is RE-ANCHORED (the fulfillment consequence applier — the stated
 * new date, never a second row); otherwise the promise is written through writeCommitments (the ONE
 * creation door: quote floor, dedupe against the same message, direction + identity floors, the
 * conversation delta). Idempotent: a re-read of the same reply finds its own row by source id.
 */
export async function recordPromiseCommitment(client: DBClient, userId: string, a: RecordPromiseArgs): Promise<'created' | 'reanchored' | 'exists' | 'skipped'> {
  const { promiseCommitmentOf } = await import('@/lib/commitments/deliverable-ask');
  const cand = promiseCommitmentOf(a.item, a.verdict, a.counterparty);
  if (!cand) return 'skipped';
  const { isNearDuplicate, writeCommitments } = await import('@/lib/commitments/extract');
  const { data: open, error } = await client.from('commitments')
    .select('id, description, due_date, source_id')
    .eq('user_id', userId).eq('direction', 'you_owe').in('status', ['open', 'suggested']).eq('thread_id', a.threadId);
  if (error) return 'skipped';
  const rows = (open ?? []) as Array<{ id: string; description: string; due_date: string | null; source_id: string | null }>;
  if (rows.some((r) => r.source_id === a.sent.id)) return 'exists';
  const same = rows.find((r) => isNearDuplicate(cand.description, r.description, 0.5));
  if (same) {
    const { applyFulfillmentVerdict } = await import('@/lib/commitments/fulfillment');
    await applyFulfillmentVerdict(client, userId, { id: same.id, description: same.description, due_date: same.due_date }, a.verdict, async () => false);
    return 'reanchored';
  }
  const { topMessageOf } = await import('@/lib/inbox/top-message');
  await writeCommitments(userId, [cand], {
    source: 'email', sourceId: a.sent.id, threadId: a.threadId, counterparty: a.counterparty,
    anchorAt: a.sent.received_at, sourceText: `${a.sent.subject ?? ''}\n${a.sent.body}`, otherParty: a.counterparty,
    message: { text: topMessageOf(a.sent.body), authoredByUser: true, subject: a.sent.subject ?? null },
  }, client);
  return 'created';
}

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
  /** W19.A — a hot READ path: a deliverable item is never judged here (no AI on a read); it stays
   *  open and is counted. Defaults to `skipLabelReconcile` (the read-time reconcile sets that). */
  readPath?: boolean;
  /** W19.A — the zero-AI gates' seams. */
  deps?: ReplyResolveDeps;
}): Promise<{ resolvedItems: number; resolvedCommitments: number; deliverablesKeptOpen: number; promisesRecorded: number; leftBehind: number }> {
  const { userId, threadId, client } = opts;
  const out = { resolvedItems: 0, resolvedCommitments: 0, deliverablesKeptOpen: 0, promisesRecorded: 0, leftBehind: 0 };
  if (!threadId) return out;
  const readPath = opts.readPath ?? !!opts.skipLabelReconcile;
  let freshJudgments = 0;

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

      // ── W19.A · A REPLY IS NOT A DELIVERY. A deliverable ask closes only on a judged delivery; a
      // promise keeps the item open AND is recorded as a you-owe commitment (tracked, with its date);
      // `unclear` / an outage keeps it open (failure is never fulfillment). An answer-only ask falls
      // through and closes on the reply, as before. ──
      let judgedDelivered: string | null = null;
      {
        const { isDeliverableAsk } = await import('@/lib/commitments/deliverable-ask');
        const { readPlan } = await import('@/lib/store/item-plans');
        const jv = await readPlan(client, userId, 'judgment', `inbox:${it.id}`).catch(() => null);
        const verdict = ((jv?.tasks ?? null) as { verdict?: { work?: string; requires?: unknown[] } } | null)?.verdict ?? null;
        const und = ((it.source_data ?? {}) as { understanding?: { relevance?: string; ownership?: string; ask?: string; deadline?: string | null } }).understanding ?? null;
        if (isDeliverableAsk({ work: verdict?.work ?? null, requires: verdict?.requires ?? null, understanding: und })) {
          if (readPath) { out.deliverablesKeptOpen++; out.leftBehind++; continue; } // never judged on a read
          if (freshJudgments >= REPLY_DELIVERABLE_MAX_FRESH) { out.leftBehind++; continue; }
          // The user's newest message ON this thread after the item arose — the reply being judged.
          const { data: sentRows, error: sentErr } = await client.from('emails')
            .select('id, body, metadata, received_at, subject, to_addresses, cc_addresses')
            .eq('user_id', userId).eq('thread_id', threadId).eq('is_from_user', true)
            .gt('received_at', it.created_at)
            .order('received_at', { ascending: false }).limit(5);
          if (sentErr) { out.deliverablesKeptOpen++; continue; }
          type SentRow = { id: string; body?: string | null; metadata?: { attachments?: unknown[] } | null; received_at?: string | null; subject?: string | null; to_addresses?: string[] | null; cc_addresses?: string[] | null };
          const addressed = (r: SentRow) => {
            const to = [...(r.to_addresses ?? []), ...(r.cc_addresses ?? [])];
            return !cp || !to.length || to.some((a) => String(a).toLowerCase().includes(String(cp).toLowerCase()));
          };
          // T1: the reply judged is one ADDRESSED to the counterparty (a forward to a third party is not it).
          const sent = ((sentRows ?? []) as SentRow[]).find(addressed) ?? null;
          if (!sent) { out.deliverablesKeptOpen++; continue; }
          const judge = opts.deps?.judge ?? (await import('@/lib/commitments/fulfillment')).judgeFulfillmentFromEvidence;
          const meta = (sent.metadata ?? {}) as { attachments?: unknown[] };
          let fv: Awaited<ReturnType<typeof judge>>;
          try {
            fv = await judge(client, userId, {
              kind: 'inbox', id: it.id, description: String(und?.ask || it.work_title || it.source_data?.subject || ''),
              due_date: und?.deadline ?? null, created_at: it.created_at, wantsPromiseQuote: true,
            }, [{
              type: 'email', id: String(sent.id), at: String(sent.received_at ?? ''), title: String(sent.subject ?? ''),
              body: String(sent.body ?? ''), attachmentCount: Array.isArray(meta.attachments) ? meta.attachments.length : null,
            }], true);
          } catch { out.deliverablesKeptOpen++; continue; } // never close on an error path
          if (fv.fresh) freshJudgments++;
          if (fv.verdict !== 'delivered') {
            out.deliverablesKeptOpen++;
            if (fv.verdict === 'promised') {
              try {
                const record = opts.deps?.recordPromise ?? recordPromiseCommitment;
                const r = await record(client, userId, {
                  item: { id: it.id, work_title: it.work_title ?? null, source_data: (it.source_data ?? null) as Record<string, unknown> | null },
                  verdict: fv, sent: { id: String(sent.id), body: String(sent.body ?? ''), received_at: sent.received_at ?? null, subject: sent.subject ?? null },
                  threadId, counterparty: cp,
                });
                if (r === 'created' || r === 'reanchored') out.promisesRecorded++;
              } catch { /* the item stays open regardless — the promise is re-tried on the next pass */ }
            }
            continue; // promised / unclear — the deliverable stays on the plate
          }
          judgedDelivered = fv.reason || 'judged delivered';
        }
      }

      // THE OUTCOME LEDGER (W3.2): the user answered from their own mailbox — the most common fate
      // of a prepared reply, and until now the ledger's loudest silence. Capture what we had
      // prepared-and-unsent BEFORE the flip; it is stamped done_elsewhere once the flip lands.
      const { capturePending, logPendingOutcomes } = await import('@/lib/prepare/outcome');
      const pendingPrep = await capturePending(client, userId, { kind: 'inbox', id: it.id });
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
      await logPendingOutcomes(client, userId, pendingPrep, {
        base: 'done_elsewhere', itemKind: 'inbox', itemId: it.id, door: 'reply_external', source: sd,
      }).catch(() => 0);

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
      await import('@/lib/room/turns').then(({ settleAsksForItem }) => settleAsksForItem(client, userId, 'inbox_item', it.id)).catch(() => 0); // W14.2: awaited — a fire-and-forget settle dies with the function
      const subject = it.work_title || (it.source_data?.subject as string) || 'a thread';
      // marked_done → reversible via /api/restore (inbox_item → status='pending'), reappears on Home.
      await logActivity(client, userId, {
        type: 'marked_done',
        title: `Resolved (you replied): ${subject}`,
        entityType: 'inbox_item',
        entityId: it.id,
        metadata: { reason: 'replied', auto: true, ...(judgedDelivered ? { judged: 'delivered', why: judgedDelivered.slice(0, 200) } : {}) },
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

      // THE OUTCOME LEDGER (W3.2): the commitment's pooled preparations, captured before the flip.
      const { capturePending: captureC, logPendingOutcomes: logC } = await import('@/lib/prepare/outcome');
      const pendingC = await captureC(client, userId, { kind: 'commitment', id: c.id });
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
      await logC(client, userId, pendingC, {
        base: 'done_elsewhere', itemKind: 'commitment', itemId: c.id, door: 'reply_external',
      }).catch(() => 0);
      await import('@/lib/room/turns').then(({ settleAsksForItem }) => settleAsksForItem(client, userId, 'commitment', c.id)).catch(() => 0); // W14.2: awaited — a fire-and-forget settle dies with the function
      // commitment_done → reversible via /api/restore (commitment → status='open'), reappears on Home.
      await logActivity(client, userId, {
        type: 'commitment_done',
        title: `Resolved (you replied): ${c.description}`,
        entityType: 'commitment',
        entityId: c.id,
        metadata: { reason: 'replied', auto: true },
      });
    }

    // ── LAW 4 · ONE CONVERSATION, ONE OBLIGATION: the same exchange may live on a second thread
    // (a counterparty told to write to the user's other address). Settlement spreads — bounded,
    // best-effort, once per settle, and only across a STRUCTURAL bridge that has not moved since;
    // everything softer is nominated for the judge. Never fatal to the resolution itself. ──
    if (out.resolvedItems || out.resolvedCommitments) {
      try {
        const { cascadeConversationSettlement } = await import('@/lib/inbox/conversation-identity');
        await cascadeConversationSettlement(client, userId, {
          threadId, settledAt: new Date().toISOString(), via: 'you replied',
        });
      } catch { /* the cascade is an enhancement — this thread is settled regardless */ }
    }

    if (out.deliverablesKeptOpen || out.leftBehind) {
      console.log(`[resolve-on-reply] ${userId.slice(0, 8)} thread ${threadId.slice(0, 8)}: ${out.deliverablesKeptOpen} deliverable(s) kept open (a reply is not a delivery), ${out.promisesRecorded} promise(s) recorded, ${out.leftBehind} left for the evidence sweep`);
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
