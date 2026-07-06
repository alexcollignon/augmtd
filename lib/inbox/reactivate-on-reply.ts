// Reactivation — the inverse of resolve-on-reply. When a thread the user had RESOLVED (replied /
// marked Done / dismissed) gets a genuinely NEW INBOUND reply, reopen its inbox_item so it comes
// back on the inbox + Home, restore an active work_state, and relabel the mailbox from AUGMTD/Done
// back to its active label.
//
// AGNOSTIC + conservative by construction:
//   - Only the connection owner's inbound mail (is_from_user === false) reaches here. A user re-reply
//     never reopens a resolved thread (the caller gates on !is_from_user).
//   - Only reopens when the incoming message is genuinely NEWER than what the item last displayed
//     (source_data.received_at) — re-syncing historical mail can't resurrect a closed thread.
//   - Idempotent: the UPDATE is guarded with .in('status', ['completed','dismissed']) so a concurrent
//     flip or a second sync of the same reply is a no-op.
//
// This is the SINGLE source of truth for reactivation, called from two places in sync-emails.ts:
//   1. the NEW-email SAFETY NET (email row freshly inserted), and
//   2. the BACKFILL path (email row already in `emails` — stored by a push — but the resolved item
//      never reopened). Without (2), a resolved thread with a new reply whose email row already
//      exists is `continue`-skipped forever and can never resurface. That was the Outlook regression.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DBClient = any;

const ACTIVE_WS = new Set(['work_prepared', 'decision_required', 'action_required', 'waiting']);

export interface ReactivateParams {
  userId: string;
  connection: {
    provider: string;
    metadata?: { tokens?: string; [k: string]: unknown };
    id: string;
    [k: string]: unknown;
  };
  /** The freshly-stored (or already-stored) inbound email row. */
  storedEmail: {
    id: string;
    message_id: string;
    thread_id: string | null;
    from_address: string;
    from_name?: string | null;
    subject?: string | null;
    body?: string | null;
    html_body?: string | null;
    received_at: string | null;
    metadata?: { outlook_id?: string; [k: string]: unknown } | null;
  };
  /** Pre-fetched existing item on this thread. If omitted the helper looks it up. */
  existingItem?: {
    id: string;
    status: string;
    work_state?: string | null;
    rule_type?: string | null;
    source_data?: Record<string, unknown> | null;
  } | null;
  /** The classifier verdict for THIS email (noise | fyi_only | process). Drives the relabel target. */
  emailClass?: string;
  autoLabel: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  gmailLabelCache?: any;
  client: DBClient;
}

/**
 * Reopen a resolved inbox_item on a new inbound reply. Returns true if it actually reopened.
 * Fully non-fatal — never throws; the caller's sync continues regardless.
 */
export async function reactivateResolvedThreadOnReply(params: ReactivateParams): Promise<boolean> {
  const { userId, connection, storedEmail, emailClass, autoLabel, gmailLabelCache, client } = params;
  try {
    const threadId = storedEmail.thread_id || storedEmail.message_id;

    // Resolve the item to act on — the newest inbox_item on this thread — unless supplied.
    let item = params.existingItem;
    if (item === undefined) {
      const { data } = await client
        .from('inbox_items')
        .select('id, status, work_state, rule_type, source_data')
        .eq('user_id', userId)
        .eq('source', 'email')
        .eq('source_data->>thread_id', threadId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      item = data ?? null;
    }
    if (!item) return false;
    if (item.status !== 'completed' && item.status !== 'dismissed') return false;

    // Only a genuinely NEWER inbound message reopens it. If the item already reflects this message
    // (or a newer one), this is a re-sync of old mail — leave the resolved item closed.
    const lastSeen = (item.source_data as Record<string, unknown> | null)?.received_at as string | undefined;
    const incoming = storedEmail.received_at;
    if (lastSeen && incoming && new Date(incoming) <= new Date(lastSeen)) return false;

    const priorWs = item.work_state ?? null;
    const restoreWs = priorWs && ACTIVE_WS.has(priorWs) ? priorWs : 'work_prepared';
    const reopenedAt = new Date().toISOString();

    const existingSd = (item.source_data ?? {}) as Record<string, unknown>;
    // Strip resolution markers so it no longer reads as resolved.
    delete existingSd.resolved_reason;
    delete existingSd.resolved_at;

    const newSourceData = {
      email_id: storedEmail.id,
      message_id: storedEmail.message_id,
      thread_id: threadId,
      from: storedEmail.from_address,
      from_address: storedEmail.from_address,
      from_name: storedEmail.from_name,
      subject: storedEmail.subject,
      body: storedEmail.body,
      html_body: storedEmail.html_body?.slice(0, 15000) || null,
      received_at: storedEmail.received_at,
      provider: connection.provider,
    };

    const { error } = await client
      .from('inbox_items')
      .update({
        status: 'pending',
        work_state: restoreWs,
        source_data: { ...existingSd, ...newSourceData },
        source_id: storedEmail.id,
        last_activity_at: storedEmail.received_at || reopenedAt,
        updated_at: reopenedAt,
      })
      .eq('id', item.id)
      .in('status', ['completed', 'dismissed']); // guard against a concurrent flip
    if (error) {
      console.error('    ✗ Reactivation update failed:', error.message);
      return false;
    }

    console.log('    ♻️  Reopened resolved thread on new inbound reply');

    // Bust the Home brief cache so the reopened item resurfaces next load.
    await client.from('profiles').update({ home_brief: null }).eq('id', userId).then(() => {}, () => {});

    // Relabel the mailbox back to the ACTIVE state (NOT Done). reconcile STRIPS the stale AUGMTD/Done
    // first; the label matches THIS email's class so a fyi/noise reply doesn't get an actionable label.
    if (autoLabel) {
      const ruleLabel = item.rule_type ?? null;
      const classTarget: string | null =
        emailClass === 'noise' ? 'notifications' : emailClass === 'fyi_only' ? 'fyi' : null;
      await import('@/lib/inbox/rules/write-back').then(async ({ reconcileAugmtdLabel, mapWorkStateToLabel }) => {
        await reconcileAugmtdLabel({
          provider: connection.provider,
          encryptedTokens: connection.metadata?.tokens ?? '',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          targetLabel: (classTarget ?? (ruleLabel && ruleLabel !== 'done' ? ruleLabel : mapWorkStateToLabel(restoreWs))) as any,
          gmailThreadId: storedEmail.thread_id,
          gmailCache: gmailLabelCache,
          outlookMessageId: storedEmail.metadata?.outlook_id ?? storedEmail.message_id,
          onTokenRefresh: connection.provider === 'outlook'
            ? async (newTokens: { accessToken: string; refreshToken: string; expiresOn: string }) => {
                const newEncrypted = Buffer.from(JSON.stringify(newTokens)).toString('base64');
                await client.from('connections').update({ metadata: { ...connection.metadata, tokens: newEncrypted } }).eq('id', connection.id);
              }
            : undefined,
        });
      }).catch(() => {});
    }

    return true;
  } catch (e) {
    console.error('[reactivate-on-reply] non-fatal error:', e);
    return false;
  }
}
