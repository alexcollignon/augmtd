// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE CHAT-BORN EMAIL'S STORE — where a STANDALONE draft lives between the card and the commit.
//
// The sibling of `chat-invite-store`, for the same reason and by the same shape. An item-born
// reply already has a home (the item's `source_data.draft`) and a door that reads it
// (/api/inbox/<id>/send-reply). A draft answering a message that is NOT in the synced inbox — a
// paste, another mailbox — has no item, so it needs a row of its own, and the send door must read
// THAT row: a door that mails the fields a browser handed it is a door that can be told to mail
// anyone.
//
// THE STORE (no migration — the house `item_plans` precedent, same as `chat_invite`/`frame_share`):
//   user_id   = the owner (the only person who may send it)
//   kind      = 'chat_email'
//   entity_id = the minted draft id (the card's ref)
//   tasks     = { email, roomKey, createdAt, sentAt? }
//
// The card carries the id; what it renders is a COPY for display and editing. The send door
// re-reads this row, applies the user's edits under its own validation (a recipient must be a real
// address, a FROM must be one of THIS user's own active mailboxes), and commits through the one
// commit door. Nothing here sends; nothing here is reachable by the model.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { StandaloneEmailDraft } from '@/lib/prepare/email-card';

export const CHAT_EMAIL_KIND = 'chat_email';

export interface StoredChatEmail {
  id: string;
  email: StandaloneEmailDraft;
  roomKey: string | null;
  sentAt: string | null;
}

/** Persist a freshly drafted standalone email and mint its id. Non-fatal: null = no durable card
 *  (the conversation still answers; a card is only offered when it can survive a reload). */
export async function saveChatEmail(
  client: SupabaseClient, userId: string,
  args: { email: StandaloneEmailDraft; roomKey?: string | null },
): Promise<string | null> {
  try {
    const id = randomUUID();
    const { error } = await client.from('item_plans').insert({
      user_id: userId, kind: CHAT_EMAIL_KIND, entity_id: id,
      tasks: { email: args.email, roomKey: args.roomKey ?? null, createdAt: new Date().toISOString() },
    });
    return error ? null : id;
  } catch { return null; }
}

/** The send door's read — the stored payload, scoped to its owner. */
export async function readChatEmail(
  client: SupabaseClient, userId: string, emailId: string,
): Promise<StoredChatEmail | null> {
  try {
    const { data } = await client.from('item_plans').select('entity_id, tasks')
      .eq('user_id', userId).eq('kind', CHAT_EMAIL_KIND).eq('entity_id', emailId).maybeSingle();
    const t = (data?.tasks ?? null) as { email?: StandaloneEmailDraft; roomKey?: string | null; sentAt?: string | null } | null;
    if (!t?.email || typeof t.email !== 'object') return null;
    return {
      id: String(data!.entity_id), email: t.email,
      roomKey: t.roomKey ?? null, sentAt: t.sentAt ?? null,
    };
  } catch { return null; }
}

/** Merge one write into the row's `tasks` blob (read-modify-write; the row is small and per-user). */
async function patchRow(
  client: SupabaseClient, userId: string, emailId: string, patch: Record<string, unknown>,
): Promise<boolean> {
  try {
    const { data } = await client.from('item_plans').select('tasks')
      .eq('user_id', userId).eq('kind', CHAT_EMAIL_KIND).eq('entity_id', emailId).maybeSingle();
    if (!data) return false;
    const { error } = await client.from('item_plans')
      .update({ tasks: { ...((data.tasks ?? {}) as Record<string, unknown>), ...patch }, updated_at: new Date().toISOString() })
      .eq('user_id', userId).eq('kind', CHAT_EMAIL_KIND).eq('entity_id', emailId);
    return !error;
  } catch { return false; }
}

/** THE EDITS LAND FIRST: the user's card edits become the STORED payload, so the send door can
 *  read the row and mail what the row says (never what a request body claims). */
export async function updateChatEmailPayload(
  client: SupabaseClient, userId: string, emailId: string, email: StandaloneEmailDraft,
): Promise<boolean> {
  return patchRow(client, userId, emailId, { email });
}

/** Stamp the send — the row becomes the record of what went out (a spent card can't re-fire).
 *  Called only AFTER the executor succeeded: a failed send must leave the card alive to retry. */
export async function markChatEmailSent(
  client: SupabaseClient, userId: string, emailId: string,
): Promise<void> {
  await patchRow(client, userId, emailId, { sentAt: new Date().toISOString() });
}
