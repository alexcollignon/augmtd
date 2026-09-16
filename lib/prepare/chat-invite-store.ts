// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE CHAT-BORN INVITE'S STORE — where a prepared invite LIVES between the card and the commit.
//
// An item-born invite already has a home: the item's own `source_data.prepared_invite`, and its
// commit door (/api/items/execute) reads the item. A chat-born invite has no item — so it needs a
// row of its own, and the send door must read THAT row, never the client's fields: a door that
// sends what the browser hands it is a door that can be told to mail anyone.
//
// THE STORE (no migration — the house `item_plans` precedent, same as `frame_share`/`workflow_owner`):
//   user_id   = the owner (the only person who may send it)
//   kind      = 'chat_invite'
//   entity_id = the minted invite id (the card's ref)
//   tasks     = { invite, roomKey, createdAt, sentAt? }
//
// The card carries the id; the payload it renders is a COPY for display and editing. The send door
// re-reads this row, applies the user's edits under the SAME attendee floor the preparer enforced
// (an edited attendee must still be one the preparation grounded), and commits through the door.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PreparedCalendarInvite } from '@/lib/home/prepare-action';

export const CHAT_INVITE_KIND = 'chat_invite';

export interface StoredChatInvite {
  id: string;
  invite: PreparedCalendarInvite;
  roomKey: string | null;
  sentAt: string | null;
}

/** Persist a freshly prepared invite and mint its id. Non-fatal: null = no durable card (the
 *  conversation still answers; the card is only offered when it can survive a reload). */
export async function saveChatInvite(
  client: SupabaseClient, userId: string,
  args: { invite: PreparedCalendarInvite; roomKey?: string | null },
): Promise<string | null> {
  try {
    const id = randomUUID();
    const { error } = await client.from('item_plans').insert({
      user_id: userId, kind: CHAT_INVITE_KIND, entity_id: id,
      tasks: { invite: args.invite, roomKey: args.roomKey ?? null, createdAt: new Date().toISOString() },
    });
    return error ? null : id;
  } catch { return null; }
}

/** The send door's read — the stored payload, scoped to its owner. */
export async function readChatInvite(
  client: SupabaseClient, userId: string, inviteId: string,
): Promise<StoredChatInvite | null> {
  try {
    const { data } = await client.from('item_plans').select('entity_id, tasks')
      .eq('user_id', userId).eq('kind', CHAT_INVITE_KIND).eq('entity_id', inviteId).maybeSingle();
    const t = (data?.tasks ?? null) as { invite?: PreparedCalendarInvite; roomKey?: string | null; sentAt?: string | null } | null;
    if (!t?.invite || typeof t.invite !== 'object') return null;
    return {
      id: String(data!.entity_id), invite: t.invite,
      roomKey: t.roomKey ?? null, sentAt: t.sentAt ?? null,
    };
  } catch { return null; }
}

/** Merge one write into the row's `tasks` blob (read-modify-write; the row is small and per-user). */
async function patchRow(
  client: SupabaseClient, userId: string, inviteId: string, patch: Record<string, unknown>,
): Promise<boolean> {
  try {
    const { data } = await client.from('item_plans').select('tasks')
      .eq('user_id', userId).eq('kind', CHAT_INVITE_KIND).eq('entity_id', inviteId).maybeSingle();
    if (!data) return false;
    const { error } = await client.from('item_plans')
      .update({ tasks: { ...((data.tasks ?? {}) as Record<string, unknown>), ...patch }, updated_at: new Date().toISOString() })
      .eq('user_id', userId).eq('kind', CHAT_INVITE_KIND).eq('entity_id', inviteId);
    return !error;
  } catch { return false; }
}

/** THE EDITS LAND FIRST: the user's card edits become the STORED payload, so the send door can
 *  read the row and mail what the row says (never what a request body claims). */
export async function updateChatInvitePayload(
  client: SupabaseClient, userId: string, inviteId: string, invite: PreparedCalendarInvite,
): Promise<boolean> {
  return patchRow(client, userId, inviteId, { invite });
}

/** Stamp the send — the row becomes the record of what went out (a spent card can't re-fire).
 *  Called only AFTER the executor succeeded: a failed send must leave the card alive to retry. */
export async function markChatInviteSent(
  client: SupabaseClient, userId: string, inviteId: string,
): Promise<void> {
  await patchRow(client, userId, inviteId, { sentAt: new Date().toISOString() });
}
