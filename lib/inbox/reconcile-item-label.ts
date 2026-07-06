// Single, non-fatal helper the resolution endpoints (send-reply / complete / dismiss) and the
// external-reply auto-resolver call to reconcile an inbox item's AUGMTD mailbox label after its DB
// status changes — e.g. swap "AUGMTD/Needs reply" → "AUGMTD/Done" when a thread is resolved, or back
// to its active label when a resolved thread re-opens. Wraps reconcileAugmtdLabel: it resolves the
// item's email connection (provider + tokens) + the thread id (Gmail thread_id / Outlook internal
// id) the same way the send/label path does, and honors the profiles.email_settings.auto_label
// master switch. NEVER throws — a label failure must never break the caller's response.

import { reconcileAugmtdLabel } from '@/lib/inbox/rules/write-back';
import type { RuleLabel } from '@/lib/inbox/rules/types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DBClient = any;

/**
 * Reconcile the AUGMTD label for one inbox item to a target state. Resolves the connection + thread
 * id from the item (already-fetched row preferred; falls back to a lookup by id). Fire-and-forget
 * safe — swallows all errors, returns whether the label was applied.
 *
 * @param opts.item   the inbox_items row (needs connection_id + source_data); if omitted, fetched by itemId
 * @param opts.target either an explicit RuleLabel (e.g. 'done') OR a work_state string to map
 */
export async function reconcileItemLabel(opts: {
  userId: string;
  itemId?: string;
  item?: { connection_id?: string | null; source_data?: Record<string, unknown> | null } | null;
  targetLabel?: RuleLabel;
  targetWorkState?: string | null;
  client: DBClient;
}): Promise<boolean> {
  try {
    const { userId, client } = opts;

    // Honor the master auto_label switch — if off, the app stays label-free in the mailbox.
    const { getEmailSettings } = await import('@/lib/inbox/email-settings');
    const settings = await getEmailSettings(userId, client);
    if (!settings.auto_label) return false;

    // Get the item row (source_data + connection_id) — use the passed row, else fetch minimally.
    let item = opts.item ?? null;
    if (!item && opts.itemId) {
      const { data } = await client
        .from('inbox_items')
        .select('connection_id, source_data')
        .eq('id', opts.itemId)
        .eq('user_id', userId)
        .maybeSingle();
      item = data ?? null;
    }
    if (!item) return false;

    const sd = (item.source_data ?? {}) as Record<string, unknown>;
    const provider = (sd.provider as string) || '';
    const threadId = (sd.thread_id as string) || null;
    if (!provider) return false;

    // Resolve the connection (tokens) — prefer connection_id FK, fall back to provider lookup, same
    // as the send-reply route.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let connection: any = null;
    if (item.connection_id) {
      const { data } = await client.from('connections').select('id, provider, metadata').eq('id', item.connection_id).eq('user_id', userId).maybeSingle();
      connection = data;
    }
    if (!connection) {
      const { data } = await client.from('connections').select('id, provider, metadata').eq('user_id', userId).eq('provider', provider).eq('status', 'active').maybeSingle();
      connection = data;
    }
    if (!connection?.metadata?.tokens) return false;

    // Outlook: the reconcile needs the INTERNAL Graph message id (not the RFC message-id). It's stored
    // on the email row's metadata.outlook_id — look it up from the item's source_data.email_id.
    let outlookMessageId: string | null = (sd.message_id as string) || null;
    if (provider === 'outlook' && sd.email_id) {
      const { data: email } = await client.from('emails').select('metadata').eq('id', sd.email_id).maybeSingle();
      if (email?.metadata?.outlook_id) outlookMessageId = email.metadata.outlook_id;
    }

    if (provider === 'gmail' && !threadId) return false;
    if (provider === 'outlook' && !outlookMessageId) return false;

    // Persist a refreshed Outlook token if one comes back mid-call.
    let onTokenRefresh: undefined | ((t: { accessToken: string; refreshToken: string; expiresOn: string }) => Promise<void>);
    if (provider === 'outlook') {
      onTokenRefresh = async (newTokens) => {
        const newEncrypted = Buffer.from(JSON.stringify(newTokens)).toString('base64');
        await client.from('connections').update({ metadata: { ...connection.metadata, tokens: newEncrypted } }).eq('id', connection.id);
      };
    }

    return await reconcileAugmtdLabel({
      provider,
      encryptedTokens: connection.metadata.tokens,
      targetLabel: opts.targetLabel,
      targetWorkState: opts.targetWorkState ?? null,
      gmailThreadId: threadId,
      outlookMessageId,
      onTokenRefresh,
    });
  } catch {
    return false;
  }
}
