// ════════════════════════════════════════════════════════════════════════════════════════════════
// prepare_calendar_invite — THE INVITE CARD'S CHAT PRODUCER (docs/threads-plan.md — THE CARD
// CONTRACT + EVERY THREAD, EVERY PRODUCER, Sep 8).
//
// ONE tool contract and ONE execution body, shared by every conversational surface: the chief's
// loop (lib/converse) and the coworker DM (the native chat route). "Set up a meeting with Sam
// Thursday 11h" typed into either lands the SAME prepared invite the proactive pass lands, through
// the SAME preparer — a prompted deliverable that arrives as prose where a card exists is a build
// error, and two copies of this dispatch is how the two surfaces would start disagreeing.
//
// IT NEVER SENDS. It prepares, stores the payload, and returns the card's ref. The sending
// capability (`send_calendar_invite`) is not exposed to any chat surface at all; the Send is the
// user's own click on the card, through the commit door (/api/invites/send).
//
// ⚠️ AGENTOS (the Python worker runtime) does NOT yet carry this tool: `infra/agentos/tools_tasks.py`
// would need a `prepare_calendar_invite` @tool calling the internal route, and the box must be
// REDEPLOYED for a Python change (the image bakes it). Until then a worker running under
// WORKERS_USE_AGENTOS prepares invites only on the native path — the gap is stated, never silent.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';
import type { PreparedCalendarInvite } from '@/lib/home/prepare-action';

export const prepareCalendarInviteDefinition = {
  name: 'prepare_calendar_invite',
  description:
    'Prepare a calendar invite CARD for the user to review and send — NEVER sends. Use when they ask to ' +
    'set up / schedule / book a meeting or call ("set up a meeting with Sam Thursday 11h"). The card is ' +
    'filled from the conversation: the attendees it names and the time it states (or a proposal inside a ' +
    'stated day). When no time was stated the card asks for one. Say one short line — the card carries the rest.',
  input_schema: {
    type: 'object' as const,
    properties: {
      request: { type: 'string', description: "the scheduling ask in the user's own words" },
    },
    required: [] as string[],
  },
};

export interface PreparedInviteCard {
  /** The stored payload's id — the card's ref, and the ONLY thing the send door trusts. */
  id: string;
  invite: PreparedCalendarInvite;
}

/**
 * The one execution body. Returns null only when the card could not be made DURABLE — a card that
 * dies with the tab is not offered (truth before presentation); the caller says so plainly.
 */
export async function executePrepareCalendarInvite(
  client: SupabaseClient,
  userId: string,
  args: { request: string; transcript?: string; entityId?: string | null; roomKey?: string | null },
): Promise<PreparedInviteCard | null> {
  const { prepareInviteFromConversation } = await import('@/lib/prepare/invite-from-conversation');
  const { saveChatInvite } = await import('@/lib/prepare/chat-invite-store');
  const invite = await prepareInviteFromConversation(client, userId, {
    ask: args.request,
    transcript: args.transcript ?? '',
    entityId: args.entityId ?? null,
  });
  const id = await saveChatInvite(client, userId, { invite, roomKey: args.roomKey ?? null });
  return id ? { id, invite } : null;
}

/** The one line the producer speaks beside the card — the card carries every detail itself. */
export function inviteCardLine(invite: PreparedCalendarInvite): string {
  if (!invite.startISO) {
    return "I've set the invite up — I don't have a time from the conversation, so pick one on the card and it's ready to send.";
  }
  return `Here's the invite${invite.attendees.length ? '' : ' — add who should be on it'}` +
    `${invite.proposed ? ' (that time is my proposal, inside what was said)' : ''}. Review it and send when it looks right.`;
}
