// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE MAIL TARGET — one inbox_item resolved to the thing a provider can act on.
//
// Three facts live in three different places (the repo's own shape, not ours to change):
//   • the provider and the Gmail THREAD id ride on `inbox_items.source_data`
//   • the Gmail API message id and the Outlook GRAPH message id ride on `emails.metadata`
//   • the mailbox itself is `resolveConnectionForItem`'s answer (never `.eq('provider').single()` —
//     a user with two Gmail accounts must never have a deed fire on the wrong mailbox)
//
// Every bulk deed that touches mail resolves through HERE, so archive, trash and the mailto
// unsubscribe can never drift on which mailbox they spoke to.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { resolveConnectionForItem } from '@/lib/inbox/resolve-connection';

/* eslint-disable @typescript-eslint/no-explicit-any */
type DBClient = any;

export type InboxItemRow = {
  id: string;
  user_id?: string;
  connection_id?: string | null;
  work_title?: string | null;
  source_data?: Record<string, unknown> | null;
};

export type MailTarget = {
  provider: 'gmail' | 'outlook';
  connection: { id: string; metadata: { tokens: string } };
  encryptedTokens: string;
  /** Gmail acts on THREADS (archive/trash); Outlook acts on MESSAGES. Exactly one side is set. */
  gmailThreadId?: string;
  /** The Gmail API message id (`emails.metadata.gmail_id`) — the header read's address. */
  gmailMessageId?: string;
  outlookMessageId?: string;
};

/** Never throws. A null is an honest "this item has no mailbox we can act on". */
export async function resolveMailTarget(
  client: DBClient, userId: string, item: InboxItemRow,
): Promise<MailTarget | null> {
  try {
    const sd = (item.source_data ?? {}) as Record<string, unknown>;
    const provider = sd.provider as string | undefined;
    if (provider !== 'gmail' && provider !== 'outlook') return null;

    const connection = await resolveConnectionForItem(client, userId, item);
    const encryptedTokens = connection?.metadata?.tokens as string | undefined;
    if (!connection || !encryptedTokens) return null;

    // The `emails` row carries both providers' own ids.
    let gmailMessageId: string | undefined;
    let outlookMessageId: string | undefined;
    const emailId = sd.email_id as string | undefined;
    if (emailId) {
      const { data: email } = await client.from('emails').select('metadata').eq('id', emailId).maybeSingle();
      const meta = (email?.metadata ?? {}) as Record<string, unknown>;
      gmailMessageId = (meta.gmail_id as string) || undefined;
      outlookMessageId = (meta.outlook_id as string) || undefined;
    }
    if (!outlookMessageId && typeof sd.outlook_id === 'string') outlookMessageId = sd.outlook_id;

    if (provider === 'gmail') {
      const gmailThreadId = typeof sd.thread_id === 'string' ? sd.thread_id : undefined;
      if (!gmailThreadId) return null;
      return { provider, connection, encryptedTokens, gmailThreadId, gmailMessageId };
    }
    if (!outlookMessageId) return null;
    return { provider, connection, encryptedTokens, outlookMessageId };
  } catch {
    return null;
  }
}

/** The item's own words, as the preview prints them. Never an invented title. */
export function subjectOf(item: InboxItemRow): string {
  const sd = (item.source_data ?? {}) as Record<string, unknown>;
  const s = (sd.subject as string) || item.work_title || '(no subject)';
  return s.length <= 120 ? s : `${s.slice(0, 119).trimEnd()}…`;
}
