// Structural reply-state — the SINGLE, language-agnostic source of truth for "has the user
// responded on this thread". It reasons ONLY over message DIRECTION (is_from_user) and TIMESTAMPS.
// There is NO text inspection here: no keyword lists, no phrase/regex matching of email bodies, no
// "looks like a reply" heuristic. A user-sent message on the thread after `since` IS a response —
// full stop. Because it keys purely off who sent a message and when, it works identically in any
// language and for any phrasing, and can never be fooled (or blocked) by wording.
//
// Used by BOTH the sync-time resolution (clearing an answered needs-reply item + you-owe commitment)
// AND buildBriefContext (so the brief synthesis can REASON "the user already replied → drop it").
// One helper, no divergent logic.

export interface ThreadMessage {
  /** true = the user sent this message (structural: from_address === the user's mailbox). */
  is_from_user: boolean;
  /** ISO timestamp of the message. */
  received_at: string | null;
}

export interface ThreadReplyState {
  /** the user sent at least one message on this thread (after `since`, if given). */
  userReplied: boolean;
  /** the most recent message on the thread is from the user (the ball is in the other court). */
  lastMessageFromUser: boolean;
  /** timestamp of the user's most recent qualifying reply, or null. */
  lastUserReplyAt: Date | null;
  /** timestamp of the most recent message on the thread (any direction), or null. */
  lastActivityAt: Date | null;
}

function toTime(v: string | null | undefined): number | null {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
}

/**
 * Compute the structural reply-state of a thread from its messages.
 *
 * Pure and deterministic: the result depends only on message direction + timestamps.
 *
 * @param messages  the thread's messages (any order); each carries is_from_user + received_at.
 * @param since     if given, only a user message strictly AFTER this counts as a reply — so we detect
 *                  "the user responded AFTER the open item/commitment was created", not an older
 *                  message already in the thread when the item appeared.
 */
export function computeThreadReplyState(
  messages: ThreadMessage[],
  since?: Date | null,
): ThreadReplyState {
  const sinceMs = since ? since.getTime() : null;

  let lastUserReplyAt: number | null = null; // newest qualifying (after `since`) user message
  let lastActivityAt: number | null = null;  // newest message, any direction
  let lastMsgTime: number | null = null;     // time of the single newest message
  let lastMsgFromUser = false;

  for (const m of messages) {
    const t = toTime(m.received_at);
    if (t === null) continue;

    if (lastActivityAt === null || t > lastActivityAt) lastActivityAt = t;

    // Track the single newest message + who sent it (for "is the ball in their court").
    if (lastMsgTime === null || t > lastMsgTime) {
      lastMsgTime = t;
      lastMsgFromUser = m.is_from_user === true;
    }

    // A qualifying user reply: from the user AND (no window, or strictly after it).
    if (m.is_from_user === true && (sinceMs === null || t > sinceMs)) {
      if (lastUserReplyAt === null || t > lastUserReplyAt) lastUserReplyAt = t;
    }
  }

  return {
    userReplied: lastUserReplyAt !== null,
    lastMessageFromUser: lastMsgFromUser,
    lastUserReplyAt: lastUserReplyAt !== null ? new Date(lastUserReplyAt) : null,
    lastActivityAt: lastActivityAt !== null ? new Date(lastActivityAt) : null,
  };
}
