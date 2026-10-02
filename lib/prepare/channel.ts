// ════════════════════════════════════════════════════════════════════════════════════════════════
// W43 · WHERE DOES THIS CONVERSATION LIVE? — THE ONE CHANNEL DECISION every drafter / prepare lane asks.
//
// Found live (owner walk, Oct 2): commitments noted from an EMAIL thread with an EMAIL contact were
// prepared as "Words to paste" (paste packs) — the paste-pack predicate read "a commitment has no mail
// thread of its own" as "the deed is out of reach", while the commitment's own source email, its thread
// and its counterparty's address were all on record. The user got words to copy into… their mailbox.
//
// THE LAW (deterministic, zero AI): the channel is a FACT about the conversation, read off the item's own
// record —
//   · a workspace whose email door is OFF                      → off_email   → paste pack (feature_off)
//   · an inbox item (an email in the user's mailbox)           → email       → a reply on its thread
//   · a commitment from an email / with a thread               → email       → an EMAIL draft to the
//       counterparty: a reply on the thread when the source message is known, else a fresh message
//   · a commitment from a meeting / manual note / unknown      → email when the counterparty has an
//       address (a follow-up after a meeting goes by email), else nowhere to send it → paste pack
//   · a commitment from a CHAT APP (Slack, Teams, WhatsApp…)   → chat_app    → paste pack (the
//       conversation lives off-email; an email would be a channel switch nobody asked for)
// A paste pack is the honest preparation ONLY when the conversation lives off-email or no address exists.
// Pure half (`decideChannel`) + one IO reader (`channelForItem`) — every lane reads the SAME answer.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { SupabaseClient } from '@supabase/supabase-js';

export type ConversationChannel = 'email' | 'meeting' | 'chat_app' | 'unknown' | 'off_email';

/** How the words are prepared: a reply on the email thread, a fresh email, or words to paste. */
export type DraftForm = 'email_reply' | 'email_compose' | 'paste_pack';

export type ChannelDecision = {
  channel: ConversationChannel;
  form: DraftForm;
  /** The paste pack's honest reason (only when form === 'paste_pack'). */
  packReason: 'feature_off' | 'no_mail_thread' | null;
  why: string;
};

/** Commitment sources whose conversation lives in a chat app (never email). Lower-case. */
const CHAT_APP_SOURCES = new Set(['slack', 'teams', 'msteams', 'whatsapp', 'telegram', 'chat', 'discord', 'signal', 'linkedin', 'sms']);

export type ChannelFacts = {
  itemKind: 'inbox' | 'commitment';
  /** The workspace's email feature: false = no mailbox door at all; null/undefined = unknown (treated on). */
  emailFeature?: boolean | null;
  /** The commitment's `source` ('email' · 'meeting' · 'manual' · 'brain_synthesis' · a chat app · null). */
  source?: string | null;
  /** The conversation's email thread is on record (commitments.thread_id, or the source email's thread). */
  hasThread?: boolean;
  /** The source message itself is on record (an email-sourced commitment's source_id resolves). */
  sourceMessageKnown?: boolean;
  /** The counterparty's resolved email address (THE ONE ADDRESSEE LADDER), or null. */
  counterpartyEmail?: string | null;
};

/** THE DECISION — pure, total, zero IO. */
export function decideChannel(f: ChannelFacts): ChannelDecision {
  if (f.emailFeature === false) {
    return { channel: 'off_email', form: 'paste_pack', packReason: 'feature_off', why: 'this workspace has no email door — the words are still the work' };
  }
  if (f.itemKind === 'inbox') return { channel: 'email', form: 'email_reply', packReason: null, why: 'an email in the mailbox — the reply goes on its thread' };
  const src = String(f.source ?? '').trim().toLowerCase();
  const address = String(f.counterpartyEmail ?? '').trim();
  const hasAddress = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(address);
  if (CHAT_APP_SOURCES.has(src)) {
    return { channel: 'chat_app', form: 'paste_pack', packReason: 'no_mail_thread', why: `the conversation lives in ${src} — the words go wherever it lives` };
  }
  const emailOrigin = src === 'email' || !!f.hasThread;
  const channel: ConversationChannel = emailOrigin ? 'email' : src === 'meeting' ? 'meeting' : 'unknown';
  if (!hasAddress) {
    return { channel, form: 'paste_pack', packReason: 'no_mail_thread', why: 'no email address on record for who this goes to — the words go wherever it lives' };
  }
  if (emailOrigin && (f.hasThread || f.sourceMessageKnown)) {
    return { channel, form: 'email_reply', packReason: null, why: 'the conversation is an email thread with an email contact — the message is an email on that thread' };
  }
  return { channel, form: 'email_compose', packReason: null, why: channel === 'meeting'
    ? 'agreed in a meeting with an email contact — the follow-up is an email to them'
    : 'the counterparty has an email address — the message is an email to them' };
}

/** THE READER — a commitment's (or an inbox item's) channel, from its own record + the workspace feature
 *  + THE ONE ADDRESSEE LADDER. Never throws: an unreadable record decides on what it has (an inbox item is
 *  always its email thread; a commitment with nothing readable falls to the pack). */
export async function channelForItem(
  admin: SupabaseClient, userId: string,
  item: { kind: 'inbox' | 'commitment'; id: string },
  opts: { features?: Record<string, boolean> | null } = {},
): Promise<ChannelDecision & { addressee?: import('@/lib/prepare/addressee').AddresseeResolution | null }> {
  const emailFeature = opts.features ? (opts.features.email === false ? false : true) : null;
  if (item.kind === 'inbox') return decideChannel({ itemKind: 'inbox', emailFeature });
  try {
    const { data: row, error } = await admin.from('commitments').select('id, description, counterparty, source, source_id, thread_id')
      .eq('id', item.id).eq('user_id', userId).maybeSingle();
    if (error || !row) return decideChannel({ itemKind: 'commitment', emailFeature, source: null });
    let hasThread = !!row.thread_id;
    let sourceMessageKnown = false;
    if (row.source === 'email' && row.source_id && /^[0-9a-f-]{36}$/i.test(String(row.source_id))) {
      const { data: se, error: seErr } = await admin.from('emails').select('id, thread_id').eq('id', row.source_id).eq('user_id', userId).maybeSingle();
      if (!seErr && se) { sourceMessageKnown = true; hasThread = hasThread || !!se.thread_id; }
    }
    const { resolveCommitmentAddressee } = await import('@/lib/prepare/addressee');
    const addr = await resolveCommitmentAddressee(admin, userId, row as never);
    const counterpartyEmail = addr.addressee?.email ?? addr.recipients.find((r) => !!r.email)?.email ?? null;
    return { ...decideChannel({ itemKind: 'commitment', emailFeature, source: row.source as string | null, hasThread, sourceMessageKnown, counterpartyEmail }), addressee: addr };
  } catch {
    return decideChannel({ itemKind: 'commitment', emailFeature, source: null });
  }
}
