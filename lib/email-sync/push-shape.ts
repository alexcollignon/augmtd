// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE PUSH SHAPE (stabilization W9.2 WHAT YOU SEND ANYWHERE CLOSES WITHIN SECONDS).
//
// THE FINDING (Sep 23 audit): the Gmail watch listened to INBOX only and the Outlook subscription to
// `me/mailFolders/inbox/messages` only — a reply the user sent from Gmail/Outlook directly never
// pushed, so the thread it answered stayed open until a Home-load reconcile or the 6h sweep.
//
// THE SHAPE (one place, versioned):
//   • Gmail — ONE watch with labelIds [INBOX, SENT] + labelFilterBehavior INCLUDE: the Gmail API
//     notifies on a change to a message carrying ANY listed label (users.watch; `labelFilterBehavior`
//     replaces the deprecated `labelFilterAction`). history.list takes at most one labelId, so the
//     push handler lists every messageAdded and keeps mail through `gmailPushKeeps` (drafts, spam and
//     trash are not deliveries). Calling users.watch again REPLACES the watch — renewal is the
//     migration, and it is idempotent.
//   • Outlook — TWO Graph subscriptions (changeType created): the inbox and the Sent Items folder. The
//     inbox id stays in `connections.push_subscription_id` (the historical column); the Sent id rides
//     in `connections.metadata.push_sent_subscription_id` (no migration). A Graph subscription's
//     resource is immutable (PATCH moves only its expiry), so the Sent subscription is ADDED, never
//     patched in.
//   • `metadata.push_watch_shape` records which shape a connection is registered with; the daily
//     renew (and `scripts/rewatch-sent.ts`, dry-run by default) re-registers every connection whose
//     stamp differs from PUSH_WATCH_SHAPE.
//
// This file holds a SUBSCRIPTION shape (what the provider pushes), never authorship: which messages
// are the user's is decided only by lib/email-sync/authorship.ts (W7.6), never by a folder.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { SupabaseClient } from '@supabase/supabase-js';

/** Bump when the registered shape changes — every connection with another stamp is re-registered. */
export const PUSH_WATCH_SHAPE = 'inbox+sent@w9.2';

/** Gmail users.watch labels: arrivals AND the user's own sends. */
export const GMAIL_WATCH_LABEL_IDS: readonly string[] = ['INBOX', 'SENT'];
export const GMAIL_WATCH_FILTER_BEHAVIOR = 'INCLUDE';

/** Graph subscription resources — the inbox and the well-known Sent Items folder. */
export const OUTLOOK_INBOX_RESOURCE = 'me/mailFolders/inbox/messages';
export const OUTLOOK_SENT_RESOURCE = "me/mailFolders('SentItems')/messages";

/** Gmail labels a push never stores: a draft is not a delivery; spam/trash are not mail we read. */
const GMAIL_PUSH_SKIP = new Set(['DRAFT', 'SPAM', 'TRASH']);

/** PURE — does a Gmail message listed by history.list belong in the push sync? */
export function gmailPushKeeps(labelIds: readonly string[] | null | undefined): boolean {
  return !(labelIds ?? []).some((l) => GMAIL_PUSH_SKIP.has(l));
}

/** THE PUSH CALENDAR WINDOW — a mail push also refreshes the calendar. `daysBehind: 1` covers the
 *  whole of today, so a meeting that ended an hour ago is seen at the next push (not the hourly cron).
 *  NB: never 0 — `syncCalendarForConnection` treats a falsy daysBehind as its 7-day default, so 0 was
 *  an accidental week, and a `??` fix there would have silently made it "nothing in the past". */
export const PUSH_CALENDAR_WINDOW = { daysAhead: 14, daysBehind: 1 } as const;

/** PURE — does this connection need re-registering to the current push shape? */
export function pushShapeStale(conn: { metadata?: { push_watch_shape?: unknown } | null }): boolean {
  return conn.metadata?.push_watch_shape !== PUSH_WATCH_SHAPE;
}

/** Merge keys into connections.metadata from a FRESH read (never a caller's stale copy — the tokens
 *  live in the same object). Checks `error` on both legs (house rule 6). */
export async function mergeConnectionMetadata(
  admin: SupabaseClient, connectionId: string, patch: Record<string, unknown>,
): Promise<void> {
  const { data, error } = await admin.from('connections').select('metadata').eq('id', connectionId).maybeSingle();
  if (error) throw new Error(`[PushShape] metadata read failed: ${error.message}`);
  const current = ((data as { metadata?: Record<string, unknown> | null } | null)?.metadata ?? {}) as Record<string, unknown>;
  const { error: upErr } = await admin.from('connections').update({ metadata: { ...current, ...patch } }).eq('id', connectionId);
  if (upErr) throw new Error(`[PushShape] metadata write failed: ${upErr.message}`);
}
