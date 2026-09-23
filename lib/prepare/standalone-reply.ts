// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE STANDALONE REPLY'S ASSEMBLY (Sep 21 — the owner's convergence call).
//
// "I don't want us to have multiple components for the same thing in different ways — shouldn't we
// reuse the email draft component, and leave the reply-FROM open for the user?"
//
// The draft door's NONE branch — a message that is in no inbox of ours — used to hand back
// delimited plain text to copy-paste: a fourth rendering of an email, and the only one the user
// could not send. It now lands on THE ONE EMAIL CARD, in its standalone mode. This module is the
// half the card cannot do for itself: who it can send AS, and the durable row the send door reads.
//
// It never drafts. The body is handed in, written by THE ONE DRAFTER at the door that called it —
// a second drafter here is exactly the drift the card contract exists to prevent.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveSendFrom, type SendMailbox, type StandaloneEmailDraft } from '@/lib/prepare/email-card';
import { saveChatEmail } from '@/lib/prepare/chat-email-store';
import { coworkerEmailForRole } from '@/lib/integrations/registry';
import { emailsIn } from '@/lib/core/email';

/** The user's own sending mailboxes, oldest first (the deterministic default the whole product
 *  already uses for "the primary account"). */
export async function loadSendMailboxes(
  client: SupabaseClient, userId: string,
): Promise<SendMailbox[]> {
  try {
    const { data } = await client.from('connections')
      .select('id, provider, metadata, provider_account_id')
      .eq('user_id', userId).eq('status', 'active')
      .in('provider', ['gmail', 'outlook'])
      .order('created_at', { ascending: true });
    return (data ?? []).map((c) => ({
      id: String(c.id),
      address: String((c.metadata as { email?: string } | null)?.email ?? c.provider_account_id ?? ''),
      provider: String(c.provider ?? ''),
    })).filter((m) => m.address.includes('@'));
  } catch { return []; }
}

/** The address the OAuth-free channel would send as — read from the registry, never invented, and
 *  only ever shown on the lane that actually uses it. */
async function coworkerAddressFor(client: SupabaseClient, userId: string): Promise<string | null> {
  try {
    const { data } = await client.from('custom_agents').select('worker_role')
      .eq('user_id', userId).eq('is_worker', true).eq('worker_role', 'personal_assistant').maybeSingle();
    return coworkerEmailForRole((data?.worker_role as string) ?? 'personal_assistant') || null;
  } catch { return null; }
}

/**
 * prepareStandaloneEmail — the drafted words + the pasted message's own facts → a DURABLE card.
 *
 * NEVER INVENT AN ADDRESS (the house law): `to` is the sender the paste actually named, or empty.
 * The FROM is resolved by the pure ladder, hinted by the addresses the pasted message itself
 * carried (the account it reached is the account that answers it).
 *
 * Returns null when the draft cannot be made durable — the caller then says so plainly rather than
 * offering a card that dies with the tab.
 */
export async function prepareStandaloneEmail(
  client: SupabaseClient, userId: string,
  args: {
    /** What the ONE drafter wrote. */
    body: string;
    /** The pasted message as `pastedAsSourceData` read it. */
    source: Record<string, unknown>;
    /** The raw paste — its addresses are the FROM hint (never a recipient: they are not ours to add). */
    hintText?: string | null;
    roomKey?: string | null;
  },
): Promise<{ id: string; draft: StandaloneEmailDraft } | null> {
  const sender = String(args.source.from_address ?? args.source.from ?? '').trim();
  const rawSubject = String(args.source.subject ?? '').trim();
  const subject = rawSubject ? (/^re:/i.test(rawSubject) ? rawSubject : `Re: ${rawSubject}`) : '';
  const mailboxes = await loadSendMailboxes(client, userId);
  const hintAddresses = emailsIn(String(args.hintText ?? ''))
    .filter((a) => a !== sender.toLowerCase());
  const from = resolveSendFrom(mailboxes, { addresses: hintAddresses });
  const draft: StandaloneEmailDraft = {
    to: sender.includes('@') ? [sender] : [],
    cc: [],
    subject,
    body: String(args.body ?? ''),
    from,
    ...(from.viaCoworker ? { coworkerAddress: await coworkerAddressFor(client, userId) } : {}),
    sentAt: null,
  };
  const id = await saveChatEmail(client, userId, { email: draft, roomKey: args.roomKey ?? null });
  return id ? { id, draft } : null;
}
